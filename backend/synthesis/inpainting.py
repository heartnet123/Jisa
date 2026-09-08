import gc
import logging

import cv2
import numpy as np
from PIL import Image

logger = logging.getLogger(__name__)


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

        - For uniform speech bubbles (solid white/black/gray background):
          Fills median background color directly onto text mask.
          Avoids neural inpainting blur and preserves 100% border/canvas sharpness.
        - For non-uniform / textured backgrounds (screentones, drawings):
          Applies crop-based inpainting via LaMa (or OpenCV Telea fallback).
        """
        if not masks:
            return image_np.copy()

        zones = (
            safe_zones
            if (safe_zones is not None and len(safe_zones) == len(masks))
            else [None] * len(masks)
        )
        result_img = image_np.copy()
        needs_inpaint_crops: list[np.ndarray] = []

        for m, z in zip(masks, zones):
            if m is None or not m.any():
                continue

            expanded = self._expand_mask(
                m, z, dilation_px=dilation_px if z is None else None
            )
            if not expanded.any():
                continue

            # Check background uniformity (BallonsTranslator check_need_inpaint pattern)
            if z is not None and z.any():
                bg_mask = (z > 0) & (expanded == 0)
            else:
                kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))
                dilated = cv2.dilate(expanded, kernel, iterations=1)
                bg_mask = (dilated > 0) & (expanded == 0)

            bg_pixels = image_np[bg_mask]
            is_uniform = False
            median_color = None

            # Reject faint gradients and texture in any color channel.
            if (
                bg_pixels.shape[0] >= 10
                and np.all(np.std(bg_pixels, axis=0) <= 2.0)
                and np.all(np.ptp(bg_pixels, axis=0) <= 8)
            ):
                is_uniform = True
                median_color = np.median(bg_pixels, axis=0).astype(np.uint8)

            if is_uniform and median_color is not None:
                result_img[expanded > 0] = median_color
            else:
                needs_inpaint_crops.append(expanded)

        if not needs_inpaint_crops:
            return result_img

        try:
            h, w = result_img.shape[:2]
            for crop_mask in needs_inpaint_crops:
                ys, xs = np.where(crop_mask > 0)
                if len(ys) == 0:
                    continue
                x1, x2 = int(xs.min()), int(xs.max()) + 1
                y1, y2 = int(ys.min()), int(ys.max()) + 1

                # Pad crop window by 24px for surrounding texture context
                pad = 24
                cx1 = max(0, x1 - pad)
                cy1 = max(0, y1 - pad)
                cx2 = min(w, x2 + pad)
                cy2 = min(h, y2 + pad)

                crop_img = result_img[cy1:cy2, cx1:cx2]
                crop_m = crop_mask[cy1:cy2, cx1:cx2]

                inpainted_crop = self._inpaint(crop_img, crop_m)
                result_img[cy1:cy2, cx1:cx2] = inpainted_crop
        finally:
            self.release()

        return result_img

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

    def build_text_masks(
        self,
        image_np: np.ndarray,
        bubble_masks: list[np.ndarray],
        text_classes: list[str] | None = None,
    ) -> list[tuple[np.ndarray, np.ndarray]]:
        """
        Convert bubble-level masks into text-only masks.

        Returns a list of (text_mask, safe_zone) pairs.
        - For speech bubbles: safe zone is bubble interior eroded clear of outline.
        - For free text (outside bubbles / SFX): safe zone is the text region itself.
        """
        pairs: list[tuple[np.ndarray, np.ndarray]] = []
        classes = (
            text_classes
            if (text_classes is not None and len(text_classes) == len(bubble_masks))
            else ["text_bubble"] * len(bubble_masks)
        )

        for bubble_mask, t_cls in zip(bubble_masks, classes):
            if t_cls == "manual":
                text_mask = self._extract_text_mask(image_np, bubble_mask, manual=True)
                if text_mask.any():
                    pairs.append((text_mask, (bubble_mask > 0).astype(np.uint8)))
            elif t_cls == "text_free":
                text_mask = self._extract_text_mask(image_np, bubble_mask)
                if not text_mask.any():
                    text_mask = (bubble_mask > 0).astype(np.uint8)
                safe_zone = (bubble_mask > 0).astype(np.uint8)
                pairs.append((text_mask, safe_zone))
            else:
                text_mask = self._extract_text_mask(image_np, bubble_mask)
                if text_mask.any():
                    safe_zone = self._safe_zone(bubble_mask)
                    gray = cv2.cvtColor(image_np, cv2.COLOR_RGB2GRAY)
                    background = np.median(gray[bubble_mask > 0])
                    # Dilation must not reintroduce rejected outlines/artwork.
                    protected = (
                        (np.abs(gray.astype(np.float32) - background) > 32)
                        & (text_mask == 0)
                        & (bubble_mask > 0)
                    ).astype(np.uint8)
                    protected = cv2.dilate(protected, np.ones((3, 3), np.uint8))
                    safe_zone[(protected > 0) & (text_mask == 0)] = 0
                    pairs.append((text_mask, safe_zone))

        return pairs

    @staticmethod
    def _safe_zone(bubble_mask: np.ndarray) -> np.ndarray:
        """Bubble interior shrunk clear of the outline — the only editable area."""
        m = (bubble_mask > 0).astype(np.uint8)
        if not m.any():
            return m

        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        iterations = 1 if int(m.sum()) < 2500 else 3
        zone = cv2.erode(m, kernel, iterations=iterations)
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
        *,
        manual: bool = False,
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

        if manual:
            # ponytail: local median with wider context avoids narrow dark borders on tight crops
            context = cv2.dilate(bubble_mask, np.ones((21, 21), np.uint8))
            pixels = gray[(context > 0) & (bubble_mask == 0)]
            if pixels.size == 0:
                pixels = gray[bubble_mask > 0]
            if pixels.size == 0:
                return np.zeros((h, w), dtype=np.uint8)

            background = float(np.median(pixels))
            box_pixels = gray[bubble_mask > 0]
            if (
                background < 120
                and box_pixels.size > 0
                and float(np.mean(box_pixels)) < 120
            ):
                light_outer = pixels[pixels >= 120]
                if light_outer.size > 0:
                    background = float(np.median(light_outer))

            contrast = background - gray.astype(np.float32)
            if background < 120:
                contrast = -contrast
            foreground = ((contrast > 32) & (bubble_mask > 0)).astype(np.uint8)
            count, labels, stats, _ = cv2.connectedComponentsWithStats(foreground, 8)
            keep = np.zeros(count, dtype=np.uint8)
            keep[1:] = stats[1:, cv2.CC_STAT_AREA] >= 3
            return keep[labels]

        inner_mask = InpaintingEngine._safe_zone(bubble_mask)

        x, y, w_roi, h_roi = cv2.boundingRect(inner_mask)
        if w_roi <= 0 or h_roi <= 0:
            return np.zeros((h, w), dtype=np.uint8)

        gray_roi = gray[y : y + h_roi, x : x + w_roi]
        mask_roi = inner_mask[y : y + h_roi, x : x + w_roi]
        bubble_pixels = gray_roi[mask_roi > 0]
        if bubble_pixels.size == 0:
            return np.zeros((h, w), dtype=np.uint8)

        bg_is_light = float(np.median(bubble_pixels)) >= 120.0
        if bg_is_light:
            percentile_threshold = min(200, int(np.percentile(bubble_pixels, 60)))
            otsu_threshold, _ = cv2.threshold(
                bubble_pixels.astype(np.uint8),
                0,
                255,
                cv2.THRESH_BINARY + cv2.THRESH_OTSU,
            )
            dark_threshold = min(percentile_threshold, int(otsu_threshold))
            foreground_roi = ((gray_roi <= dark_threshold).astype(np.uint8)) * mask_roi
        else:
            percentile_threshold = max(55, int(np.percentile(bubble_pixels, 40)))
            otsu_threshold, _ = cv2.threshold(
                bubble_pixels.astype(np.uint8),
                0,
                255,
                cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU,
            )
            light_threshold = max(percentile_threshold, int(otsu_threshold))
            foreground_roi = ((gray_roi >= light_threshold).astype(np.uint8)) * mask_roi

        cleanup_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        foreground_roi = cv2.morphologyEx(
            foreground_roi, cv2.MORPH_CLOSE, cleanup_kernel, iterations=1
        )

        foreground = np.zeros((h, w), dtype=np.uint8)
        foreground[y : y + h_roi, x : x + w_roi] = foreground_roi

        boundary = (inner_mask > 0) & (
            cv2.erode(inner_mask, cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)))
            == 0
        )

        num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(
            foreground, connectivity=8
        )

        bubble_area = int(inner_mask.sum())
        text_mask = np.zeros((h, w), dtype=np.uint8)

        for label_idx in range(1, num_labels):
            area = int(stats[label_idx, cv2.CC_STAT_AREA])

            if area < 3:
                continue
            if area > int(bubble_area * 0.85):
                continue

            component = labels == label_idx
            if np.any(component & boundary):
                continue

            text_mask = cv2.bitwise_or(text_mask, component.astype(np.uint8))

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
    ) -> np.ndarray:
        """Keep every unmasked pixel exact, including pixels next to the mask."""
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

        return np.where(
            (mask > 0)[..., None],
            np.clip(inpainted_np, 0, 255).astype(np.uint8),
            image_np,
        )

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
