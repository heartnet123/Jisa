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

if __name__ == "__main__":
    unittest.main()
