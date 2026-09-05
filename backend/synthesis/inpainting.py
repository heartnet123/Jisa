import gc
import logging

import cv2
import numpy as np
from PIL import Image

logger = logging.getLogger(__name__)

# Ring std (0-255) at or below this counts as a "flat" background (plain white
# bubble interior). Flat regions are filled with the surrounding median colour
# instead of running LaMa, which guarantees zero texture damage there.
FLAT_STD_THRESHOLD = 14.0


def _try_import_lama():
    """Lazy import so the server still boots if simple-lama-inpainting is not installed."""
    try:
        from simple_lama_inpainting import SimpleLama  # type: ignore

        return SimpleLama
    except ImportError:
        return None


class InpaintingEngine:
    """
    Removes original manga text from the page using LaMa
    (Large Mask inpainting via Fast Fourier Convolutions).

    VRAM strategy for RTX 4060 (8 GB):
    - The LaMa model is loaded lazily on first use and released after every
      call to `process_blocks`, so it does not compete with Ollama or SAM
      which may be resident during the same pipeline run.
    - `release()` can be called explicitly between pipeline stages to free
      VRAM before loading the next model.
    """

    def __init__(self, device: str = "cuda"):
        self.device = device
        self._model = None  # Loaded lazily
        self._lama_available = _try_import_lama() is not None

        if not self._lama_available:
            logger.warning(
                "simple-lama-inpainting not installed. "
                "Falling back to OpenCV INPAINT_TELEA. "
                "Run: uv pip install simple-lama-inpainting"
            )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def process_blocks(
        self,
        image_np: np.ndarray,
        masks: list[np.ndarray],
        dilation_px: int = 12,
        safe_zones: list[np.ndarray] | None = None,
    ) -> np.ndarray:
        """
        Remove all text masks from the page.

        With `safe_zones` (one per mask, usually eroded bubble interiors):
        - each mask is dilated stroke-adaptively and CLIPPED to its zone, so
          the bubble outline and the artwork outside it are never modified
        - masks sitting on a flat background (plain white interior) are filled
          with the surrounding median colour instead of running LaMa — zero
          texture damage there
        - the rest go through a single LaMa pass (cleaner seams than N passes)

        Args:
            image_np:    RGB uint8 image [H, W, 3].
            masks:       List of binary masks (1 = text area, 0 = keep).
                         Each mask must have the same H×W as `image_np`.
            dilation_px: Legacy global dilation; used only when `safe_zones`
                         is None.
            safe_zones:  Optional list of binary keep-regions aligned with
                         `masks`.

        Returns:
            RGB uint8 image with text removed.
        """
        if not masks:
            return image_np.copy()

        zones = (
            list(safe_zones)
            if safe_zones and len(safe_zones) == len(masks)
            else [None] * len(masks)
        )

        out = image_np.copy()
        lama_masks: list[np.ndarray] = []

        for text_mask, zone in zip(masks, zones):
            fat = self._expand_mask(text_mask, zone)
            if not fat.any():
                continue

            median_color, ring_std = self._ring_stats(image_np, fat, zone)
            if ring_std is not None and ring_std <= FLAT_STD_THRESHOLD:
                # Flat background → solid fill; no generative model involved.
                layer = image_np.copy()
                layer[fat > 0] = median_color
                out = self._composite_inpainted(out, layer, fat, feather_px=2)
            else:
                lama_masks.append(fat)

        if not lama_masks:
            return out

        combined = np.zeros(image_np.shape[:2], dtype=np.uint8)
        for fat in lama_masks:
            combined = cv2.bitwise_or(combined, fat)
        return self._inpaint(out, combined)

    @staticmethod
    def _expand_mask(
        text_mask: np.ndarray,
        zone: np.ndarray | None,
        dilation_px: int | None = None,
    ) -> np.ndarray:
        """
        Dilate a text mask to cover anti-aliased edges.

        Dilation defaults to stroke-width-adaptive (thin glyphs get a small
        margin, thick SFX lettering gets a bigger one). When `zone` is given
        the expanded mask is hard-clipped to it, so the erase region can
        never leak onto the bubble outline or the background art.
        """
        m = (text_mask > 0).astype(np.uint8)
        if int(m.sum()) == 0:
            return m

        if dilation_px is None:
            dist = cv2.distanceTransform(m, cv2.DIST_L2, 3)
            stroke_px = float(dist.max()) * 2.0
            dilation_px = int(np.clip(round(3 + stroke_px * 0.75), 4, 12))

        kernel = cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE, (dilation_px * 2 + 1, dilation_px * 2 + 1)
        )
        fat = cv2.dilate(m, kernel, iterations=1)
        if zone is not None:
            fat[zone == 0] = 0
        return fat

    @staticmethod
    def _ring_stats(
        image_np: np.ndarray,
        fat_mask: np.ndarray,
        zone: np.ndarray | None,
    ) -> tuple[np.ndarray | None, float | None]:
        """
        Median RGB colour and std of the pixels ringing the erase region.

        Used to decide whether the local background is flat (uniform white
        bubble interior) — those regions are safe to fill with the median
        colour instead of asking LaMa to invent texture.
        """
        outer = cv2.dilate(
            fat_mask,
            cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13)),
            iterations=1,
        )
        inner = cv2.dilate(
            fat_mask,
            cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)),
            iterations=1,
        )
        ring = cv2.bitwise_and(outer, cv2.bitwise_not(inner))
        if zone is not None:
            ring[zone == 0] = 0

        pixels = image_np[ring > 0]
        if pixels.size < 90:
            # Too few samples to judge flatness — let LaMa handle it safely.
            return None, None

        median_color = np.median(pixels, axis=0).astype(np.uint8)
        std = float(pixels.astype(np.float32).std())
        return median_color, std

    def build_text_masks(
        self,
        image_np: np.ndarray,
        bubble_masks: list[np.ndarray],
    ) -> list[np.ndarray]:
        """
        Convert bubble-level masks into text-only masks.

        The segmentation model finds the whole speech bubble, but for
        inpainting we only want to erase the dark glyphs inside the bubble —
        never the white interior, the outline, or anything outside it.

        Returns a list of (text_mask, safe_zone) pairs. The safe zone is the
        bubble eroded clear of its border; every downstream mask operation
        stays strictly inside that zone.
        """
        pairs: list[tuple[np.ndarray, np.ndarray]] = []

        for bubble_mask in bubble_masks:
            text_mask = self._extract_text_mask(image_np, bubble_mask)
            if text_mask.any():
                pairs.append((text_mask, self._safe_zone(bubble_mask)))

        return pairs

    @staticmethod
    def _safe_zone(bubble_mask: np.ndarray) -> np.ndarray:
        """Bubble interior shrunk clear of the outline — the only editable area."""
        m = (bubble_mask > 0).astype(np.uint8)
        if not m.any():
            return m

        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        zone = cv2.erode(m, kernel, iterations=3)  # ≈6 px margin off the border
        return zone if zone.any() else m

    def release(self) -> None:
        """
        Explicitly unload the LaMa model and free VRAM.
        Call this between pipeline stages (e.g. after inpainting, before
        loading SAM) to keep peak VRAM under 8 GB.
        """
        if self._model is not None:
            logger.info("InpaintingEngine: releasing LaMa model from VRAM.")
            del self._model
            self._model = None
            self._flush_vram()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _load_model(self):
        """Lazy-load LaMa. Downloads weights (~200 MB) on first run."""
        if self._model is not None:
            return

        SimpleLama = _try_import_lama()
        if SimpleLama is None:
            raise RuntimeError("simple-lama-inpainting is not installed.")

        logger.info("InpaintingEngine: loading LaMa model…")
        # SimpleLama auto-downloads weights to ~/.cache/simple_lama/
        # and moves the model to CUDA if available.
        self._model = SimpleLama()
        logger.info("InpaintingEngine: LaMa model ready.")

    @staticmethod
    def _combine_masks(
        shape: tuple,
        masks: list[np.ndarray],
        dilation_px: int,
        safe_zones: list[np.ndarray] | None = None,
    ) -> np.ndarray:
        """OR all masks together, fill tiny gaps, and expand the result.

        When `safe_zones` (aligned with `masks`) is given, each mask is
        expanded stroke-adaptively and clipped to its own zone instead of
        dilating the combined mask globally — guarantees nothing outside the
        zones is ever marked for erasing.
        """
        if safe_zones is not None and len(safe_zones) == len(masks):
            combined = np.zeros(shape, dtype=np.uint8)
            for m, z in zip(masks, safe_zones):
                combined = cv2.bitwise_or(combined, InpaintingEngine._expand_mask(m, z))
            return combined

        combined = np.zeros(shape, dtype=np.uint8)
        for m in masks:
            combined = cv2.bitwise_or(combined, m.astype(np.uint8))

        if int(combined.sum()) > 0:
            close_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
            combined = cv2.morphologyEx(
                combined, cv2.MORPH_CLOSE, close_kernel, iterations=1
            )

        if dilation_px > 0:
            kernel = cv2.getStructuringElement(
                cv2.MORPH_ELLIPSE, (dilation_px * 2 + 1, dilation_px * 2 + 1)
            )
            combined = cv2.dilate(combined, kernel, iterations=1)

        return combined

    @staticmethod
    def _extract_text_mask(
        image_np: np.ndarray,
        bubble_mask: np.ndarray,
    ) -> np.ndarray:
        """
        Build a text-only mask inside a detected bubble.

        Heuristic:
        - keep only pixels inside the bubble
        - find dark foreground strokes (manga text is usually black/dark)
        - suppress the bubble border by eroding the bubble region first
        - remove tiny specks and very large connected components
        """
        h, w = image_np.shape[:2]
        bubble_mask = (bubble_mask > 0).astype(np.uint8)
        if bubble_mask.shape != (h, w) or bubble_mask.sum() == 0:
            return np.zeros((h, w), dtype=np.uint8)

        gray = cv2.cvtColor(image_np, cv2.COLOR_RGB2GRAY)

        inner_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        # iterations=3 ≈6 px margin: text never reaches the outline, so the
        # border stays untouched even after downstream mask dilation
        inner_mask = cv2.erode(bubble_mask, inner_kernel, iterations=3)
        if inner_mask.sum() == 0:
            inner_mask = bubble_mask.copy()

        x, y, w_roi, h_roi = cv2.boundingRect(inner_mask)
        if w_roi <= 0 or h_roi <= 0:
            return np.zeros((h, w), dtype=np.uint8)

        gray_roi = gray[y : y + h_roi, x : x + w_roi]
        mask_roi = inner_mask[y : y + h_roi, x : x + w_roi]
        bubble_pixels = gray_roi[mask_roi > 0]
        if bubble_pixels.size == 0:
            return np.zeros((h, w), dtype=np.uint8)

        percentile_threshold = min(190, int(np.percentile(bubble_pixels, 55)))
        otsu_threshold, _ = cv2.threshold(
            bubble_pixels.astype(np.uint8),
            0,
            255,
            cv2.THRESH_BINARY + cv2.THRESH_OTSU,
        )
        dark_threshold = min(percentile_threshold, int(otsu_threshold))

        dark_roi = ((gray_roi <= dark_threshold).astype(np.uint8)) * mask_roi

        cleanup_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        dark_roi = cv2.morphologyEx(
            dark_roi, cv2.MORPH_CLOSE, cleanup_kernel, iterations=1
        )

        dark = np.zeros((h, w), dtype=np.uint8)
        dark[y : y + h_roi, x : x + w_roi] = dark_roi

        num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(
            dark, connectivity=8
        )

        bubble_area = int(inner_mask.sum())
        text_mask = np.zeros((h, w), dtype=np.uint8)

        for label_idx in range(1, num_labels):
            area = int(stats[label_idx, cv2.CC_STAT_AREA])

            if area < 3:
                continue
            if area > max(64, bubble_area // 3):
                continue

            component = (labels == label_idx).astype(np.uint8)
            text_mask = cv2.bitwise_or(text_mask, component)

        if text_mask.sum() == 0:
            return text_mask

        stroke_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        text_mask = cv2.dilate(text_mask, stroke_kernel, iterations=2)
        text_mask = cv2.bitwise_and(text_mask, inner_mask)

        return (text_mask > 0).astype(np.uint8)

    def _inpaint(self, image_np: np.ndarray, mask: np.ndarray) -> np.ndarray:
        """
        Route to LaMa or OpenCV fallback.

        mask: binary uint8 (1 = erase, 0 = keep).
        """
        if self._lama_available:
            result = self._inpaint_lama(image_np, mask)
        else:
            result = self._inpaint_opencv(image_np, mask)

        return self._composite_inpainted(image_np, result, mask)

    def _inpaint_lama(self, image_np: np.ndarray, mask: np.ndarray) -> np.ndarray:
        """
        LaMa inference path.

        LaMa expects:
          - image : PIL RGB
          - mask  : PIL L (grayscale), 255 = erase
        """
        try:
            self._load_model()

            image_pil = Image.fromarray(image_np.astype(np.uint8))
            # Convert binary 0/1 → 0/255 grayscale PIL mask
            mask_pil = Image.fromarray((mask * 255).astype(np.uint8), mode="L")

            result_pil = self._model(image_pil, mask_pil)
            result = np.array(result_pil)

            # Ensure output is RGB uint8
            if result.ndim == 2:
                result = cv2.cvtColor(result, cv2.COLOR_GRAY2RGB)
            elif result.shape[2] == 4:
                result = cv2.cvtColor(result, cv2.COLOR_RGBA2RGB)

            return result.astype(np.uint8)

        except Exception as exc:  # noqa: BLE001
            logger.error(
                "LaMa inference failed (%s). Falling back to OpenCV TELEA.", exc
            )
            return self._inpaint_opencv(image_np, mask)

        finally:
            # Free VRAM immediately after inference so the next stage
            # (SAM / Ollama) has room to load.
            self.release()

    @staticmethod
    def _inpaint_opencv(image_np: np.ndarray, mask: np.ndarray) -> np.ndarray:
        """
        OpenCV Telea fallback (no GPU, acceptable quality for small text regions).
        """
        logger.info("InpaintingEngine: using OpenCV INPAINT_TELEA fallback.")
        mask_u8 = (mask * 255).astype(np.uint8)
        return cv2.inpaint(
            image_np,
            mask_u8,
            inpaintRadius=4,
            flags=cv2.INPAINT_TELEA,
        )

    @staticmethod
    def _composite_inpainted(
        image_np: np.ndarray,
        inpainted_np: np.ndarray,
        mask: np.ndarray,
        feather_px: int = 3,
    ) -> np.ndarray:
        """Keep model changes inside the erase mask and softly blend the edge."""
        if int(mask.sum()) == 0:
            return image_np.copy()

        target_h, target_w = image_np.shape[:2]
        if mask.shape != (target_h, target_w):
            mask = cv2.resize(
                mask.astype(np.uint8),
                (target_w, target_h),
                interpolation=cv2.INTER_NEAREST,
            )

        if inpainted_np.shape[:2] != (target_h, target_w):
            inpainted_np = cv2.resize(
                inpainted_np,
                (target_w, target_h),
                interpolation=cv2.INTER_LINEAR,
            )

        if inpainted_np.ndim == 2:
            inpainted_np = cv2.cvtColor(inpainted_np, cv2.COLOR_GRAY2RGB)
        elif inpainted_np.shape[2] == 4:
            inpainted_np = cv2.cvtColor(inpainted_np, cv2.COLOR_RGBA2RGB)

        alpha = (mask > 0).astype(np.float32)
        if feather_px > 0:
            kernel_size = feather_px * 2 + 1
            feathered = cv2.GaussianBlur(
                alpha,
                (kernel_size, kernel_size),
                sigmaX=0,
            )
            alpha = np.maximum(alpha, feathered)

        alpha = np.clip(alpha[..., None], 0.0, 1.0)
        blended = inpainted_np.astype(np.float32) * alpha + image_np.astype(
            np.float32
        ) * (1.0 - alpha)
        return np.clip(blended, 0, 255).astype(np.uint8)

    @staticmethod
    def _flush_vram() -> None:
        """Best-effort VRAM flush; safe even when torch is not installed."""
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
                torch.cuda.ipc_collect()
        except ImportError:
            pass
        gc.collect()
