import unittest

from fastapi.testclient import TestClient

import main


class ApiResponseModelTests(unittest.TestCase):
    def setUp(self) -> None:
        self._jobs_snapshot = dict(main.jobs_db)
        main.jobs_db.clear()
        self.client = TestClient(main.app)

    def tearDown(self) -> None:
        main.jobs_db.clear()
        main.jobs_db.update(self._jobs_snapshot)

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
            {"id", "status"},
        )
        self.assertIn("original_url", schemas["JobStatus"]["properties"])
        self.assertIn("result_url", schemas["JobStatus"]["properties"])
        self.assertIn("error", schemas["JobStatus"]["properties"])
        self.assertNotIn("ocr_text", schemas["JobStatus"]["properties"])
        self.assertNotIn("translated_text", schemas["JobStatus"]["properties"])
        self.assertNotIn("inpainted_url", schemas["JobStatus"]["properties"])

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
        self.assertNotIn("ocr_text", body)
        self.assertNotIn("translated_text", body)
        self.assertNotIn("inpainted_url", body)

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
                    "box": [10, 20, 100, 50],
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
        self.assertEqual(body["blocks"][0]["box"], [10, 20, 100, 50])
        self.assertEqual(body["blocks"][0]["text"], "Japanese")
        self.assertEqual(body["blocks"][0]["translated_text"], "Thai Translation draft")

    def test_approve_job_updates_translations_and_resumes(self) -> None:
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
            "blocks_obj": [mock_block],
            "blocks": [
                {
                    "id": "block-1",
                    "box": [10, 20, 100, 50],
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
