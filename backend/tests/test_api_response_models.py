import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

import main
from repository import RegionRecord, SQLiteReviewRepository


class ApiResponseModelTests(unittest.TestCase):
    def setUp(self) -> None:
        self._jobs_snapshot = dict(main.jobs_db)
        self._repository_snapshot = main.repository
        self._temporary_directory = tempfile.TemporaryDirectory()
        self._test_repository = SQLiteReviewRepository(
            Path(self._temporary_directory.name) / "state.sqlite3"
        )
        main.set_repository(self._test_repository)
        main.jobs_db.clear()
        self.client = TestClient(main.app)

    def tearDown(self) -> None:
        self.client.close()
        main.jobs_db.clear()
        main.jobs_db.update(self._jobs_snapshot)
        self._test_repository.close()
        main.set_repository(self._repository_snapshot)
        self._temporary_directory.cleanup()

    def test_openapi_documents_translate_and_status_response_models(self) -> None:
        response = self.client.get("/openapi.json")
        self.assertEqual(response.status_code, 200)

        spec = response.json()
        translate_response = spec["paths"]["/api/translate"]["post"]["responses"]["202"]
        status_response = spec["paths"]["/api/status/{job_id}"]["get"]["responses"]["200"]

        self.assertEqual(
            translate_response["content"]["application/json"]["schema"]["$ref"],
            "#/components/schemas/TranslateJobResponse",
        )
        self.assertEqual(
            status_response["content"]["application/json"]["schema"]["$ref"],
            "#/components/schemas/JobStatus",
        )

        schemas = spec["components"]["schemas"]
        self.assertEqual(
            set(schemas["TranslateJobResponse"]["properties"]),
            {"id", "status", "jobs"},
        )
        self.assertIn("original_url", schemas["JobStatus"]["properties"])
        self.assertIn("result_url", schemas["JobStatus"]["properties"])
        self.assertIn("inpainted_url", schemas["JobStatus"]["properties"])
        self.assertIn("error", schemas["JobStatus"]["properties"])
        self.assertEqual(
            schemas["BlockItem"]["properties"]["box"]["$ref"],
            "#/components/schemas/NormalizedBox",
        )
        normalized_box = schemas["NormalizedBox"]["properties"]
        self.assertEqual(set(normalized_box), {"x", "y", "width", "height"})
        self.assertNotIn("ocr_text", schemas["JobStatus"]["properties"])
        self.assertNotIn("translated_text", schemas["JobStatus"]["properties"])

    def test_hydration_preserves_review_jobs_and_fails_interrupted_jobs(self) -> None:
        self._test_repository.save_job(
            {
                "id": "active-job",
                "filename": "active.png",
                "status": "translating",
                "progress": 50,
            }
        )
        self._test_repository.save_job(
            {
                "id": "review-job",
                "filename": "review.png",
                "status": "awaiting_review",
                "progress": 55,
                "image_width": 200,
                "image_height": 100,
            }
        )
        self._test_repository.replace_regions(
            "review-job",
            [
                RegionRecord(
                    id="region-1",
                    job_id="review-job",
                    order=0,
                    x=0.1,
                    y=0.2,
                    width=0.3,
                    height=0.4,
                    source="detected",
                    source_text="source",
                    translated_text="translation",
                )
            ],
        )

        main.hydrate_repository_state()

        self.assertEqual(main.jobs_db["active-job"]["status"], "failed")
        self.assertEqual(
            main.jobs_db["active-job"]["error"],
            "Job interrupted by backend restart.",
        )
        review_job = main.jobs_db["review-job"]
        self.assertEqual(review_job["status"], "awaiting_review")
        self.assertEqual(
            review_job["blocks"][0]["box"],
            {"x": 0.1, "y": 0.2, "width": 0.3, "height": 0.4},
        )
        self.assertEqual(review_job["blocks_obj"][0].translated_text, "translation")

    def test_status_response_filters_internal_job_fields(self) -> None:
        main.jobs_db["job-1"] = {
            "id": "job-1",
            "filename": "source.png",
            "status": "failed",
            "progress": 65,
            "message": "Job stopped: OCR service unavailable",
            "error": "OCR service unavailable",
            "original_url": "/uploads/source.png",
            "result_url": "/uploads/final.png",
            "ocr_text": "internal extracted text",
            "translated_text": "internal translated text",
            "inpainted_url": "/uploads/inpainted.png",
        }

        response = self.client.get("/api/status/job-1")
        self.assertEqual(response.status_code, 200)

        body = response.json()
        self.assertEqual(body["id"], "job-1")
        self.assertEqual(body["filename"], "source.png")
        self.assertEqual(body["status"], "error")
        self.assertEqual(body["progress"], 65)
        self.assertEqual(body["message"], "Job stopped: OCR service unavailable")
        self.assertEqual(body["error"], "OCR service unavailable")
        self.assertEqual(body["original_url"], "/uploads/source.png")
        self.assertEqual(body["result_url"], "/uploads/final.png")
        self.assertEqual(body["inpainted_url"], "/uploads/inpainted.png")
        self.assertNotIn("ocr_text", body)
        self.assertNotIn("translated_text", body)

    def test_status_response_includes_blocks_when_present(self) -> None:
        main.jobs_db["job-2"] = {
            "id": "job-2",
            "filename": "source.png",
            "status": "awaiting_review",
            "progress": 55,
            "message": "Awaiting manual review of translations.",
            "original_url": "/uploads/source.png",
            "blocks": [
                {
                    "id": "block-1",
                    "box": {"x": 0.1, "y": 0.2, "width": 0.5, "height": 0.5},
                    "source": "detected",
                    "text": "Japanese",
                    "translated_text": "Thai Translation draft"
                }
            ]
        }

        response = self.client.get("/api/status/job-2")
        self.assertEqual(response.status_code, 200)

        body = response.json()
        self.assertEqual(body["id"], "job-2")
        self.assertEqual(body["status"], "awaiting_review")
        self.assertEqual(len(body["blocks"]), 1)
        self.assertEqual(body["blocks"][0]["id"], "block-1")
        self.assertEqual(
            body["blocks"][0]["box"],
            {"x": 0.1, "y": 0.2, "width": 0.5, "height": 0.5},
        )
        self.assertEqual(body["blocks"][0]["text"], "Japanese")
        self.assertEqual(body["blocks"][0]["translated_text"], "Thai Translation draft")

    @unittest.mock.patch("main.cv2.imread")
    @unittest.mock.patch("main.cv2.imwrite")
    def test_approve_job_updates_translations_and_resumes(self, mock_imwrite, mock_imread) -> None:
        import numpy as np
        mock_imread.return_value = np.zeros((100, 100, 3), dtype=np.uint8)
        mock_imwrite.return_value = True

        from synthesis.segmentation import TextBlock
        mock_block = TextBlock(
            id="block-1",
            box=(10, 20, 100, 50),
            confidence=1.0,
            text="Japanese",
            translated_text="Thai Draft"
        )
        
        main.jobs_db["job-3"] = {
            "id": "job-3",
            "filename": "source.png",
            "status": "awaiting_review",
            "progress": 55,
            "message": "Awaiting manual review of translations.",
            "original_url": "/uploads/source.png",
            "image_width": 200,
            "image_height": 100,
            "blocks_obj": [mock_block],
            "blocks": [
                {
                    "id": "block-1",
                    "box": {"x": 0.05, "y": 0.2, "width": 0.5, "height": 0.5},
                    "source": "detected",
                    "text": "Japanese",
                    "translated_text": "Thai Draft"
                }
            ]
        }

        payload = {
            "translations": {
                "block-1": "Approved Premium Thai Text"
            }
        }
        
        response = self.client.post("/api/jobs/job-3/approve", json=payload)
        self.assertEqual(response.status_code, 200)
        
        body = response.json()
        self.assertEqual(body["status"], "resumed")
        
        job = main.jobs_db["job-3"]
        self.assertIn(job["status"], ["inpainting", "completed"])
        self.assertIn(job["progress"], [60, 100])
        self.assertEqual(job["blocks"][0]["translated_text"], "Approved Premium Thai Text")
        self.assertEqual(job["blocks_obj"][0].translated_text, "Approved Premium Thai Text")


if __name__ == "__main__":
    unittest.main()
