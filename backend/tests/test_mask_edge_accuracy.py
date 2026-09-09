import unittest
from unittest.mock import patch

import cv2
import numpy as np
from synthesis.inpainting import InpaintingEngine


class MaskEdgeAccuracyTests(unittest.TestCase):
    def test_tight_manual_masks_preserve_outside_pixels(self):
        engine = InpaintingEngine(device="cpu")
        for background, foreground in [(255, 0), (0, 255)]:
            with self.subTest(background=background):
                image = np.full((100, 200, 3), background, dtype=np.uint8)
                image[30:50, 60:64] = foreground
                mask = np.zeros((100, 200), dtype=np.uint8)
                mask[30:50, 60:64] = 1
                pairs = engine.build_text_masks(image, [mask], text_classes=["manual"])
                self.assertEqual(len(pairs), 1)
                text, zone = pairs[0]
                preview = engine._combine_masks(mask.shape, [text], 12, [zone])
                with patch.object(engine, "_lama_available", False):
                    result = engine.process_blocks(image, [text], safe_zones=[zone])
                self.assertTrue(np.all(preview[mask > 0] > 0))
                self.assertFalse(preview[mask == 0].any())
                np.testing.assert_array_equal(result[mask == 0], image[mask == 0])
                self.assertTrue(np.all(result[mask > 0] == background))
                blank = np.full_like(image, background)
                self.assertEqual(
                    engine.build_text_masks(blank, [mask], text_classes=["manual"]), []
                )

    def test_small_bubble_safe_zone_keeps_detected_edge_glyph(self):
        image = np.full((64, 64, 3), 255, dtype=np.uint8)
        bubble = np.zeros((64, 64), dtype=np.uint8)
        bubble[10:50, 10:50] = 1
        cv2.rectangle(image, (10, 10), (49, 49), (0, 0, 0), 2)
        image[22:38, 14:18] = 0
        glyph = np.zeros_like(bubble, dtype=bool)
        glyph[22:38, 14:18] = True
        engine = InpaintingEngine(device="cpu")
        pairs = engine.build_text_masks(image, [bubble])
        self.assertEqual(len(pairs), 1)
        text, zone = pairs[0]
        self.assertTrue(np.all(text[glyph] > 0))
        expanded = engine._expand_mask(text, zone)
        self.assertTrue(np.all(expanded[glyph] > 0))
        self.assertFalse(expanded[10:12, 10:50].any())
        self.assertFalse(expanded[bubble == 0].any())


if __name__ == "__main__":
    unittest.main()
