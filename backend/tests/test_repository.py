import tempfile
import unittest
from pathlib import Path

from repository import RegionRecord, SQLiteReviewRepository


class SQLiteReviewRepositoryTests(unittest.TestCase):
    def test_reopen_preserves_jobs_projects_and_ordered_regions(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            database_path = Path(temporary_directory) / "state.sqlite3"
            repository = SQLiteReviewRepository(database_path)
            repository.save_project(
                {
                    "id": "project-1",
                    "name": "Chapter 1",
                    "created_at": "2026-07-17T12:00:00+00:00",
                    "job_ids": ["job-1"],
                    "page_order": ["job-1"],
                }
            )
            repository.save_job(
                {
                    "id": "job-1",
                    "filename": "page.png",
                    "status": "awaiting_review",
                    "progress": 55,
                    "message": "Awaiting manual review of translations.",
                    "original_url": "/uploads/page.png",
                    "project_id": "project-1",
                    "image_width": 1000,
                    "image_height": 1600,
                    "region_mode": "detected",
                    "ocr_text": "one\n---\ntwo",
                    "translated_text": "หนึ่ง\n---\nสอง",
                    "created_at": "2026-07-17T12:00:00+00:00",
                }
            )
            repository.replace_regions(
                "job-1",
                [
                    RegionRecord(
                        id="region-2",
                        job_id="job-1",
                        order=0,
                        x=0.5,
                        y=0.4,
                        width=0.2,
                        height=0.1,
                        source="detected",
                        source_text="two",
                        translated_text="สอง",
                        mask_path="masks/job-1-region-2.png",
                    ),
                    RegionRecord(
                        id="region-1",
                        job_id="job-1",
                        order=1,
                        x=0.1,
                        y=0.2,
                        width=0.3,
                        height=0.15,
                        source="detected",
                        source_text="one",
                        translated_text="หนึ่ง",
                        mask_path="masks/job-1-region-1.png",
                    ),
                ],
            )
            repository.close()

            reopened = SQLiteReviewRepository(database_path)
            job = reopened.load_jobs()[0]
            regions = reopened.load_regions("job-1")
            project = reopened.load_projects()[0]

            self.assertEqual(job["status"], "awaiting_review")
            self.assertEqual(job["image_width"], 1000)
            self.assertEqual(job["image_height"], 1600)
            self.assertEqual(job["region_mode"], "detected")
            self.assertEqual(job["ocr_text"], "one\n---\ntwo")
            self.assertEqual([region.id for region in regions], ["region-2", "region-1"])
            self.assertEqual(regions[0].translated_text, "สอง")
            self.assertEqual(regions[1].mask_path, "masks/job-1-region-1.png")
            self.assertEqual(project["job_ids"], ["job-1"])
            self.assertEqual(project["page_order"], ["job-1"])
            reopened.close()

    def test_delete_job_cascades_regions(self) -> None:
        repository = SQLiteReviewRepository(":memory:")
        repository.save_job(
            {
                "id": "job-1",
                "filename": "page.png",
                "status": "awaiting_review",
                "progress": 55,
            }
        )
        repository.replace_regions(
            "job-1",
            [
                RegionRecord(
                    id="region-1",
                    job_id="job-1",
                    order=0,
                    x=0.1,
                    y=0.1,
                    width=0.2,
                    height=0.2,
                    source="detected",
                )
            ],
        )

        repository.delete_job("job-1")

        self.assertEqual(repository.load_jobs(), [])
        self.assertEqual(repository.load_regions("job-1"), [])
        repository.close()


if __name__ == "__main__":
    unittest.main()
