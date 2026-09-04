import unittest

import cv2
import numpy as np

from synthesis.inpainting import InpaintingEngine
from synthesis.typesetting import TypesettingEngine
from job_errors import clean_ocr_error_detail, ocr_failure_message


class TypesettingRegressionTests(unittest.TestCase):
    def test_default_typesetting_font_prefers_itim(self) -> None:
        engine = TypesettingEngine()

        self.assertIsNotNone(engine.font_path)
        self.assertTrue(str(engine.font_path).endswith("Itim-Regular.ttf"))

    def test_fit_text_layout_never_returns_vertical_overflow(self) -> None:
        engine = TypesettingEngine()
        text = "ฉันไม่ได้โกรธนะ แต่เรื่องนี้มันต้องคุยกันดี ๆ ก่อนจริง ๆ"

        _, _, lines, line_height, total_height = engine._fit_text_layout(
            text=text,
            target_w=90,
            target_h=32,
            preferred_font_size=None,
        )

        self.assertTrue(lines)
        self.assertLessEqual(total_height, 32)
        self.assertLessEqual(line_height * len(lines), 32)

    def test_clip_lines_to_height_ellipsizes_last_line(self) -> None:
        engine = TypesettingEngine()
        font = engine._load_font(12)
        line_height = engine._line_height(font)

        lines = ["บรรทัดแรก", "บรรทัดที่สองยาวมากจนควรถูกตัด", "บรรทัดสาม"]
        clipped = engine._clip_lines_to_height(
            lines=lines,
            font=font,
            line_height=line_height,
            max_width=80,
            max_height=line_height * 2,
        )

        self.assertEqual(len(clipped), 2)
        self.assertTrue(clipped[-1] == "" or clipped[-1].endswith("…"))

    def test_list_available_fonts_and_resolution(self) -> None:
        engine = TypesettingEngine()
        fonts = engine.list_available_fonts()
        self.assertTrue(any(f["name"] == "Itim-Regular.ttf" for f in fonts))

        path = engine.resolve_font_path("Itim-Regular.ttf")
        self.assertTrue(path.endswith("Itim-Regular.ttf"))

        with self.assertRaises(ValueError):
            engine.resolve_font_path("../secret.ttf")

        with self.assertRaises(ValueError):
            engine.resolve_font_path("NonExistentFont.ttf")

    def test_compute_layout_auto_fit_and_alignment(self) -> None:
        engine = TypesettingEngine()
        layout = engine.compute_layout(
            text="สวัสดี\nโลก",
            target_w=100,
            target_h=100,
            target_box=(10, 10, 110, 110),
            text_align="left",
            font_size=24,
            auto_fit=True,
        )
        self.assertEqual(layout.lines, ["สวัสดี", "โลก"])
        self.assertEqual(layout.text_align, "left")
        self.assertFalse(layout.overflow)

    def test_compute_layout_overflow_and_truncation_when_disabled(self) -> None:
        engine = TypesettingEngine()
        long_text = "ข้อความยาวมาก ๆ " * 10
        layout = engine.compute_layout(
            text=long_text,
            target_w=30,
            target_h=20,
            target_box=(0, 0, 30, 20),
            font_size=40,
            auto_fit=False,
        )
        self.assertTrue(layout.overflow)
        self.assertTrue(layout.truncated)

    def test_preview_crop_and_render_parity(self) -> None:
        from synthesis.typesetting import TypesetBlock
        engine = TypesettingEngine()
        base_img = np.full((200, 200, 3), 255, dtype=np.uint8)
        block = TypesetBlock(
            id="b1",
            box=(20, 20, 160, 160),
            text="ข้อความทดสอบ พรีวิว",
            font_name="Itim-Regular.ttf",
            font_size=20,
            auto_fit=True,
            text_align="center",
        )

        crop_img, bounds_px, layout = engine.render_block_preview_crop(block, base_img.shape[:2])
        self.assertIsNotNone(crop_img)
        self.assertEqual(bounds_px[2], crop_img.width)
        self.assertEqual(bounds_px[3], crop_img.height)
        self.assertFalse(layout.overflow)
        crop_np = np.array(crop_img)
        self.assertGreater(int(np.sum(crop_np[:, :, 3] > 0)), 0)


