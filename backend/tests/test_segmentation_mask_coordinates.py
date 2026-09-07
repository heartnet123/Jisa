import unittest
from types import SimpleNamespace
from unittest.mock import Mock

import cv2
import numpy as np
import torch
from synthesis.segmentation import SegmentationEngine


class SegmentationMaskCoordinatesTests(unittest.TestCase):
    def run_detection(self, shape, mask):
        height, width = shape
        box = SimpleNamespace(
            xyxy=np.array([[width // 4, height // 4, width // 2, height // 2]]),
            conf=np.array([0.9]),
        )
        result = SimpleNamespace(
            boxes=[box],
            masks=SimpleNamespace(data=torch.from_numpy(mask[None])),
        )
        engine = SegmentationEngine(device="cpu")
        engine._yolo = Mock(return_value=[result])
        engine._empty_cuda_cache = Mock()
        return engine._run_yolo(np.zeros((*shape, 3), dtype=np.uint8))[0]

    def test_letterboxed_masks_align_with_original_page(self):
        for shape in [(160, 100), (100, 160), (160, 160)]:
            with self.subTest(shape=shape):
                height, width = shape
                expected = np.zeros(shape, dtype=np.uint8)
                expected[height // 4 : height // 2, width // 4 : width // 2] = 1
                gain = 128 / max(shape)
                scaled = cv2.resize(
                    expected,
                    (round(width * gain), round(height * gain)),
                    interpolation=cv2.INTER_NEAREST,
                )
                padded = np.zeros((128, 128), dtype=np.uint8)
                top = (128 - scaled.shape[0]) // 2
                left = (128 - scaled.shape[1]) // 2
                padded[top : top + scaled.shape[0], left : left + scaled.shape[1]] = (
                    scaled
                )
                block = self.run_detection(shape, padded)
                intersection = np.count_nonzero((block.mask > 0) & (expected > 0))
                union = np.count_nonzero((block.mask > 0) | (expected > 0))
                self.assertGreater(intersection / union, 0.95)
                self.assertEqual(block.mask.shape, shape)
                self.assertEqual(block.mask.dtype, np.uint8)

    def test_native_resolution_mask_stays_exact(self):
        expected = np.zeros((100, 160), dtype=np.uint8)
        expected[10:30, 20:70] = 1
        block = self.run_detection(expected.shape, expected)
        np.testing.assert_array_equal(block.mask, expected)


if __name__ == "__main__":
    unittest.main()
