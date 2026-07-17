import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

import main
from repository import RegionRecord, SQLiteReviewRepository


class RegionApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self._jobs_snapshot = dict(main.jobs_db)
        self._projects_snapshot = dict(main.projects_db)
        self._repository_snapshot = main.repository
        self._temporary_directory = tempfile.TemporaryDirectory()
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


if __name__ == "__main__":
    unittest.main()
