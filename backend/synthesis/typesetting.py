from __future__ import annotations

import math
import re
import unicodedata
from pathlib import Path
from typing import Callable, List, Tuple

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from pydantic import BaseModel, ConfigDict


class TypesetBlock(BaseModel):
    id: str
    box: Tuple[int, int, int, int]  # x, y, w, h
    text: str
    font_name: str | None = None
    font_size: int | None = None
    auto_fit: bool = True
    text_align: str = "center"  # left, center, right
    padding_ratio: float = 0.10
    color: str = "black"
    mask: np.ndarray | None = None  # HxW binary mask of the bubble region

    model_config = ConfigDict(arbitrary_types_allowed=True)


class TypesetLayout(BaseModel):
    lines: List[str]
    font_path: str
    font_size: int
    requested_font_size: int | None = None
    line_height: int
    total_height: int
    target_box: Tuple[int, int, int, int]  # target_x1, target_y1, target_x2, target_y2
    text_align: str = "center"
    color: str = "black"
    auto_shrunk: bool = False
    overflow: bool = False
    truncated: bool = False

    model_config = ConfigDict(arbitrary_types_allowed=True)


class TypesettingEngine:
    """
    Renders translated text into manga speech bubbles.

    Goals
    -----
    1. Auto-fit text so it stays inside the bubble box.
    2. Wrap Thai text more safely than naive character splitting.
    3. Apply "bubble fencing" by clipping the rendered text to the bubble mask
       (or, if no mask is available, to the rectangular box).
    """

    def __init__(self, font_path: str | None = None):
        base_dir = Path(__file__).resolve().parent.parent
        fonts_dir = base_dir / "assets" / "fonts"

        preferred_fonts: List[Path] = []
        if font_path:
            preferred_fonts.append(Path(font_path))
        preferred_fonts.extend(
            [
                fonts_dir / "Itim-Regular.ttf",
                fonts_dir / "NotoSansThai-Regular.ttf",
                fonts_dir / "Iannnnn-COW-Regular.ttf",
            ]
        )

        self.font_path: str | None = None
        for candidate in preferred_fonts:
            if candidate.exists():
                self.font_path = str(candidate)
                break

        self.default_font_size = 20
        self.min_font_size = 8
        self.max_font_size = 72
        self.padding_ratio = 0.10
        self.line_gap_ratio = 0.18
        self._thai_word_tokenize = self._load_thai_tokenizer()

    @property
    def fonts_dir(self) -> Path:
        base_dir = Path(__file__).resolve().parent.parent
        return base_dir / "assets" / "fonts"

    def list_available_fonts(self) -> List[dict[str, str]]:
        fonts: List[dict[str, str]] = []
        if self.fonts_dir.exists():
            for font_file in sorted(self.fonts_dir.glob("*.[tT][tT][fF]")):
                name = font_file.name
                label = name.rsplit(".", 1)[0].replace("-", " ").replace("_", " ")
                fonts.append({"name": name, "label": label})
        return fonts

    def resolve_font_path(self, font_name: str | None = None) -> str:
        if font_name is not None:
            safe_name = Path(font_name).name
            if safe_name != font_name or "/" in font_name or "\\" in font_name:
                raise ValueError(f"Invalid font name: '{font_name}'")
            candidate = self.fonts_dir / safe_name
            if not candidate.exists():
                raise ValueError(f"Requested font '{font_name}' does not exist.")
            return str(candidate)

        if self.font_path:
            return self.font_path
        raise ValueError("No font available in system.")

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def compute_layout(
        self,
        text: str,
        target_w: int,
        target_h: int,
        target_box: Tuple[int, int, int, int],
        font_name: str | None = None,
        font_size: int | None = None,
        auto_fit: bool = True,
        text_align: str = "center",
        color: str = "black",
    ) -> TypesetLayout:
        normalized = self._normalize_text(text)
        font_path = self.resolve_font_path(font_name)

        if not normalized.strip() or target_w <= 0 or target_h <= 0:
            return TypesetLayout(
                lines=[],
                font_path=font_path,
                font_size=font_size or self.default_font_size,
                requested_font_size=font_size,
                line_height=self._line_height(self._load_font(self.default_font_size, font_path)),
                total_height=0,
                target_box=target_box,
                text_align=text_align,
                color=color,
                auto_shrunk=False,
                overflow=False,
                truncated=False,
            )

        if auto_fit:
            start = (
                min(self.max_font_size, max(self.min_font_size, font_size))
                if font_size is not None
                else self.max_font_size
            )
            stop = self.min_font_size

            best_layout: TypesetLayout | None = None
            best_overflow_score = float("inf")

            for size in range(start, stop - 1, -1):
                font = self._load_font(size, font_path)
                force_b = size == stop
                wrap_strategies: list[
                    Callable[[str, ImageFont.FreeTypeFont | ImageFont.ImageFont, int], List[str]]
                ] = [
                    lambda t, f, w, fb=force_b: self._wrap_text(t, f, w, force_break=fb),
                    lambda t, f, w, fb=force_b: self._wrap_text_compact(t, f, w, force_break=fb),
                ]

                for wrap_strategy in wrap_strategies:
                    lines = wrap_strategy(normalized, font, target_w)
                    if not lines:
                        continue

                    if any(self._line_width(font, line) > target_w for line in lines):
                        continue

                    line_height = self._line_height(font)
                    total_height = line_height * len(lines)
                    overflow_score = max(0, total_height - target_h)

                    if total_height <= target_h:
                        auto_shrunk = (font_size is not None and size < font_size) or (
                            font_size is None and size < self.default_font_size
                        )
                        return TypesetLayout(
                            lines=lines,
                            font_path=font_path,
                            font_size=size,
                            requested_font_size=font_size,
                            line_height=line_height,
                            total_height=total_height,
                            target_box=target_box,
                            text_align=text_align,
                            color=color,
                            auto_shrunk=auto_shrunk,
                            overflow=False,
                            truncated=False,
                        )

                    if overflow_score < best_overflow_score:
                        best_overflow_score = overflow_score
                        best_layout = TypesetLayout(
                            lines=lines,
                            font_path=font_path,
                            font_size=size,
                            requested_font_size=font_size,
                            line_height=line_height,
                            total_height=total_height,
                            target_box=target_box,
                            text_align=text_align,
                            color=color,
                            auto_shrunk=True,
                            overflow=True,
                            truncated=False,
                        )

            if best_layout is not None:
                return best_layout

            # Reached min size without fitting vertically
            font = self._load_font(self.min_font_size, font_path)
            lines = self._wrap_text(normalized, font, target_w, force_break=True)
            line_height = self._line_height(font)
            clipped_lines = self._clip_lines_to_height(
                lines, font, line_height, target_w, target_h
            )
            truncated = (len(clipped_lines) < len(lines)) or any(
                c != o for c, o in zip(clipped_lines, lines, strict=False)
            )
            return TypesetLayout(
                lines=clipped_lines,
                font_path=font_path,
                font_size=self.min_font_size,
                requested_font_size=font_size,
                line_height=line_height,
                total_height=min(target_h, line_height * len(clipped_lines)),
                target_box=target_box,
                text_align=text_align,
                color=color,
                auto_shrunk=True,
                overflow=True,
                truncated=truncated,
            )
        else:
            size = (
                min(self.max_font_size, max(self.min_font_size, font_size))
                if font_size is not None
                else self.default_font_size
            )
            font = self._load_font(size, font_path)
            lines = self._wrap_text(normalized, font, target_w, force_break=True)
            line_height = self._line_height(font)
            total_height = line_height * len(lines)
            overflow = (total_height > target_h) or any(
                self._line_width(font, line) > target_w for line in lines
            )
            clipped_lines = self._clip_lines_to_height(
                lines, font, line_height, target_w, target_h
            )
            truncated = (len(clipped_lines) < len(lines)) or any(
                c != o for c, o in zip(clipped_lines, lines, strict=False)
            )
            return TypesetLayout(
                lines=clipped_lines,
                font_path=font_path,
                font_size=size,
                requested_font_size=font_size,
                line_height=line_height,
                total_height=min(target_h, total_height),
                target_box=target_box,
                text_align=text_align,
                color=color,
                auto_shrunk=False,
                overflow=overflow,
                truncated=truncated,
            )

    def draw_layout_overlay(
        self,
        layout: TypesetLayout,
        canvas_shape: tuple[int, int],
        clip_mask: np.ndarray | None = None,
    ) -> Image.Image:
        """
        Draw lines of text onto a transparent RGBA image matching canvas_shape (H, W).
        If clip_mask is provided (H, W uint8 binary mask), text is masked to that region.
        """
        h, w = canvas_shape
        overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)

        if not layout.lines:
            return overlay

        font = self._load_font(layout.font_size, layout.font_path)
        tx1, ty1, tx2, ty2 = layout.target_box
        box_w = max(1, tx2 - tx1)
        box_h = max(1, ty2 - ty1)

        # Vertical center within the target box
        start_y = ty1 + max(0, (box_h - layout.total_height) // 2)

        current_y = start_y
        for line in layout.lines:
            line_w = self._line_width(font, line)
            if layout.text_align == "left":
                draw_x = tx1
                anchor = "la"
                align = "left"
            elif layout.text_align == "right":
                draw_x = tx2
                anchor = "ra"
                align = "right"
            else:
                draw_x = tx1 + (box_w // 2)
                anchor = "ma"
                align = "center"

            for x_offset, y_offset, shadow_color in [
                (-1, 0, "white"),
                (1, 0, "white"),
                (0, -1, "white"),
                (0, 1, "white"),
            ]:
                draw.text(
                    (draw_x + x_offset, current_y + y_offset),
                    line,
                    font=font,
                    fill=shadow_color,
                    anchor=anchor,
                    align=align,
                )

            draw.text(
                (draw_x, current_y),
                line,
                font=font,
                fill=layout.color,
                anchor=anchor,
                align=align,
            )
            current_y += layout.line_height

        if clip_mask is not None:
            overlay_np = np.array(overlay)
            alpha = overlay_np[:, :, 3]
            clip_u8 = clip_mask.astype(np.uint8) * 255
            alpha = cv2.bitwise_and(alpha, clip_u8)
            overlay_np[:, :, 3] = alpha
            overlay = Image.fromarray(overlay_np, mode="RGBA")

        return overlay

    def _prepare_block_geometry(
        self, shape: tuple[int, int], block: TypesetBlock
    ) -> tuple[np.ndarray | None, Tuple[int, int, int, int], Tuple[int, int, int, int]]:
        """
        Calculate clip mask, fence box (fx1, fy1, fx2, fy2), and padded target box (tx1, ty1, tx2, ty2).
        """
        h, w = shape
        x, y, bw, bh = block.box
        clip_mask = self._build_clip_mask(shape, block)
        fence_box = self._mask_bounds(clip_mask)
        if fence_box is None:
            fence_box = (max(0, x), max(0, y), min(w, x + bw), min(h, y + bh))

        fx1, fy1, fx2, fy2 = fence_box
        fence_w = max(1, fx2 - fx1)
        fence_h = max(1, fy2 - fy1)

        padding_ratio = (
            block.padding_ratio
            if block.padding_ratio is not None
            else self.padding_ratio
        )
        pad_x = max(4, int(fence_w * padding_ratio))
        pad_y = max(4, int(fence_h * padding_ratio))

        target_x1 = fx1 + pad_x
        target_y1 = fy1 + pad_y
        target_x2 = fx2 - pad_x
        target_y2 = fy2 - pad_y

        if target_x2 <= target_x1 or target_y2 <= target_y1:
            target_x1, target_y1, target_x2, target_y2 = fx1, fy1, fx2, fy2

        target_box = (target_x1, target_y1, target_x2, target_y2)
        return clip_mask, fence_box, target_box

    def render_block_preview_crop(
        self, block: TypesetBlock, shape: tuple[int, int]
    ) -> tuple[Image.Image, Tuple[int, int, int, int], TypesetLayout]:
        h, w = shape
        bx, by, bw, bh = block.box
        text = self._normalize_text(block.text)

        clip_mask, fence_box, target_box = self._prepare_block_geometry(shape, block)
        fx1, fy1, fx2, fy2 = fence_box
        target_x1, target_y1, target_x2, target_y2 = target_box
        target_w = max(1, target_x2 - target_x1)
        target_h = max(1, target_y2 - target_y1)

        if not text.strip() or bw <= 4 or bh <= 4:
            font_path = self.resolve_font_path(block.font_name)
            empty_layout = TypesetLayout(
                lines=[],
                font_path=font_path,
                font_size=block.font_size or self.default_font_size,
                requested_font_size=block.font_size,
                line_height=self._line_height(self._load_font(self.default_font_size, font_path)),
                total_height=0,
                target_box=target_box,
                text_align=block.text_align,
                color=block.color,
                auto_shrunk=False,
                overflow=False,
                truncated=False,
            )
            margin = 4
            cx1 = max(0, fx1 - margin)
            cy1 = max(0, fy1 - margin)
            cx2 = min(w, fx2 + margin)
            cy2 = min(h, fy2 + margin)
            crop_w = max(1, cx2 - cx1)
            crop_h = max(1, cy2 - cy1)
            crop_image = Image.new("RGBA", (crop_w, crop_h), (0, 0, 0, 0))
            return crop_image, (cx1, cy1, crop_w, crop_h), empty_layout

        layout = self.compute_layout(
            text=block.text,
            target_w=target_w,
            target_h=target_h,
            target_box=target_box,
            font_name=block.font_name,
            font_size=block.font_size,
            auto_fit=block.auto_fit,
            text_align=block.text_align,
            color=block.color,
        )

        full_overlay = self.draw_layout_overlay(layout, shape, clip_mask=clip_mask)

        # Crop around fence box with 4px margin
        margin = 4
        cx1 = max(0, fx1 - margin)
        cy1 = max(0, fy1 - margin)
        cx2 = min(w, fx2 + margin)
        cy2 = min(h, fy2 + margin)

        crop_w = max(1, cx2 - cx1)
        crop_h = max(1, cy2 - cy1)
        crop_image = full_overlay.crop((cx1, cy1, cx2, cy2))
        bounds_px = (cx1, cy1, crop_w, crop_h)

        return crop_image, bounds_px, layout

    def render(self, base_image: np.ndarray, blocks: List[TypesetBlock]) -> np.ndarray:
        """
        Render all translated blocks on the image.

        Strategy:
        - layout text inside each bubble/box
        - draw text on a transparent overlay
        - clip overlay to the bubble mask (bubble fencing)
        - alpha-composite onto the base image
        """
        base_rgba = Image.fromarray(base_image.astype(np.uint8)).convert("RGBA")
        h, w = base_image.shape[:2]

        for block in blocks:
            text = self._normalize_text(block.text)
            if not text.strip():
                continue

            bx, by, bw, bh = block.box
            if bw <= 4 or bh <= 4:
                continue

            clip_mask, fence_box, target_box = self._prepare_block_geometry((h, w), block)
            target_x1, target_y1, target_x2, target_y2 = target_box
            target_w = max(1, target_x2 - target_x1)
            target_h = max(1, target_y2 - target_y1)

            layout = self.compute_layout(
                text=block.text,
                target_w=target_w,
                target_h=target_h,
                target_box=target_box,
                font_name=block.font_name,
                font_size=block.font_size,
                auto_fit=block.auto_fit,
                text_align=block.text_align,
                color=block.color,
            )

            overlay = self.draw_layout_overlay(layout, (h, w), clip_mask=clip_mask)
            base_rgba = Image.alpha_composite(base_rgba, overlay)

        return np.array(base_rgba.convert("RGB"))

    def _fit_text_layout(
        self,
        text: str,
        target_w: int,
        target_h: int,
        preferred_font_size: int | None = None,
    ) -> tuple[int, ImageFont.FreeTypeFont | ImageFont.ImageFont, List[str], int, int]:
        layout = self.compute_layout(
            text=text,
            target_w=target_w,
            target_h=target_h,
            target_box=(0, 0, target_w, target_h),
            font_size=preferred_font_size,
            auto_fit=True,
        )
        font = self._load_font(layout.font_size, layout.font_path)
        return (
            layout.font_size,
            font,
            layout.lines,
            layout.line_height,
            layout.total_height,
        )

    def _wrap_text(
        self,
        text: str,
        font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
        max_width: int,
        force_break: bool = True,
    ) -> List[str]:
        """
        Wrap text by Thai-aware token groups first, then fall back to grapheme-like
        clusters so we avoid breaking before Thai combining marks.
        """
        paragraphs = [p.strip() for p in text.split("\n")]
        all_lines: List[str] = []

        for paragraph in paragraphs:
            if not paragraph:
                all_lines.append("")
                continue

            tokens = self._tokenize_for_wrap(paragraph)
            current = ""

            for token in tokens:
                candidate = token if not current else current + token

                if self._line_width(font, candidate) <= max_width:
                    current = candidate
                    continue

                if current:
                    all_lines.append(current.strip())
                    current = ""

                # Token itself may still be too wide, so split by safe clusters.
                if self._line_width(font, token) <= max_width:
                    current = token.lstrip()
                    continue

                if not force_break:
                    return []

                sublines = self._split_oversized_token(token, font, max_width)
                if not sublines:
                    continue

                all_lines.extend(sublines[:-1])
                current = sublines[-1]

            if current:
                all_lines.append(current.strip())

        return [line for line in all_lines if line is not None]

    def _wrap_text_compact(
        self,
        text: str,
        font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
        max_width: int,
        force_break: bool = True,
    ) -> List[str]:
        """
        More aggressive fallback wrap.
        Keeps Thai marks attached to their base character and trims spaces.
        """
        clusters = self._graphemeish_clusters(text)
        lines: List[str] = []
        current = ""

        for cluster in clusters:
            if cluster == "\n":
                if current:
                    lines.append(current.strip())
                    current = ""
                else:
                    lines.append("")
                continue

            candidate = cluster if not current else current + cluster
            if self._line_width(font, candidate) <= max_width:
                current = candidate
            else:
                if not force_break:
                    return []
                if current:
                    lines.append(current.strip())
                current = cluster.lstrip()

        if current:
            lines.append(current.strip())

        return lines

    # ------------------------------------------------------------------
    # Bubble fencing
    # ------------------------------------------------------------------

    def _build_clip_mask(
        self, shape: tuple[int, int], block: TypesetBlock
    ) -> np.ndarray:
        """
        Create the mask that fences text drawing.

        Priority:
        1. use the bubble segmentation mask if present
        2. otherwise use the rectangular bounding box
        """
        h, w = shape
        x, y, bw, bh = block.box

        if block.mask is not None and isinstance(block.mask, np.ndarray):
            mask = (block.mask > 0).astype(np.uint8)
            if mask.shape == (h, w) and int(mask.sum()) > 0:
                # Erode a bit so text stays away from the bubble outline.
                kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
                inner = cv2.erode(mask, kernel, iterations=1)
                if int(inner.sum()) > 0:
                    return inner
                return mask

        rect_mask = np.zeros((h, w), dtype=np.uint8)
        x1 = max(0, x)
        y1 = max(0, y)
        x2 = min(w, x + bw)
        y2 = min(h, y + bh)
        rect_mask[y1:y2, x1:x2] = 1
        return rect_mask

    @staticmethod
    def _mask_bounds(mask: np.ndarray) -> tuple[int, int, int, int] | None:
        ys, xs = np.where(mask > 0)
        if len(xs) == 0 or len(ys) == 0:
            return None
        return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1

    # ------------------------------------------------------------------
    # Text helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _normalize_text(text: str) -> str:
        text = text.replace("\r\n", "\n").replace("\r", "\n")
        text = re.sub(r"[ \t]+", " ", text)
        text = re.sub(r"\n{3,}", "\n\n", text)
        return text.strip()

    def _tokenize_for_wrap(self, text: str) -> List[str]:
        """
        Tokenize while preserving spaces as attachable tokens.
        For Thai text without spaces, we later fall back to safe cluster splitting.
        """
        pieces = re.findall(r"\S+|\s+", text)
        tokens: List[str] = []

        for piece in pieces:
            if piece.isspace():
                if tokens:
                    tokens.append(" ")
                continue

            if self._looks_like_thai(piece):
                thai_units = self._thai_wordish_units(piece)
                if thai_units:
                    if tokens and tokens[-1] != " ":
                        pass
                    for idx, unit in enumerate(thai_units):
                        tokens.append(unit)
                else:
                    tokens.append(piece)
            else:
                tokens.append(piece)

        return tokens

    @staticmethod
    def _looks_like_thai(text: str) -> bool:
        return any("\u0e00" <= ch <= "\u0e7f" for ch in text)

    def _thai_wordish_units(self, text: str) -> List[str]:
        """
        Prefer dictionary-aware Thai segmentation when available.
        Fall back to punctuation-aware grapheme chunking when the runtime does
        not have pythainlp or tokenization fails.
        """
        parts = re.split(r"([,./!?(){}\[\]\"'“”‘’\-–—])", text)
        units: List[str] = []

        for part in parts:
            if not part:
                continue
            if len(part) == 1 and re.match(r"[,./!?(){}\[\]\"'“”‘’\-–—]", part):
                units.append(part)
                continue

            if self._thai_word_tokenize is not None:
                try:
                    tokenized = [
                        token
                        for token in self._thai_word_tokenize(part)
                        if token and not token.isspace()
                    ]
                    if tokenized:
                        units.extend(tokenized)
                        continue
                except Exception:
                    pass

            clusters = self._graphemeish_clusters(part)
            if not clusters:
                continue

            # Group clusters into small Thai chunks to reduce broken words
            # but still allow wrapping in narrow bubbles.
            current = ""
            current_chars = 0
            for cluster in clusters:
                current += cluster
                current_chars += 1
                if current_chars >= 6:
                    units.append(current)
                    current = ""
                    current_chars = 0
            if current:
                units.append(current)

        return units

    def _split_oversized_token(
        self,
        token: str,
        font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
        max_width: int,
    ) -> List[str]:
        clusters = self._graphemeish_clusters(token)
        lines: List[str] = []
        current = ""

        for cluster in clusters:
            candidate = cluster if not current else current + cluster
            if self._line_width(font, candidate) <= max_width:
                current = candidate
            else:
                if current:
                    lines.append(current.strip())
                current = cluster.lstrip()

        if current:
            lines.append(current.strip())

        return lines

    @staticmethod
    def _graphemeish_clusters(text: str) -> List[str]:
        """
        Approximate grapheme cluster splitting.
        Keeps combining marks, tone marks, and Thai dependent vowels attached
        to the previous base character.
        """
        clusters: List[str] = []
        current = ""

        for ch in text:
            if ch == "\n":
                if current:
                    clusters.append(current)
                    current = ""
                clusters.append("\n")
                continue

            if not current:
                current = ch
                continue

            if TypesettingEngine._is_combining_or_modifier(ch):
                current += ch
            else:
                clusters.append(current)
                current = ch

        if current:
            clusters.append(current)

        return clusters

    @staticmethod
    def _load_thai_tokenizer() -> Callable[[str], List[str]] | None:
        try:
            from pythainlp.tokenize import word_tokenize

            return lambda text: word_tokenize(
                text,
                engine="newmm",
                keep_whitespace=False,
            )
        except Exception:
            return None

    def _clip_lines_to_height(
        self,
        lines: List[str],
        font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
        line_height: int,
        max_width: int,
        max_height: int,
    ) -> List[str]:
        if not lines:
            return []

        max_lines = max(1, max_height // max(1, line_height))
        if len(lines) <= max_lines:
            return lines

        clipped = lines[:max_lines]
        clipped[-1] = self._ellipsize_line(clipped[-1], font, max_width)
        return clipped

    def _ellipsize_line(
        self,
        text: str,
        font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
        max_width: int,
    ) -> str:
        ellipsis = "…"
        if self._line_width(font, text) <= max_width:
            return text
        if self._line_width(font, ellipsis) > max_width:
            return ""

        trimmed = text.rstrip()
        while trimmed and self._line_width(font, trimmed + ellipsis) > max_width:
            clusters = self._graphemeish_clusters(trimmed)
            if not clusters:
                break
            trimmed = "".join(clusters[:-1]).rstrip()

        return (trimmed + ellipsis).strip()

    @staticmethod
    def _is_combining_or_modifier(ch: str) -> bool:
        code = ord(ch)
        if unicodedata.combining(ch) != 0:
            return True

        # Thai combining marks / vowels / tone marks range coverage.
        if 0x0E31 <= code <= 0x0E3A:
            return True
        if 0x0E47 <= code <= 0x0E4E:
            return True

        return False

    # ------------------------------------------------------------------
    # Font / metrics helpers
    # ------------------------------------------------------------------

    def _load_font(
        self, size: int, font_path: str | None = None
    ) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
        path = font_path or self.font_path
        if path:
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                pass
        return ImageFont.load_default()

    @staticmethod
    def _text_bbox(
        font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
        text: str,
    ) -> tuple[int, int, int, int]:
        if not text:
            return (0, 0, 0, 0)
        bbox = font.getbbox(text)
        return int(bbox[0]), int(bbox[1]), int(bbox[2]), int(bbox[3])

    def _line_width(
        self,
        font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
        text: str,
    ) -> int:
        bbox = self._text_bbox(font, text)
        return max(0, bbox[2] - bbox[0])

    def _line_height(
        self,
        font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
    ) -> int:
        bbox = self._text_bbox(font, "กAyปุ๊ฎ")
        base_h = max(1, bbox[3] - bbox[1])
        gap = max(1, int(math.ceil(base_h * self.line_gap_ratio)))
        return base_h + gap

    @staticmethod
    def _color_to_rgba(color: str) -> tuple[int, int, int, int]:
        named = {
            "black": (0, 0, 0, 255),
            "white": (255, 255, 255, 255),
            "red": (255, 0, 0, 255),
            "blue": (0, 0, 255, 255),
            "green": (0, 128, 0, 255),
        }
        return named.get(color.lower(), (0, 0, 0, 255))
