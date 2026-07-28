import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

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

    def test_batch_upload_rejects_too_many_files_before_staging(self) -> None:
        original_upload_dir = main.UPLOAD_DIR
        original_mask_dir = main.MASK_DIR
        original_max_batch_files = getattr(main, "MAX_BATCH_UPLOAD_FILES", None)

        upload_dir = Path(self._temporary_directory.name) / "batch-limit-uploads"
        mask_dir = upload_dir / "masks"
        upload_dir.mkdir(parents=True, exist_ok=True)
        mask_dir.mkdir(parents=True, exist_ok=True)

        main.UPLOAD_DIR = upload_dir
        main.MASK_DIR = mask_dir
        main.MAX_BATCH_UPLOAD_FILES = 2

        try:
            response = self.client.post(
                "/api/translate",
                files=[
                    ("files", ("page01.png", io.BytesIO(TINY_PNG), "image/png")),
                    ("files", ("page02.png", io.BytesIO(TINY_PNG), "image/png")),
                    ("files", ("page03.png", io.BytesIO(TINY_PNG), "image/png")),
                ],
            )
        finally:
            main.UPLOAD_DIR = original_upload_dir
            main.MASK_DIR = original_mask_dir
            if original_max_batch_files is None:
                delattr(main, "MAX_BATCH_UPLOAD_FILES")
            else:
                main.MAX_BATCH_UPLOAD_FILES = original_max_batch_files

        self.assertEqual(response.status_code, 413)
        self.assertIn("Too many files", response.json()["detail"])
        self.assertEqual(list(upload_dir.glob("temp_*")), [])

    def test_safe_unlink_asset_limits_deletion_to_managed_roots(self) -> None:
        original_upload_dir = main.UPLOAD_DIR
        original_mask_dir = main.MASK_DIR
        upload_dir = Path(self._temporary_directory.name) / "managed-uploads"
        mask_dir = upload_dir / "masks"
        upload_dir.mkdir(parents=True, exist_ok=True)
        mask_dir.mkdir(parents=True, exist_ok=True)

        main.UPLOAD_DIR = upload_dir
        main.MASK_DIR = mask_dir
        self.addCleanup(setattr, main, "UPLOAD_DIR", original_upload_dir)
        self.addCleanup(setattr, main, "MASK_DIR", original_mask_dir)

        upload_asset = upload_dir / "page-01.png"
        upload_asset.write_bytes(TINY_PNG)
        mask_asset = mask_dir / "mask-01.png"
        mask_asset.write_bytes(TINY_PNG)
        unsafe_workspace_asset = Path("safe_unlink_workspace_guard.tmp")
        unsafe_workspace_asset.write_bytes(TINY_PNG)
        self.addCleanup(lambda: unsafe_workspace_asset.unlink(missing_ok=True))

        self.assertTrue(main._safe_unlink_asset("/uploads/page-01.png"))
        self.assertFalse(upload_asset.exists())

        self.assertTrue(main._safe_unlink_asset(str(mask_asset)))
        self.assertFalse(mask_asset.exists())

        self.assertFalse(main._safe_unlink_asset(unsafe_workspace_asset.name))
        self.assertTrue(unsafe_workspace_asset.exists())

    def test_delete_job_uses_repository_asset_cleanup_and_clears_pending_entries(self) -> None:
        job_id = "job-delete-high-test"
        project_id = "project-delete-high-test"
        temp_dir = Path(self._temporary_directory.name)
        returned_paths = [
            "/uploads/original-delete.png",
            "/uploads/result-delete.png",
            "/uploads/inpainted-delete.png",
            "/uploads/mask-preview-delete.png",
            str(temp_dir / "mask-delete.png"),
        ]
        helper_calls: list[str] = []
        removed_pending: list[str] = []

        class FakeRepository:
            def delete_job_and_compact(self, job_id_arg: str) -> list[str]:
                self.deleted_job_id = job_id_arg
                return list(returned_paths)

            def get_pending_asset_deletions(self) -> list[str]:
                return []

            def remove_pending_asset_deletion(self, path: str) -> None:
                removed_pending.append(path)

            def load_regions(self, job_id_arg: str) -> list[object]:
                self.loaded_region_job_id = job_id_arg
                return [
                    main.RegionRecord(
                        id="region-1",
                        job_id=job_id_arg,
                        order=0,
                        x=0.0,
                        y=0.0,
                        width=1.0,
                        height=1.0,
                        source="manual",
                        mask_path=str(temp_dir / "mask-delete.png"),
                    )
                ]

            def load_jobs(self, project_id: str | None = None) -> list[dict[str, object]]:
                self.loaded_jobs_project_id = project_id
                return [{"id": "remaining-job", "sequence_id": 0}] if project_id else []

            def load_projects(self) -> list[dict[str, object]]:
                return [
                    {
                        "id": project_id,
                        "job_ids": ["remaining-job"],
                        "page_order": ["remaining-job"],
                    }
                ]

            def save_job(self, job: dict[str, object]) -> None:
                pass

            def save_project(self, project: dict[str, object]) -> None:
                pass

            def delete_job(self, job_id: str) -> None:
                pass

            def replace_regions(self, job_id: str, regions: list[object]) -> None:
                pass

            def enqueue_pending_asset_deletions(self, paths: list[str]) -> None:
                pass

            def close(self) -> None:
                pass

        fake_repository = FakeRepository()
        original_repository = main.repository
        main.set_repository(fake_repository)
        self.addCleanup(main.set_repository, original_repository)

        main.jobs_db[job_id] = {
            "id": job_id,
            "filename": "page-01.png",
            "status": "queued",
            "progress": 0,
            "project_id": project_id,
            "sequence_id": 0,
            "original_url": returned_paths[0],
            "result_url": returned_paths[1],
            "inpainted_url": returned_paths[2],
            "mask_preview_url": returned_paths[3],
        }
        main.projects_db[project_id] = {"id": project_id, "job_ids": [job_id], "page_order": [job_id]}

        def fake_safe_unlink_asset(raw_path_or_url: str) -> bool:
            helper_calls.append(raw_path_or_url)
            return True

        with patch.object(main.Path, "unlink", side_effect=AssertionError("direct unlink is not allowed")), patch.object(
            main,
            "_safe_unlink_asset",
            side_effect=fake_safe_unlink_asset,
        ):
            response = self.client.delete(f"/api/jobs/{job_id}")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(fake_repository.deleted_job_id, job_id)
        for expected_path in returned_paths:
            self.assertIn(expected_path, helper_calls)
        self.assertEqual(removed_pending, returned_paths)
        self.assertNotIn(job_id, main.jobs_db)
        self.assertEqual(main.projects_db[project_id]["job_ids"], ["remaining-job"])
        self.assertEqual(main.projects_db[project_id]["page_order"], ["remaining-job"])

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

        proj_jobs = self.client.get(f"/api/jobs?project_id={project_id}").json()
        self.assertEqual(proj_jobs, [])

        projects = self.client.get("/api/projects").json()
        target_proj = next((p for p in projects if p["id"] == project_id), None)
        self.assertIsNotNone(target_proj)
        self.assertEqual(target_proj.get("job_ids", []), [])

        temp_files = list(main.UPLOAD_DIR.glob("temp_*"))
        self.assertEqual(temp_files, [])

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
