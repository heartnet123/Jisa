import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import main
import numpy as np
from fastapi.testclient import TestClient
from repository import RegionRecord, SQLiteReviewRepository
from synthesis.segmentation import TextBlock


class PipelineRegionOverrideTests(unittest.TestCase):
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

    def tearDown(self) -> None:
        main.jobs_db.clear()
        main.projects_db.clear()
        main.jobs_db.update(self._jobs_snapshot)
        main.projects_db.update(self._projects_snapshot)
        self.repository.close()
        main.set_repository(self._repository_snapshot)
        self._temporary_directory.cleanup()

    def _seed_job(self, *, status: str = "queued") -> dict:
        job = {
            "id": "job-1",
            "filename": "page.png",
            "status": status,
            "progress": 0,
            "message": "Queued for translation.",
            "original_url": "/uploads/page.png",
            "image_width": 200,
            "image_height": 100,
            "region_mode": "manual_override",
        }
        main.jobs_db[job["id"]] = job
        self.repository.save_job(job)
        return job

    def test_tight_manual_preview_matches_approved_erasure(self) -> None:
        job = self._seed_job(status="awaiting_review")
        directory = Path(self._temporary_directory.name)
        image = np.full((100, 200, 3), 255, dtype=np.uint8)
        image[30:50, 60:64] = 0
        main.cv2.imwrite(str(directory / "page.png"), image)
        self.repository.replace_regions(
            "job-1",
            [
                RegionRecord(
                    id="tight",
                    job_id="job-1",
                    order=0,
                    x=0.3,
                    y=0.3,
                    width=0.02,
                    height=0.2,
                    source="manual",
                    translated_text="",
                )
            ],
        )
        from fastapi import BackgroundTasks

        with (
            patch.object(main, "UPLOAD_DIR", directory),
            patch.object(main, "notify_state_change", new=AsyncMock()),
            patch.object(main.segmenter, "unload_all"),
            patch.object(main.inpainter, "_lama_available", False),
        ):
            asyncio.run(main.generate_mask_preview("job-1"))
            preview = main.cv2.imread(
                str(main._mask_preview_path("job-1")), main.cv2.IMREAD_UNCHANGED
            )
            tasks = BackgroundTasks()
            asyncio.run(
                main.approve_job("job-1", main.ApprovePayload(translations={}), tasks)
            )
            asyncio.run(tasks())
        final = main.cv2.imread(str(directory / "final_job-1.png"))
        selected = np.zeros(image.shape[:2], dtype=bool)
        selected[30:50, 60:64] = True
        np.testing.assert_array_equal(preview[:, :, 3] > 0, selected)
        np.testing.assert_array_equal(final[~selected], image[~selected])
        self.assertTrue(np.all(final[selected] == 255))
        self.assertEqual(job["status"], "completed")

    def test_manual_override_skips_detection_and_uses_saved_regions(self) -> None:
        self._seed_job()
        self.repository.replace_regions(
            "job-1",
            [
                RegionRecord(
                    id="manual-1",
                    job_id="job-1",
                    order=0,
                    x=0.25,
                    y=0.2,
                    width=0.5,
                    height=0.4,
                    source="manual",
                    source_text="old source",
                    translated_text="old translation",
                )
            ],
        )

        with (
            patch.object(
                main.cv2,
                "imread",
                return_value=np.zeros((100, 200, 3), dtype=np.uint8),
            ),
            patch.object(main.segmenter, "detect_bubbles") as detect_bubbles,
            patch.object(
                main, "_crop_and_ocr", new=AsyncMock(return_value="new source")
            ),
            patch.object(
                main, "translate_text", new=AsyncMock(return_value="new translation")
            ),
            patch.object(main, "notify_state_change", new=AsyncMock()),
        ):
            asyncio.run(main.process_manga_task("job-1", "page.png"))

        detect_bubbles.assert_not_called()
        self.assertEqual(main.jobs_db["job-1"]["status"], "awaiting_review")
        saved = self.repository.load_regions("job-1")
        self.assertEqual([region.id for region in saved], ["manual-1"])
        self.assertEqual(
            (saved[0].x, saved[0].y, saved[0].width, saved[0].height),
            (0.25, 0.2, 0.5, 0.4),
        )
        self.assertEqual(saved[0].source_text, "new source")
        self.assertEqual(saved[0].translated_text, "new translation")

    def test_empty_override_never_restores_deleted_detections(self) -> None:
        self._seed_job()
        self.repository.replace_regions("job-1", [])

        with (
            patch.object(
                main.cv2,
                "imread",
                return_value=np.zeros((100, 200, 3), dtype=np.uint8),
            ),
            patch.object(main.segmenter, "detect_bubbles") as detect_bubbles,
            patch.object(main, "perform_ocr", new=AsyncMock()) as perform_ocr,
            patch.object(main, "translate_text", new=AsyncMock()) as translate_text,
            patch.object(main, "notify_state_change", new=AsyncMock()),
        ):
            asyncio.run(main.process_manga_task("job-1", "page.png"))

        detect_bubbles.assert_not_called()
        perform_ocr.assert_not_awaited()
        translate_text.assert_not_awaited()
        self.assertEqual(main.jobs_db["job-1"]["blocks"], [])
        self.assertEqual(self.repository.load_regions("job-1"), [])

    def test_approval_rehydrates_latest_durable_geometry(self) -> None:
        job = self._seed_job(status="awaiting_review")
        self.repository.replace_regions(
            "job-1",
            [
                RegionRecord(
                    id="region-1",
                    job_id="job-1",
                    order=0,
                    x=0.5,
                    y=0.1,
                    width=0.25,
                    height=0.2,
                    source="manual",
                    source_text="source",
                    translated_text="draft",
                    font_name="Itim-Regular.ttf",
                    font_size=32,
                    auto_fit=False,
                    text_align="right",
                    padding_ratio=0.2,
                )
            ],
        )
        job["blocks_obj"] = [
            TextBlock(id="region-1", box=(0, 0, 10, 10), translated_text="stale")
        ]
        client = TestClient(main.app)

        with (
            patch.object(main, "resume_manga_task", new=AsyncMock()),
            patch.object(main, "notify_state_change", new=AsyncMock()),
        ):
            response = client.post(
                "/api/jobs/job-1/approve",
                json={"translations": {"region-1": "approved"}},
            )

        client.close()
        self.assertEqual(response.status_code, 200)
        approved_block = main.jobs_db["job-1"]["blocks_obj"][0]
        self.assertEqual(approved_block.box, (100, 10, 50, 20))
        self.assertEqual(approved_block.translated_text, "approved")
        self.assertEqual(
            self.repository.load_regions("job-1")[0].translated_text,
            "approved",
        )
        approved_region = self.repository.load_regions("job-1")[0]
        self.assertEqual(approved_region.font_name, "Itim-Regular.ttf")
        self.assertEqual(approved_region.font_size, 32)
        self.assertFalse(approved_region.auto_fit)
        self.assertEqual(approved_region.text_align, "right")
        self.assertAlmostEqual(approved_region.padding_ratio, 0.2)

    def test_approval_persists_resuming_state(self) -> None:
        self._seed_job(status="awaiting_review")
        self.repository.replace_regions(
            "job-1",
            [
                RegionRecord(
                    id="region-1",
                    job_id="job-1",
                    order=0,
                    x=0.1,
                    y=0.1,
                    width=0.4,
                    height=0.3,
                    source="detected",
                    source_text="source",
                    translated_text="draft",
                )
            ],
        )
        client = TestClient(main.app)

        with (
            patch.object(main, "resume_manga_task", new=AsyncMock()),
            patch.object(main, "get_system_health", new=AsyncMock(return_value={})),
            patch.object(main.event_manager, "publish", new=AsyncMock()),
        ):
            response = client.post(
                "/api/jobs/job-1/approve",
                json={"translations": {"region-1": "approved"}},
            )

        client.close()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.repository.load_jobs()[0]["status"], "inpainting")


if __name__ == "__main__":
    unittest.main()
