import io
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

import main
from repository import SQLiteReviewRepository

TINY_PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15c4\x00\x00\x00\rIDATx\x9cc\xf8\xff\xff?"
    b"\x03\x00\x05\xfe\x02\xfe\xa7\x96a\x1d\x00\x00\x00\x00IEND\xaeB`\x82"
)


class ProjectSessionWorkflowTests(unittest.TestCase):
    def setUp(self) -> None:
        self._jobs_snapshot = dict(main.jobs_db)
        self._projects_snapshot = dict(main.projects_db)
        self._repository_snapshot = main.repository
        self._temporary_directory = tempfile.TemporaryDirectory()
        self._test_repository = SQLiteReviewRepository(
            Path(self._temporary_directory.name) / "state.sqlite3"
        )
        main.set_repository(self._test_repository)
        main.jobs_db.clear()
        main.projects_db.clear()
        self.client = TestClient(main.app)

    def tearDown(self) -> None:
        self.client.close()
        main.jobs_db.clear()
        main.projects_db.clear()
        main.jobs_db.update(self._jobs_snapshot)
        main.projects_db.update(self._projects_snapshot)
        self._test_repository.close()
        main.set_repository(self._repository_snapshot)
        self._temporary_directory.cleanup()

    def test_create_and_list_projects(self) -> None:
        response = self.client.post("/api/projects", json={"name": "Test Chapter 1"})
        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertIn("id", body)
        self.assertEqual(body["name"], "Test Chapter 1")
        self.assertEqual(body["job_ids"], [])

        list_response = self.client.get("/api/projects")
        self.assertEqual(list_response.status_code, 200)
        list_body = list_response.json()
        self.assertEqual(len(list_body), 1)
        self.assertEqual(list_body[0]["id"], body["id"])
        self.assertEqual(list_body[0]["name"], "Test Chapter 1")

    def test_translate_job_associates_with_project(self) -> None:
        proj_response = self.client.post("/api/projects", json={"name": "Test Chapter 2"})
        project_id = proj_response.json()["id"]

        dummy_file = io.BytesIO(TINY_PNG)

        response = self.client.post(
            "/api/translate",
            files={"file": ("page1.png", dummy_file, "image/png")},
            data={"project_id": project_id},
        )
        self.assertEqual(response.status_code, 202)
        job_id = response.json()["id"]

        status_response = self.client.get(f"/api/status/{job_id}")
        self.assertEqual(status_response.status_code, 200)
        self.assertEqual(status_response.json()["project_id"], project_id)

        list_response = self.client.get("/api/projects")
        self.assertEqual(list_response.json()[0]["job_ids"], [job_id])

        del_response = self.client.delete(f"/api/jobs/{job_id}")
        self.assertEqual(del_response.status_code, 200)

        list_response2 = self.client.get("/api/projects")
        self.assertEqual(list_response2.json()[0]["job_ids"], [])

    def test_batch_upload_ordered_files_and_unknown_project(self) -> None:
        # Unknown project returns 404
        response_404 = self.client.post(
            "/api/translate",
            files=[
                ("files", ("001.png", io.BytesIO(TINY_PNG), "image/png")),
            ],
            data={"project_id": "nonexistent-project-id"},
        )
        self.assertEqual(response_404.status_code, 404)

        # Create real project
        proj_response = self.client.post("/api/projects", json={"name": "Batch Chapter"})
        project_id = proj_response.json()["id"]

        # Upload batch of 3 files
        batch_files = [
            ("files", ("page01.png", io.BytesIO(TINY_PNG), "image/png")),
            ("files", ("page02.png", io.BytesIO(TINY_PNG), "image/png")),
            ("files", ("page03.png", io.BytesIO(TINY_PNG), "image/png")),
        ]
        response = self.client.post(
            "/api/translate",
            files=batch_files,
            data={"project_id": project_id},
        )
        self.assertEqual(response.status_code, 202)
        jobs = response.json()["jobs"]
        self.assertEqual(len(jobs), 3)

        filenames = [j["filename"] for j in jobs]
        self.assertEqual(filenames, ["page01.png", "page02.png", "page03.png"])

        sequence_ids = [j["sequence_id"] for j in jobs]
        self.assertEqual(sequence_ids, [0, 1, 2])

        # Verify list jobs filtered by project_id
        jobs_res = self.client.get(f"/api/jobs?project_id={project_id}")
        self.assertEqual(jobs_res.status_code, 200)
        proj_jobs = jobs_res.json()
        self.assertEqual([j["sequence_id"] for j in proj_jobs], [0, 1, 2])

    def test_batch_upload_atomic_rollback_on_invalid_file(self) -> None:
        proj_response = self.client.post("/api/projects", json={"name": "Rollback Test"})
        project_id = proj_response.json()["id"]

        batch_files = [
            ("files", ("page01.png", io.BytesIO(TINY_PNG), "image/png")),
            ("files", ("invalid.txt", io.BytesIO(b"invalid text"), "text/plain")),
        ]
        response = self.client.post(
            "/api/translate",
            files=batch_files,
            data={"project_id": project_id},
        )
        self.assertEqual(response.status_code, 415)

    def test_delete_project_cascades_jobs_and_managed_assets(self) -> None:
        proj_response = self.client.post("/api/projects", json={"name": "Cascade Delete Chapter"})
        project_id = proj_response.json()["id"]

        upload_res = self.client.post(
            "/api/translate",
            files=[("files", ("page01.png", io.BytesIO(TINY_PNG), "image/png"))],
            data={"project_id": project_id},
        )
        self.assertEqual(upload_res.status_code, 202)
        job_id = upload_res.json()["jobs"][0]["id"]

        # Delete project
        del_res = self.client.delete(f"/api/projects/{project_id}")
        self.assertEqual(del_res.status_code, 200)
        self.assertEqual(del_res.json()["status"], "deleted")
        self.assertEqual(del_res.json()["cleanup_pending"], False)

        # Confirm project and member jobs are gone
        proj_list = self.client.get("/api/projects").json()
        self.assertEqual(len(proj_list), 0)

        job_status = self.client.get(f"/api/status/{job_id}")
        self.assertEqual(job_status.status_code, 404)

    def test_fifteen_page_batch_session_lifecycle_and_index_performance(self) -> None:
        import time

        create_res = self.client.post("/api/projects", json={"name": "Vol 1 Chapter 15"})
        self.assertEqual(create_res.status_code, 201)
        project_id = create_res.json()["id"]

        batch_files = [
            ("files", (f"page_{i+1:03d}.png", io.BytesIO(TINY_PNG), "image/png"))
            for i in range(15)
        ]
        upload_res = self.client.post(
            "/api/translate",
            files=batch_files,
            data={"project_id": project_id},
        )
        self.assertEqual(upload_res.status_code, 202)
        jobs = upload_res.json()["jobs"]
        self.assertEqual(len(jobs), 15)
        self.assertEqual([j["sequence_id"] for j in jobs], list(range(15)))

        latencies = []
        for _ in range(50):
            start = time.perf_counter()
            res = self.client.get(f"/api/jobs?project_id={project_id}")
            latencies.append((time.perf_counter() - start) * 1000)
            self.assertEqual(res.status_code, 200)

        latencies.sort()
        p95_ms = latencies[int(len(latencies) * 0.95)]
        self.assertLess(p95_ms, 50.0, f"p95 query latency should be under 50ms, got {p95_ms:.2f}ms")

        job_ids = [j["id"] for j in jobs]
        reversed_ids = list(reversed(job_ids))
        reorder_res = self.client.put(
            f"/api/projects/{project_id}/reorder",
            json={"page_order": reversed_ids},
        )
        self.assertEqual(reorder_res.status_code, 200)
        self.assertEqual(reorder_res.json()["page_order"], reversed_ids)

        middle_job_id = reversed_ids[5]
        del_job_res = self.client.delete(f"/api/jobs/{middle_job_id}")
        self.assertEqual(del_job_res.status_code, 200)

        remaining_res = self.client.get(f"/api/jobs?project_id={project_id}")
        self.assertEqual(remaining_res.status_code, 200)
        remaining_jobs = remaining_res.json()
        self.assertEqual(len(remaining_jobs), 14)
        self.assertEqual([j["sequence_id"] for j in remaining_jobs], list(range(14)))

        del_proj_res = self.client.delete(f"/api/projects/{project_id}")
        self.assertEqual(del_proj_res.status_code, 200)
        self.assertEqual(del_proj_res.json()["status"], "deleted")


if __name__ == "__main__":
    unittest.main()