class InpaintingRegressionTests(unittest.TestCase):
    def test_extract_text_mask_detects_dark_glyphs_inside_bubble(self) -> None:
        image = np.full((120, 120, 3), 255, dtype=np.uint8)
        bubble_mask = np.zeros((120, 120), dtype=np.uint8)
        cv2.rectangle(bubble_mask, (20, 20), (100, 100), 1, thickness=-1)

        cv2.rectangle(image, (35, 40), (45, 75), (0, 0, 0), thickness=-1)
        cv2.rectangle(image, (55, 40), (65, 75), (0, 0, 0), thickness=-1)
        cv2.rectangle(image, (75, 40), (85, 75), (0, 0, 0), thickness=-1)

        text_mask = InpaintingEngine._extract_text_mask(image, bubble_mask)

        self.assertGreater(int(text_mask.sum()), 0)
        self.assertEqual(text_mask.shape, bubble_mask.shape)
        self.assertEqual(int(text_mask[0:10, 0:10].sum()), 0)

    def test_extract_text_mask_keeps_small_punctuation_inside_bubble(self) -> None:
        image = np.full((80, 80, 3), 255, dtype=np.uint8)
        bubble_mask = np.zeros((80, 80), dtype=np.uint8)
        cv2.rectangle(bubble_mask, (10, 10), (70, 70), 1, thickness=-1)

        image[38:40, 40:42] = (0, 0, 0)

        text_mask = InpaintingEngine._extract_text_mask(image, bubble_mask)

        self.assertGreater(int(text_mask[37:41, 39:43].sum()), 0)

    def test_composite_inpainted_preserves_unmasked_model_noise(self) -> None:
        original = np.full((40, 40, 3), 100, dtype=np.uint8)
        noisy_model_output = np.full((40, 40, 3), 200, dtype=np.uint8)
        mask = np.zeros((40, 40), dtype=np.uint8)
        mask[15:25, 15:25] = 1

        result = InpaintingEngine._composite_inpainted(
            original,
            noisy_model_output,
            mask,
        )

        np.testing.assert_array_equal(result[0, 0], original[0, 0])
        np.testing.assert_array_equal(result[20, 20], noisy_model_output[20, 20])

    def test_composite_inpainted_resizes_mismatched_model_output(self) -> None:
        original = np.full((40, 40, 3), 100, dtype=np.uint8)
        resized_model_output = np.full((40, 38, 3), 200, dtype=np.uint8)
        mask = np.ones((40, 40), dtype=np.uint8)

        result = InpaintingEngine._composite_inpainted(
            original,
            resized_model_output,
            mask,
        )

        self.assertEqual(result.shape, original.shape)
        np.testing.assert_array_equal(result[20, 20], [200, 200, 200])


class OcrErrorHandlingTests(unittest.TestCase):
    def test_repeated_ocr_error_markers_become_clear_failure_detail(self) -> None:
        detail = clean_ocr_error_detail(
            "Error during OCR: --- Error during OCR: --- Error during OCR:"
        )

        self.assertEqual(detail, "OCR service returned repeated failure markers.")

    def test_ocr_failure_message_states_translation_stopped(self) -> None:
        message = ocr_failure_message("Error during OCR: connection refused")

        self.assertIn("OCR failed.", message)
        self.assertIn("Translation stopped before the next stage.", message)
        self.assertIn("connection refused", message)

    def test_ocr_semaphore_initialization(self) -> None:
        from main import get_ocr_semaphore, OCR_CONCURRENCY
        sem = get_ocr_semaphore()
        self.assertIsNotNone(sem)
        self.assertGreaterEqual(OCR_CONCURRENCY, 1)


if __name__ == "__main__":
    unittest.main()
