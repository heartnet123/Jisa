import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import cv2
import numpy as np
from fastapi.testclient import TestClient

import main
from repository import RegionRecord, SQLiteReviewRepository


class RegionApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self._jobs_snapshot = dict(main.jobs_db)
        self._projects_snapshot = dict(main.projects_db)
        self._repository_snapshot = main.repository
        self._upload_dir_snapshot = main.UPLOAD_DIR
        self._temporary_directory = tempfile.TemporaryDirectory()
        main.UPLOAD_DIR = Path(self._temporary_directory.name) / "uploads"
        main.UPLOAD_DIR.mkdir()
        self.repository = SQLiteReviewRepository(
            Path(self._temporary_directory.name) / "state.sqlite3"
        )
        main.set_repository(self.repository)
        main.jobs_db.clear()
        main.projects_db.clear()
        self.client = TestClient(main.app)
        self._seed_review_job()

    def tearDown(self) -> None:
        self.client.close()
        main.jobs_db.clear()
        main.projects_db.clear()
        main.jobs_db.update(self._jobs_snapshot)
        main.projects_db.update(self._projects_snapshot)
        self.repository.close()
        main.set_repository(self._repository_snapshot)
        main.UPLOAD_DIR = self._upload_dir_snapshot
        self._temporary_directory.cleanup()

    def _seed_review_job(self) -> None:
        self.repository.save_job(
            {
                "id": "job-1",
                "filename": "page.png",
                "status": "awaiting_review",
                "progress": 55,
                "message": "Awaiting manual review of translations.",
                "original_url": "/uploads/page.png",
                "image_width": 1000,
                "image_height": 1600,
                "region_mode": "detected",
            }
        )
        self.repository.replace_regions(
            "job-1",
            [
                RegionRecord(
                    id="region-1",
                    job_id="job-1",
                    order=0,
                    x=0.1,
                    y=0.2,
                    width=0.3,
                    height=0.1,
                    source="detected",
                    source_text="source one",
                    translated_text="translation one",
                ),
                RegionRecord(
                    id="region-2",
                    job_id="job-1",
                    order=1,
                    x=0.5,
                    y=0.6,
                    width=0.2,
                    height=0.1,
                    source="detected",
                    source_text="source two",
                    translated_text="translation two",
                ),
            ],
        )
        main.hydrate_repository_state()

    def test_conversion_round_trip_and_validation(self) -> None:
        normalized = main.pixel_box_to_normalized((100, 320, 300, 160), 1000, 1600)
        self.assertEqual(normalized, (0.1, 0.2, 0.3, 0.1))
        self.assertEqual(
            main.normalized_box_to_pixels(normalized, 1000, 1600),
            (100, 320, 300, 160),
        )

        with self.assertRaises(ValueError):
            main.pixel_box_to_normalized((900, 0, 200, 100), 1000, 1600)
        with self.assertRaises(ValueError):
            main.normalized_box_to_pixels((0.9, 0.0, 0.2, 0.1), 1000, 1600)

    def test_replace_regions_returns_canonical_manual_override(self) -> None:
        response = self.client.put(
            "/api/jobs/job-1/regions",
            json={
                "regions": [
                    {
                        "id": "region-1",
                        "box": {
                            "x": 0.12,
                            "y": 0.2,
                            "width": 0.3,
                            "height": 0.1,
                        },
                        "text": "source one",
                        "translated_text": "translation one",
                    },
                    {
                        "id": "manual-1",
                        "box": {
                            "x": 0.7,
                            "y": 0.1,
                            "width": 0.2,
                            "height": 0.2,
                        },
                    },
                ]
            },
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["region_mode"], "manual_override")
        self.assertEqual(
            [region["id"] for region in body["regions"]],
            ["region-1", "manual-1"],
        )
        self.assertEqual(body["regions"][0]["source"], "manual")
        self.assertEqual(body["regions"][1]["source"], "manual")
        self.assertEqual(main.jobs_db["job-1"]["region_mode"], "manual_override")
        self.assertEqual(
            [region.id for region in self.repository.load_regions("job-1")],
            ["region-1", "manual-1"],
        )

    def test_invalid_replace_returns_422_without_mutating_regions(self) -> None:
        before = self.repository.load_regions("job-1")

        response = self.client.put(
            "/api/jobs/job-1/regions",
            json={
                "regions": [
                    {
                        "id": "region-1",
                        "box": {
                            "x": 0.9,
                            "y": 0.2,
                            "width": 0.2,
                            "height": 0.1,
                        },
                    }
                ]
            },
        )

        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.repository.load_regions("job-1"), before)
        self.assertEqual(main.jobs_db["job-1"]["region_mode"], "detected")

    def test_patch_source_text_clears_stale_translation(self) -> None:
        response = self.client.patch(
            "/api/jobs/job-1/regions/region-1",
            json={"text": "corrected source"},
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["text"], "corrected source")
        self.assertIsNone(body["translated_text"])
        saved = self.repository.load_regions("job-1")[0]
        self.assertEqual(saved.source_text, "corrected source")
        self.assertIsNone(saved.translated_text)

    def test_mutation_outside_review_returns_409(self) -> None:
        main.jobs_db["job-1"]["status"] = "completed"

        response = self.client.patch(
            "/api/jobs/job-1/regions/region-1",
            json={"translated_text": "new translation"},
        )

        self.assertEqual(response.status_code, 409)

    def test_region_ocr_updates_only_selected_source_and_clears_translation(self) -> None:
        (main.UPLOAD_DIR / "page.png").touch()
        image = np.zeros((1600, 1000, 3), dtype=np.uint8)

        with (
            patch.object(main.cv2, "imread", return_value=image),
            patch.object(
                main,
                "_crop_and_ocr",
                new=AsyncMock(return_value="  refreshed source  "),
            ) as crop_and_ocr,
            patch.object(main, "notify_state_change", new=AsyncMock()),
        ):
            response = self.client.post("/api/jobs/job-1/regions/region-1/ocr")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["text"], "refreshed source")
        self.assertIsNone(response.json()["translated_text"])
        crop_and_ocr.assert_awaited_once()
        self.assertEqual(crop_and_ocr.await_args.args[1], (100, 320, 300, 160))
        saved = self.repository.load_regions("job-1")
        self.assertEqual(saved[0].source_text, "refreshed source")
        self.assertIsNone(saved[0].translated_text)
        self.assertEqual(saved[1].source_text, "source two")
        self.assertEqual(saved[1].translated_text, "translation two")

    def test_mask_preview_writes_rgba_overlay_and_geometry_invalidates_it(self) -> None:
        image = np.full((1600, 1000, 3), 255, dtype=np.uint8)
        cv2.putText(
            image,
            "A",
            (150, 420),
            cv2.FONT_HERSHEY_SIMPLEX,
            3,
            (0, 0, 0),
            8,
        )
        cv2.imwrite(str(main.UPLOAD_DIR / "page.png"), image)
        regions = self.repository.load_regions("job-1")
        manual = regions[0]
        self.repository.replace_regions(
            "job-1",
            [
                RegionRecord(
                    id=manual.id,
                    job_id=manual.job_id,
                    order=0,
                    x=manual.x,
                    y=manual.y,
                    width=manual.width,
                    height=manual.height,
                    source="manual",
                    source_text=manual.source_text,
                    translated_text=manual.translated_text,
                )
            ],
        )

        with patch.object(main, "notify_state_change", new=AsyncMock()):
            preview_response = self.client.post("/api/jobs/job-1/mask-preview")

        self.assertEqual(preview_response.status_code, 200)
        self.assertRegex(preview_response.json()["url"], r"\?v=\d+$")
        preview_path = main.UPLOAD_DIR / "mask_preview_job-1.png"
        self.assertTrue(preview_path.is_file())
        overlay = cv2.imread(str(preview_path), cv2.IMREAD_UNCHANGED)
        self.assertEqual(overlay.shape, (1600, 1000, 4))
        self.assertGreater(int(overlay[:, :, 3].sum()), 0)
        revision = preview_response.json()["revision"]

        with patch.object(main, "notify_state_change", new=AsyncMock()):
            replace_response = self.client.put(
                "/api/jobs/job-1/regions",
                json={
                    "regions": [
                        {
                            "id": "region-1",
                            "box": {
                                "x": 0.11,
                                "y": 0.2,
                                "width": 0.3,
                                "height": 0.1,
                            },
                        }
                    ]
                },
            )

        self.assertEqual(replace_response.status_code, 200)
        self.assertFalse(preview_path.exists())
        self.assertIsNone(main.jobs_db["job-1"]["mask_preview_url"])
        self.assertEqual(main.jobs_db["job-1"]["preview_revision"], revision + 1)

    def test_mask_preview_reports_missing_detected_mask_without_mutation(self) -> None:
        cv2.imwrite(
            str(main.UPLOAD_DIR / "page.png"),
            np.full((1600, 1000, 3), 255, dtype=np.uint8),
        )
        before = self.repository.load_regions("job-1")

        response = self.client.post("/api/jobs/job-1/mask-preview")

        self.assertEqual(response.status_code, 409)
        self.assertIn("Detected mask is unavailable", response.json()["detail"])
        self.assertEqual(self.repository.load_regions("job-1"), before)

    def test_typesetting_options_endpoint(self) -> None:
        response = self.client.get("/api/typesetting/options")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("fonts", data)
        self.assertTrue(len(data["fonts"]) > 0)
        self.assertEqual(data["font_size"]["min"], 8)
        self.assertEqual(data["font_size"]["max"], 72)
        self.assertEqual(data["alignments"], ["left", "center", "right"])

    def test_typesetting_preview_endpoint(self) -> None:
        response = self.client.post(
            "/api/jobs/job-1/regions/region-1/typeset-preview",
            json={
                "client_revision": 5,
                "translated_text": "ข้อความพรีวิวใหม่",
                "typesetting": {
                    "font_name": "Itim-Regular.ttf",
                    "font_size": 24,
                    "auto_fit": True,
                    "text_align": "left",
                    "padding_ratio": 0.1,
                },
            },
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["client_revision"], 5)
        self.assertEqual(data["mime_type"], "image/png")
        self.assertTrue(len(data["overlay_base64"]) > 0)
        self.assertGreater(data["bounds_px"]["width"], 0)
        self.assertFalse(data["overflow"])

    def test_typesetting_preview_invalid_font_returns_422(self) -> None:
        response = self.client.post(
            "/api/jobs/job-1/regions/region-1/typeset-preview",
            json={
                "typesetting": {
                    "font_name": "../invalid.ttf",
                },
            },
        )
        self.assertEqual(response.status_code, 422)

    def test_patch_job_regions_preserves_and_persists_typesetting(self) -> None:
        with patch.object(main, "notify_state_change", new=AsyncMock()):
            patch_resp = self.client.patch(
                "/api/jobs/job-1/regions/region-1",
                json={
                    "typesetting": {
                        "font_name": "Itim-Regular.ttf",
                        "font_size": 28,
                        "auto_fit": False,
                        "text_align": "right",
                        "padding_ratio": 0.15,
                    }
                },
            )
        self.assertEqual(patch_resp.status_code, 200)
        patched_data = patch_resp.json()
        self.assertEqual(patched_data["typesetting"]["font_name"], "Itim-Regular.ttf")
        self.assertEqual(patched_data["typesetting"]["font_size"], 28)
        self.assertFalse(patched_data["typesetting"]["auto_fit"])
        self.assertEqual(patched_data["typesetting"]["text_align"], "right")
        self.assertAlmostEqual(patched_data["typesetting"]["padding_ratio"], 0.15)

        # Verify durable persistence via repository reload
        reloaded_regions = self.repository.load_regions("job-1")
        reloaded = next(r for r in reloaded_regions if r.id == "region-1")
        self.assertEqual(reloaded.font_name, "Itim-Regular.ttf")
        self.assertEqual(reloaded.font_size, 28)
        self.assertFalse(reloaded.auto_fit)
        self.assertEqual(reloaded.text_align, "right")
        self.assertAlmostEqual(reloaded.padding_ratio, 0.15)

    def test_replace_job_regions_preserves_typesetting(self) -> None:
        # First set custom typesetting on region-1
        with patch.object(main, "notify_state_change", new=AsyncMock()):
            self.client.patch(
                "/api/jobs/job-1/regions/region-1",
                json={
                    "typesetting": {
                        "font_name": "Itim-Regular.ttf",
                        "font_size": 32,
                        "auto_fit": False,
                        "text_align": "left",
                        "padding_ratio": 0.20,
                    }
                },
            )

            # PUT replacement omitting typesetting should retain previous typesetting
            put_resp = self.client.put(
                "/api/jobs/job-1/regions",
                json={
                    "regions": [
                        {
                            "id": "region-1",
                            "box": {"x": 0.1, "y": 0.2, "width": 0.3, "height": 0.4},
                            "text": "Japanese text",
                            "translated_text": "Thai text",
                        }
                    ]
                },
            )
        self.assertEqual(put_resp.status_code, 200)
        put_data = put_resp.json()
        self.assertEqual(put_data["regions"][0]["typesetting"]["font_name"], "Itim-Regular.ttf")
        self.assertEqual(put_data["regions"][0]["typesetting"]["font_size"], 32)
        self.assertFalse(put_data["regions"][0]["typesetting"]["auto_fit"])
        self.assertEqual(put_data["regions"][0]["typesetting"]["text_align"], "left")
        self.assertAlmostEqual(put_data["regions"][0]["typesetting"]["padding_ratio"], 0.20)

    def test_mutation_invalid_font_returns_422(self) -> None:
        patch_resp = self.client.patch(
            "/api/jobs/job-1/regions/region-1",
            json={
                "typesetting": {
                    "font_name": "NonExistentFont.ttf",
                }
            },
        )
        self.assertEqual(patch_resp.status_code, 422)

        put_resp = self.client.put(
            "/api/jobs/job-1/regions",
            json={
                "regions": [
                    {
                        "id": "region-1",
                        "box": {"x": 0.1, "y": 0.2, "width": 0.3, "height": 0.4},
                        "typesetting": {
                            "font_name": "../secret.ttf",
                        },
                    }
                ]
            },
        )
        self.assertEqual(put_resp.status_code, 422)


if __name__ == "__main__":
    unittest.main()
