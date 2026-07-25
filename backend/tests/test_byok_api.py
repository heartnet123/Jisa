import sys
import unittest
from pathlib import Path
from fastapi.testclient import TestClient

backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from main import app

class TestBYOKApi(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_get_byok_providers(self):
        response = self.client.get("/api/byok/providers")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("providers", data)
        providers = data["providers"]
        self.assertGreaterEqual(len(providers), 5)

    def test_byok_test_connection_invalid_key(self):
        payload = {
            "provider": "openai",
            "api_key": "sk-invalid-key-for-testing",
            "model": "gpt-4o-mini",
        }
        response = self.client.post("/api/byok/test", json=payload)
        self.assertEqual(response.status_code, 400)
        data = response.json()
        self.assertIn("detail", data)

    def test_list_jobs_sanitizes_byok_config(self):
        import asyncio
        import json
        from byok import BYOKConfig
        from main import jobs_db, list_jobs

        test_job_id = "test-byok-serialization-job"
        jobs_db[test_job_id] = {
            "id": test_job_id,
            "filename": "test.png",
            "status": "queued",
            "progress": 0,
            "message": "Testing BYOK serialization",
            "byok_config": BYOKConfig(provider="openai", api_key="secret-key", model="gpt-4o"),
        }

        try:
            jobs = asyncio.run(list_jobs())
            target = next((j for j in jobs if j.get("id") == test_job_id), None)
            self.assertIsNotNone(target)
            self.assertNotIn("byok_config", target)
            
            # Verify json.dumps succeeds without TypeError
            dumped = json.dumps(jobs, ensure_ascii=False)
            self.assertIn(test_job_id, dumped)
            self.assertNotIn("secret-key", dumped)
        finally:
            jobs_db.pop(test_job_id, None)

if __name__ == "__main__":
    unittest.main()
