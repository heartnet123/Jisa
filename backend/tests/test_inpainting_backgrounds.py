import unittest
from unittest.mock import patch

import numpy as np

from synthesis.inpainting import InpaintingEngine


class InpaintingBackgroundTests(unittest.TestCase):
    def test_composite_preserves_every_unmasked_pixel(self):
        original = np.full((40, 40, 3), 100, dtype=np.uint8)
        mask = np.zeros((40, 40), dtype=np.uint8)
        mask[15:25, 15:25] = 1
        result = InpaintingEngine._composite_inpainted(
            original, np.full_like(original, 200), mask
        )
        np.testing.assert_array_equal(result[mask == 0], original[mask == 0])
        self.assertTrue(np.all(result[mask > 0] == 200))

    def test_nonuniform_backgrounds_use_inpaint_and_preserve_exterior(self):
        gradient = np.broadcast_to(
            np.linspace(190, 220, 80, dtype=np.uint8)[None, :, None], (80, 80, 3)
        ).copy()
        texture = np.full_like(gradient, 200)
        texture[::2, ::2] = 212
        color_texture = np.full_like(gradient, 200)
        color_texture[::2, ::2, 0] = 212
        for background in (gradient, texture, color_texture):
            with self.subTest(background=background[0, 0].tolist()):
                image = background.copy()
                mask = np.zeros((80, 80), dtype=np.uint8)
                mask[35:45, 35:45] = 1
                image[mask > 0] = 0
                zone = np.zeros_like(mask)
                zone[20:60, 20:60] = 1
                engine = InpaintingEngine(device="cpu")
                engine._lama_available = False
                expanded = engine._expand_mask(mask, zone)
                with patch.object(
                    engine,
                    "_inpaint_opencv",
                    side_effect=lambda crop, _: np.full_like(crop, 123),
                ):
                    result = engine.process_blocks(image, [mask], safe_zones=[zone])
                self.assertTrue(np.all(result[mask > 0] == 123))
                np.testing.assert_array_equal(
                    result[expanded == 0], image[expanded == 0]
                )
                np.testing.assert_array_equal(image[mask == 0], background[mask == 0])

    def test_solid_backgrounds_fill_actual_color_without_model(self):
        for color in ((255, 255, 255), (0, 0, 0), (120, 135, 145)):
            with self.subTest(color=color):
                image = np.empty((80, 80, 3), dtype=np.uint8)
                image[:] = color
                mask = np.zeros((80, 80), dtype=np.uint8)
                mask[35:45, 35:45] = 1
                image[mask > 0] = (255, 0, 255)
                before = image.copy()
                engine = InpaintingEngine(device="cpu")
                with patch.object(
                    engine,
                    "_inpaint",
                    side_effect=AssertionError("solid fill must not load model"),
                ):
                    result = engine.process_blocks(image, [mask], dilation_px=2)
                self.assertTrue(np.all(result == color))
                np.testing.assert_array_equal(image, before)

    def test_extract_text_mask_rejects_boundary_border_fragments(self):
        engine = InpaintingEngine(device="cpu")
        h, w = 100, 100
        image = np.full((h, w, 3), 255, dtype=np.uint8)

        # Bubble mask (rectangular or irregular)
        mask = np.zeros((h, w), dtype=np.uint8)
        mask[10:90, 10:90] = 1

        # Balloon border along the perimeter of the eroded box
        image[16:22, 16:84] = (0, 0, 0)
        image[16:84, 16:22] = (0, 0, 0)

        # Text glyph inside
        image[45:55, 45:55] = (0, 0, 0)

        pairs = engine.build_text_masks(image, [mask])
        self.assertEqual(len(pairs), 1)
        text_mask, _zone = pairs[0]

        # Text glyph is kept
        self.assertTrue(np.all(text_mask[47:53, 47:53] > 0))
        # Balloon border line along the perimeter is rejected
        self.assertEqual(int(text_mask[16:22, 16:84].sum()), 0)
        self.assertEqual(int(text_mask[16:84, 16:22].sum()), 0)

    def test_expansion_preserves_rejected_border_next_to_text(self):
        image = np.full((100, 100, 3), 255, dtype=np.uint8)
        bubble = np.zeros((100, 100), dtype=np.uint8)
        bubble[10:90, 10:90] = 1
        image[16:84, 16:22] = 0
        image[45:55, 30:34] = 0
        engine = InpaintingEngine(device="cpu")
        pairs = engine.build_text_masks(image, [bubble])
        masks, zones = map(list, zip(*pairs))
        engine._lama_available = False
        result = engine.process_blocks(image, masks, safe_zones=zones)
        np.testing.assert_array_equal(result[16:84, 16:22], image[16:84, 16:22])
        self.assertTrue(np.all(result[45:55, 30:34] > 200))

    def test_manual_tight_mask_around_dark_text_with_adjacent_border(self):
        engine = InpaintingEngine(device="cpu")
        h, w = 100, 100
        image = np.full((h, w, 3), 255, dtype=np.uint8)
        # 80 black text pixels
        image[45:55, 45:53] = 0
        # adjacent balloon border
        image[41:59, 41:45] = 0
        image[41:59, 53:57] = 0
        image[41:45, 41:57] = 0

        # tight box around text
        mask = np.zeros((h, w), dtype=np.uint8)
        mask[45:55, 45:53] = 1

        extracted = engine._extract_text_mask(image, mask, manual=True)
        self.assertEqual(extracted.sum(), 80)
        self.assertTrue(np.all(extracted[45:55, 45:53] == 1))
        self.assertEqual(int(extracted[mask == 0].sum()), 0)
