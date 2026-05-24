"""
segmentation.py
---------------
Real YOLO + SAM2 text-bubble detection and mask refinement.
Designed for sequential VRAM-safe inference on an RTX 4060 (8 GB).

Pipeline
--------
1. YOLO  – single-pass bounding-box detection of speech bubbles / text regions.
2. SAM 2 – prompted segmentation to produce a tight binary mask per box.

VRAM strategy
-------------
* Models are loaded lazily (first call) and kept as fp16 on CUDA.
* After each inference step `torch.cuda.empty_cache()` is called.
* `unload_all()` can be called by main.py between pipeline stages so that
  Ollama + the inpainter never share VRAM with the segmentation models.
"""

from __future__ import annotations

import gc
import logging
import uuid
from pathlib import Path
from typing import List, Optional, Tuple

import cv2
import numpy as np
from pydantic import BaseModel

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------


class TextBlock(BaseModel):
    id: str
    box: Tuple[int, int, int, int]  # x, y, w, h  (top-left origin)
    confidence: float = 1.0
    text: Optional[str] = None
    translated_text: Optional[str] = None
    mask: Optional[np.ndarray] = None  # H×W binary uint8 (0/1)

    class Config:
        arbitrary_types_allowed = True


# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------


class SegmentationEngine:
    """
    Detects manga speech bubbles with YOLO then refines each mask with SAM 2.

    Parameters
    ----------
    yolo_model_path : str
        Path to a local YOLO weights file (.pt) **or** a Ultralytics Hub / HF
        model identifier.  Defaults to the public manga-text detector on HF:
        ``huyvux3005/manga109-segmentation-bubble``
    sam_model_path  : str
        SAM 2 checkpoint name understood by ultralytics (auto-downloaded on
        first use).  ``sam2_b.pt`` (base, ~180 MB) is a good balance for 8 GB
        VRAM.
    device : str
        ``"cuda"`` (default) or ``"cpu"``.
    conf_threshold : float
        Minimum YOLO confidence to keep a detection.
    use_sam : bool
        Set to ``False`` to skip SAM refinement (faster, less precise masks).
    """

    # Default public model – YOLO11n fine-tuned on Manga109 + MangaSegmentation
    # HuggingFace repo id and filename for the manga speech-bubble segmentation model
    DEFAULT_YOLO_HF_REPO = "huyvux3005/manga109-segmentation-bubble"
    DEFAULT_YOLO_HF_FILE = "best.pt"
    # Fallback generic model (auto-downloaded by ultralytics CDN – no HF auth needed)
    DEFAULT_YOLO_FALLBACK = "yolo11n-seg.pt"
    DEFAULT_SAM_MODEL = "sam2_b.pt"

    def __init__(
        self,
        yolo_model_path: str = DEFAULT_YOLO_HF_REPO,
        sam_model_path: str = DEFAULT_SAM_MODEL,
        device: str = "cuda",
        conf_threshold: float = 0.35,
        use_sam: bool = False,
    ) -> None:
        self.yolo_model_path = yolo_model_path
        self.sam_model_path = sam_model_path
        self.device = self._resolve_device(device)
        self.conf_threshold = conf_threshold
        self.use_sam = use_sam

        # Lazy handles – None until first use
        self._yolo = None
        self._sam = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def detect_bubbles(self, image_np: np.ndarray) -> List[TextBlock]:
        """
        Run YOLO detection on *image_np* (RGB, uint8).

        Returns a list of :class:`TextBlock` objects with bounding boxes and
        masks.

        Priority:
        1. If ``use_sam=True`` → SAM 2 refines every mask (highest quality).
        2. If the YOLO model is a segmentation variant (yolo11n-seg / best.pt)
           → instance masks are already attached by ``_run_yolo``; nothing more
           to do.
        3. Otherwise → fall back to simple rectangular masks so the rest of the
           pipeline always has *something* to work with.
        """
        blocks = self._run_yolo(image_np)
        logger.info("YOLO detected %d bubble(s)", len(blocks))

        if not blocks:
            return blocks

        if self.use_sam:
            # SAM 2 overrides whatever mask _run_yolo produced
            blocks = self.refine_masks(image_np, blocks)
        else:
            # Fill in rect masks only for blocks that have no seg mask yet
            h, w = image_np.shape[:2]
            fallback_count = 0
            for b in blocks:
                if b.mask is None:
                    b.mask = self._rect_mask((h, w), b.box)
                    fallback_count += 1
            if fallback_count:
                logger.debug(
                    "%d block(s) had no segmentation mask – used rect fallback",
                    fallback_count,
                )

        return blocks

    def refine_masks(
        self, image_np: np.ndarray, blocks: List[TextBlock]
    ) -> List[TextBlock]:
        """
        Use SAM 2 bounding-box prompts to generate tight bubble masks.

        SAM is loaded, run, then **unloaded** immediately to free VRAM for
        the next pipeline stage.
        """
        if not blocks:
            return blocks

        try:
            sam = self._load_sam()
            h, w = image_np.shape[:2]

            for block in blocks:
                try:
                    x, y, bw, bh = block.box
                    # SAM expects [x1, y1, x2, y2]
                    xyxy = [x, y, x + bw, y + bh]
                    results = sam(
                        image_np,
                        bboxes=[xyxy],
                        verbose=False,
                    )
                    mask = self._extract_sam_mask(results, (h, w))
                    block.mask = mask
                except Exception as e:
                    logger.warning(
                        "SAM refinement failed for block %s: %s – using rect mask",
                        block.id,
                        e,
                    )
                    block.mask = self._rect_mask((h, w), block.box)

            logger.info("SAM masks generated for %d block(s)", len(blocks))

        except Exception as e:
            logger.error("SAM engine failed: %s – falling back to rect masks", e)
            h, w = image_np.shape[:2]
            for b in blocks:
                b.mask = self._rect_mask((h, w), b.box)
        finally:
            # Always unload SAM so the inpainter can use VRAM
            self._unload_sam()

        return blocks

    def unload_all(self) -> None:
        """Explicitly release both models from VRAM."""
        self._unload_yolo()
        self._unload_sam()

    # ------------------------------------------------------------------
    # Private – YOLO
    # ------------------------------------------------------------------

    def _load_yolo(self):
        """Lazy-load YOLO in fp16 on the target device."""
        if self._yolo is not None:
            return self._yolo

        try:
            from ultralytics import YOLO  # type: ignore
        except ImportError as exc:
            raise RuntimeError(
                "ultralytics is not installed.  Run: uv pip install ultralytics"
            ) from exc

        resolved_path = self._resolve_yolo_path(self.yolo_model_path)
        logger.info("Loading YOLO model: %s", resolved_path)
        model = YOLO(resolved_path)

        self._yolo = model
        return self._yolo

    @staticmethod
    def _resolve_yolo_path(model_path: str) -> str:
        """
        Resolve the YOLO model path.

        - If it's a local file that exists → use it directly.
        - If it looks like a HuggingFace repo ID (contains '/') →
          download the best.pt via hf_hub_download and return the
          local cache path.
        - Otherwise assume it's an ultralytics built-in name
          (e.g. 'yolov8n.pt') and return as-is (ultralytics
          auto-downloads these from its own CDN).
        """
        import os

        # Already a local file
        if os.path.isfile(model_path):
            return model_path

        # HuggingFace repo ID  e.g. "huyvux3005/manga109-segmentation-bubble"
        if "/" in model_path and not model_path.endswith(".pt"):
            try:
                from huggingface_hub import hf_hub_download  # type: ignore

                logger.info("Downloading YOLO weights from HuggingFace: %s", model_path)
                local_path = hf_hub_download(
                    repo_id=model_path,
                    filename="best.pt",
                )
                logger.info("Downloaded to: %s", local_path)
                return local_path
            except Exception as exc:
                logger.error(
                    "HuggingFace download failed for '%s': %s – "
                    "falling back to yolo11n-seg.pt",
                    model_path,
                    exc,
                )
                return "yolo11n-seg.pt"

        # Ultralytics built-in (e.g. 'yolov8n.pt') – returned as-is
        return model_path

    def _unload_yolo(self) -> None:
        if self._yolo is not None:
            del self._yolo
            self._yolo = None
            self._empty_cuda_cache()
            logger.debug("YOLO unloaded from VRAM")

    def _run_yolo(self, image_np: np.ndarray) -> List[TextBlock]:
        """Run YOLO and convert results to :class:`TextBlock` list.

        For segmentation models (yolo11n-seg / best.pt from HF) the instance
        masks are extracted directly from ``result.masks`` so that SAM is not
        needed.  For plain detection models only bounding boxes are returned
        and the caller will fall back to rectangular masks.
        """
        yolo = self._load_yolo()

        try:
            results = yolo(
                image_np,
                conf=self.conf_threshold,
                device=self.device,
                verbose=False,
                half=(self.device == "cuda"),
            )
        except Exception as exc:
            logger.error("YOLO inference failed: %s", exc)
            return []
        finally:
            self._empty_cuda_cache()

        h, w = image_np.shape[:2]
        blocks: List[TextBlock] = []

        for result in results:
            if result.boxes is None:
                continue

            # Check once whether this result carries segmentation masks
            has_masks = (
                result.masks is not None
                and result.masks.data is not None
                and len(result.masks.data) > 0
            )

            for i, box in enumerate(result.boxes):
                # xyxy → x, y, w, h
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                x, y = int(x1), int(y1)
                bw, bh = int(x2 - x1), int(y2 - y1)
                conf = float(box.conf[0])

                if bw <= 0 or bh <= 0:
                    continue

                # --- Extract instance mask from YOLO segmentation output ---
                mask: Optional[np.ndarray] = None
                if has_masks and i < len(result.masks.data):
                    try:
                        mask_tensor = result.masks.data[i]  # (H', W') float32
                        mask_np = mask_tensor.cpu().numpy()  # values ~0-1
                        if mask_np.shape != (h, w):
                            mask_np = cv2.resize(
                                mask_np,
                                (w, h),
                                interpolation=cv2.INTER_NEAREST,
                            )
                        mask = (mask_np > 0.5).astype(np.uint8)  # binary 0/1
                    except Exception as mask_err:
                        logger.warning(
                            "Could not extract YOLO mask for detection %d: %s"
                            " – will use rect mask",
                            i,
                            mask_err,
                        )
                        mask = None

                # Fall back to rectangular mask when no seg mask is available
                if mask is None:
                    mask = self._rect_mask((h, w), (x, y, bw, bh))

                blocks.append(
                    TextBlock(
                        id=str(uuid.uuid4()),
                        box=(x, y, bw, bh),
                        confidence=conf,
                        mask=mask,
                    )
                )

        seg_count = sum(1 for b in blocks if b.mask is not None)
        logger.info(
            "YOLO returned %d detection(s), %d with segmentation masks",
            len(blocks),
            seg_count,
        )
        return blocks

    # ------------------------------------------------------------------
    # Private – SAM 2
    # ------------------------------------------------------------------

    def _load_sam(self):
        """Lazy-load SAM 2 in fp16 on the target device."""
        if self._sam is not None:
            return self._sam

        try:
            from ultralytics import SAM  # type: ignore
        except ImportError as exc:
            raise RuntimeError(
                "ultralytics is not installed.  Run: uv pip install ultralytics"
            ) from exc

        logger.info("Loading SAM 2 model: %s", self.sam_model_path)
        model = SAM(self.sam_model_path)

        self._sam = model
        return self._sam

    def _unload_sam(self) -> None:
        if self._sam is not None:
            del self._sam
            self._sam = None
            self._empty_cuda_cache()
            logger.debug("SAM 2 unloaded from VRAM")

    @staticmethod
    def _extract_sam_mask(results, target_shape: Tuple[int, int]) -> np.ndarray:
        """
        Pull the first predicted mask out of a SAM result and resize it to
        *target_shape* (H, W).  Returns a binary uint8 array (values 0/1).
        """
        h, w = target_shape
        fallback = np.zeros((h, w), dtype=np.uint8)

        try:
            for r in results:
                if r.masks is None or len(r.masks) == 0:
                    continue
                # masks.data is (N, H, W) on the model's output resolution
                mask_tensor = r.masks.data[0]
                mask_np = mask_tensor.cpu().numpy().astype(np.uint8)

                if mask_np.shape != (h, w):
                    mask_np = cv2.resize(
                        mask_np, (w, h), interpolation=cv2.INTER_NEAREST
                    )
                return (mask_np > 0).astype(np.uint8)
        except Exception as e:
            logger.warning("Could not extract SAM mask: %s", e)

        return fallback

    # ------------------------------------------------------------------
    # Private – utilities
    # ------------------------------------------------------------------

    @staticmethod
    def _rect_mask(
        shape: Tuple[int, int], box: Tuple[int, int, int, int]
    ) -> np.ndarray:
        """Create a simple rectangular binary mask from a bounding box."""
        h, w = shape
        mask = np.zeros((h, w), dtype=np.uint8)
        x, y, bw, bh = box
        x1 = max(0, x)
        y1 = max(0, y)
        x2 = min(w, x + bw)
        y2 = min(h, y + bh)
        mask[y1:y2, x1:x2] = 1
        return mask

    @staticmethod
    def _resolve_device(requested: str) -> str:
        """Fall back to CPU if CUDA is requested but unavailable."""
        if requested == "cuda":
            try:
                import torch

                if not torch.cuda.is_available():
                    logger.warning(
                        "CUDA requested but unavailable – falling back to CPU"
                    )
                    return "cpu"
                free_vram = torch.cuda.mem_get_info()[0] / 1024**3
                logger.info("CUDA available – free VRAM: %.1f GB", free_vram)
            except ImportError:
                logger.warning("torch not installed – using CPU")
                return "cpu"
        return requested

    @staticmethod
    def _empty_cuda_cache() -> None:
        """Release unused VRAM and run Python GC."""
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
                torch.cuda.synchronize()
        except Exception:
            pass
        gc.collect()
