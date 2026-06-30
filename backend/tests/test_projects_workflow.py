import unittest
from fastapi.testclient import TestClient
import main


class ProjectSessionWorkflowTests(unittest.TestCase):
    def setUp(self) -> None:
        self._jobs_snapshot = dict(main.jobs_db)
        self._projects_snapshot = dict(main.projects_db)
        main.jobs_db.clear()
        main.projects_db.clear()
        self.client = TestClient(main.app)

    def tearDown(self) -> None:
        main.jobs_db.clear()
        main.projects_db.clear()
        main.jobs_db.update(self._jobs_snapshot)
        main.projects_db.update(self._projects_snapshot)

    def test_create_and_list_projects(self) -> None:
        # Create a new project session
        response = self.client.post("/api/projects", json={"name": "Test Chapter 1"})
        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertIn("id", body)
        self.assertEqual(body["name"], "Test Chapter 1")
        self.assertEqual(body["job_ids"], [])
        
        # List projects and verify it is returned
        list_response = self.client.get("/api/projects")
        self.assertEqual(list_response.status_code, 200)
        list_body = list_response.json()
        self.assertEqual(len(list_body), 1)
        self.assertEqual(list_body[0]["id"], body["id"])
        self.assertEqual(list_body[0]["name"], "Test Chapter 1")

    def test_translate_job_associates_with_project(self) -> None:
        # Create project first
        proj_response = self.client.post("/api/projects", json={"name": "Test Chapter 2"})
        project_id = proj_response.json()["id"]

        # Mock translate request with a project_id form field
        import io
        dummy_file = io.BytesIO(b"fake image data")
        
        # Mock translate call
        response = self.client.post(
            "/api/translate",
            files={"file": ("page1.png", dummy_file, "image/png")},
            data={"project_id": project_id}
        )
        self.assertEqual(response.status_code, 202)
        job_id = response.json()["id"]

        # Check job status returns project_id
        status_response = self.client.get(f"/api/status/{job_id}")
        self.assertEqual(status_response.status_code, 200)
        self.assertEqual(status_response.json()["project_id"], project_id)

        # Check project now lists this job_id
        list_response = self.client.get("/api/projects")
        self.assertEqual(list_response.json()[0]["job_ids"], [job_id])

        # Delete job and verify it is unlinked from project
        del_response = self.client.delete(f"/api/jobs/{job_id}")
        self.assertEqual(del_response.status_code, 200)
        
        # Project job list should now be empty
        list_response2 = self.client.get("/api/projects")
        self.assertEqual(list_response2.json()[0]["job_ids"], [])


if __name__ == "__main__":
    unittest.main()
