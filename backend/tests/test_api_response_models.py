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


if __name__ == "__main__":
    unittest.main()
