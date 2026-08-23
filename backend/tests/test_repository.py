import json
import sqlite3
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
                    "sequence_id": 0,
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
            job = reopened.load_jobs("project-1")[0]
            regions = reopened.load_regions("job-1")
            project = reopened.load_projects()[0]

            self.assertEqual(job["status"], "awaiting_review")
            self.assertEqual(job["image_width"], 1000)
            self.assertEqual(job["image_height"], 1600)
            self.assertEqual(job["region_mode"], "detected")
            self.assertEqual(job["sequence_id"], 0)
            self.assertEqual(job["ocr_text"], "one\n---\ntwo")
            self.assertEqual([region.id for region in regions], ["region-2", "region-1"])
            self.assertEqual(regions[0].translated_text, "สอง")
            self.assertEqual(regions[1].mask_path, "masks/job-1-region-1.png")
            self.assertEqual(project["job_ids"], ["job-1"])
            self.assertEqual(project["page_order"], ["job-1"])
            reopened.close()

    def test_typesetting_settings_persisted_and_reopened(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            database_path = Path(temporary_directory) / "state.sqlite3"
            repository = SQLiteReviewRepository(database_path)
            repository.save_job(
                {
                    "id": "job-ts-1",
                    "filename": "page.png",
                    "status": "awaiting_review",
                    "progress": 55,
                    "original_url": "/uploads/page.png",
                    "created_at": "2026-07-31T12:00:00+00:00",
                }
            )
            repository.replace_regions(
                "job-ts-1",
                [
                    RegionRecord(
                        id="region-custom",
                        job_id="job-ts-1",
                        order=0,
                        x=0.1,
                        y=0.1,
                        width=0.4,
                        height=0.3,
                        source="detected",
                        translated_text="ข้อความทดสอบ",
                        font_name="Itim-Regular.ttf",
                        font_size=32,
                        auto_fit=False,
                        text_align="left",
                        padding_ratio=0.15,
                    )
                ],
            )
            repository.close()

            reopened = SQLiteReviewRepository(database_path)
            regions = reopened.load_regions("job-ts-1")
            self.assertEqual(len(regions), 1)
            reg = regions[0]
            self.assertEqual(reg.font_name, "Itim-Regular.ttf")
            self.assertEqual(reg.font_size, 32)
            self.assertFalse(reg.auto_fit)
            self.assertEqual(reg.text_align, "left")
            self.assertAlmostEqual(reg.padding_ratio, 0.15)
            reopened.close()

    def test_v2_to_v3_migration_adds_typesetting_columns(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            database_path = Path(temporary_directory) / "v2_state.sqlite3"
            conn = sqlite3.connect(database_path)
            conn.executescript(
                """
                CREATE TABLE jobs (
                    id TEXT PRIMARY KEY,
                    filename TEXT NOT NULL,
                    status TEXT NOT NULL,
                    progress INTEGER NOT NULL,
                    message TEXT,
                    error TEXT,
                    original_url TEXT,
                    result_url TEXT,
                    inpainted_url TEXT,
                    project_id TEXT,
                    sequence_id INTEGER,
                    image_width INTEGER,
                    image_height INTEGER,
                    region_mode TEXT NOT NULL DEFAULT 'detected',
                    ocr_text TEXT,
                    translated_text TEXT,
                    mask_preview_url TEXT,
                    preview_revision INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE regions (
                    id TEXT NOT NULL,
                    job_id TEXT NOT NULL,
                    ordinal INTEGER NOT NULL,
                    x REAL NOT NULL,
                    y REAL NOT NULL,
                    width REAL NOT NULL,
                    height REAL NOT NULL,
                    source TEXT NOT NULL,
                    source_text TEXT,
                    translated_text TEXT,
                    mask_path TEXT,
                    PRIMARY KEY (job_id, id)
                );

                PRAGMA user_version = 2;
                """
            )
            conn.execute(
                "INSERT INTO jobs (id, filename, status, progress, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                ("job-1", "001.png", "queued", 0, "2026-07-31T12:00:00Z", "2026-07-31T12:00:00Z"),
            )
            conn.execute(
                "INSERT INTO regions (id, job_id, ordinal, x, y, width, height, source, translated_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                ("reg-1", "job-1", 0, 0.1, 0.1, 0.2, 0.2, "manual", "ข้อความดั้งเดิม"),
            )
            conn.commit()
            conn.close()

            repo = SQLiteReviewRepository(database_path)
            regions = repo.load_regions("job-1")
            self.assertEqual(len(regions), 1)
            reg = regions[0]
            self.assertEqual(reg.translated_text, "ข้อความดั้งเดิม")
            self.assertIsNone(reg.font_name)
            self.assertIsNone(reg.font_size)
            self.assertTrue(reg.auto_fit)
            self.assertEqual(reg.text_align, "center")
            self.assertAlmostEqual(reg.padding_ratio, 0.10)
            repo.close()

    def test_v1_to_v2_migration_backfills_sequence_id(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            database_path = Path(temporary_directory) / "v1_state.sqlite3"
            conn = sqlite3.connect(database_path)
            conn.executescript(
                """
                CREATE TABLE jobs (
                    id TEXT PRIMARY KEY,
                    filename TEXT NOT NULL,
                    status TEXT NOT NULL,
                    progress INTEGER NOT NULL,
                    message TEXT,
                    error TEXT,
                    original_url TEXT,
                    result_url TEXT,
                    inpainted_url TEXT,
                    project_id TEXT,
                    image_width INTEGER,
                    image_height INTEGER,
                    region_mode TEXT NOT NULL DEFAULT 'detected',
                    ocr_text TEXT,
                    translated_text TEXT,
                    mask_preview_url TEXT,
                    preview_revision INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE regions (
                    id TEXT NOT NULL,
                    job_id TEXT NOT NULL,
                    ordinal INTEGER NOT NULL,
                    x REAL NOT NULL,
                    y REAL NOT NULL,
                    width REAL NOT NULL,
                    height REAL NOT NULL,
                    source TEXT NOT NULL,
                    source_text TEXT,
                    translated_text TEXT,
                    mask_path TEXT,
                    PRIMARY KEY (job_id, id),
                    UNIQUE (job_id, ordinal),
                    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
                );

                CREATE TABLE projects (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    job_ids_json TEXT NOT NULL,
                    page_order_json TEXT NOT NULL
                );

                PRAGMA user_version = 1;
                """
            )
            conn.execute(
                "INSERT INTO projects VALUES (?, ?, ?, ?, ?)",
                ("proj-1", "V1 Project", "2026-07-17T12:00:00Z", json.dumps(["job-2", "job-1"]), json.dumps(["job-2", "job-1"])),
            )
            conn.execute(
                "INSERT INTO jobs (id, filename, status, progress, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                ("job-1", "001.png", "queued", 0, "proj-1", "2026-07-17T12:00:00Z", "2026-07-17T12:00:00Z"),
            )
            conn.execute(
                "INSERT INTO jobs (id, filename, status, progress, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                ("job-2", "002.png", "queued", 0, "proj-1", "2026-07-17T12:00:01Z", "2026-07-17T12:00:01Z"),
            )
            conn.commit()
            conn.close()

            repo = SQLiteReviewRepository(database_path)
            jobs = repo.load_jobs("proj-1")
            self.assertEqual(len(jobs), 2)
            self.assertEqual(jobs[0]["id"], "job-2")
            self.assertEqual(jobs[0]["sequence_id"], 0)
            self.assertEqual(jobs[1]["id"], "job-1")
            self.assertEqual(jobs[1]["sequence_id"], 1)

            projects = repo.load_projects()
            self.assertEqual(projects[0]["page_order"], ["job-2", "job-1"])
            repo.close()

    def test_create_project_jobs_rolls_back_when_later_job_fails(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            database_path = Path(temporary_directory) / "state.sqlite3"
            repo = SQLiteReviewRepository(database_path)
            repo.save_project(
                {
                    "id": "proj-1",
                    "name": "Rollback Project",
                    "created_at": "2026-07-17T12:00:00Z",
                }
            )

            with self.assertRaises(KeyError):
                repo.create_project_jobs(
                    "proj-1",
                    [
                        {
                            "id": "job-1",
                            "filename": "1.png",
                            "status": "queued",
                            "progress": 0,
                        },
                        {
                            "filename": "2.png",
                            "status": "queued",
                            "progress": 0,
                        },
                    ],
                )

            self.assertEqual(repo.load_jobs("proj-1"), [])
            repo.close()

    def test_v1_migration_resumes_with_existing_sequence_id_and_bad_json(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            database_path = Path(temporary_directory) / "v1_partial.sqlite3"
            conn = sqlite3.connect(database_path)
            conn.executescript(
                """
                CREATE TABLE jobs (
                    id TEXT PRIMARY KEY,
                    filename TEXT NOT NULL,
                    status TEXT NOT NULL,
                    progress INTEGER NOT NULL,
                    message TEXT,
                    error TEXT,
                    original_url TEXT,
                    result_url TEXT,
                    inpainted_url TEXT,
                    project_id TEXT,
                    sequence_id INTEGER,
                    image_width INTEGER,
                    image_height INTEGER,
                    region_mode TEXT NOT NULL DEFAULT 'detected',
                    ocr_text TEXT,
                    translated_text TEXT,
                    mask_preview_url TEXT,
                    preview_revision INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE regions (
                    id TEXT NOT NULL,
                    job_id TEXT NOT NULL,
                    ordinal INTEGER NOT NULL,
                    x REAL NOT NULL,
                    y REAL NOT NULL,
                    width REAL NOT NULL,
                    height REAL NOT NULL,
                    source TEXT NOT NULL,
                    source_text TEXT,
                    translated_text TEXT,
                    mask_path TEXT,
                    PRIMARY KEY (job_id, id),
                    UNIQUE (job_id, ordinal),
                    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
                );

                CREATE TABLE projects (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    job_ids_json TEXT NOT NULL,
                    page_order_json TEXT NOT NULL
                );

                PRAGMA user_version = 1;
                """
            )
            conn.execute(
                "INSERT INTO projects VALUES (?, ?, ?, ?, ?)",
                (
                    "proj-1",
                    "Partial Migration",
                    "2026-07-17T12:00:00Z",
                    '{"bad": true}',
                    '["job-2", "job-1"',
                ),
            )
            conn.execute(
                "INSERT INTO jobs (id, filename, status, progress, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                ("job-1", "001.png", "queued", 0, "proj-1", "2026-07-17T12:00:00Z", "2026-07-17T12:00:00Z"),
            )
            conn.execute(
                "INSERT INTO jobs (id, filename, status, progress, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                ("job-2", "002.png", "queued", 0, "proj-1", "2026-07-17T12:00:01Z", "2026-07-17T12:00:01Z"),
            )
            conn.commit()
            conn.close()

            repo = SQLiteReviewRepository(database_path)
            self.assertEqual(repo._connection.execute("PRAGMA user_version").fetchone()[0], 3)
            table_names = {
                row["name"]
                for row in repo._connection.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table'"
                ).fetchall()
            }
            index_names = {
                row["name"]
                for row in repo._connection.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'index'"
                ).fetchall()
            }

            self.assertIn("pending_asset_deletions", table_names)
            self.assertIn("jobs_project_id_idx", index_names)
            self.assertIn("jobs_sequence_id_idx", index_names)
            self.assertIn("jobs_project_sequence_idx", index_names)

            projects = repo.load_projects()
            self.assertEqual(len(projects), 1)
            self.assertEqual(projects[0]["job_ids"], ["job-1", "job-2"])
            self.assertEqual(projects[0]["page_order"], ["job-1", "job-2"])

            jobs = repo.load_jobs("proj-1")
            self.assertEqual([job["id"] for job in jobs], ["job-1", "job-2"])
            self.assertEqual([job["sequence_id"] for job in jobs], [0, 1])
            repo.close()

    def test_create_project_jobs_and_reorder(self) -> None:
        repo = SQLiteReviewRepository(":memory:")
        repo.save_project({"id": "proj-1", "name": "Manga Vol 1", "created_at": "2026-07-17T12:00:00Z"})

        jobs_in = [
            {"id": "j1", "filename": "p1.png", "status": "queued", "progress": 0},
            {"id": "j2", "filename": "p2.png", "status": "queued", "progress": 0},
            {"id": "j3", "filename": "p3.png", "status": "queued", "progress": 0},
        ]
        created = repo.create_project_jobs("proj-1", jobs_in)
        self.assertEqual([j["sequence_id"] for j in created], [0, 1, 2])

        loaded = repo.load_jobs("proj-1")
        self.assertEqual([j["id"] for j in loaded], ["j1", "j2", "j3"])

        # Reorder to j3, j1, j2
        new_order = repo.reorder_project("proj-1", ["j3", "j1", "j2"])
        self.assertEqual(new_order, ["j3", "j1", "j2"])

        reordered = repo.load_jobs("proj-1")
        self.assertEqual([j["id"] for j in reordered], ["j3", "j1", "j2"])
        self.assertEqual([j["sequence_id"] for j in reordered], [0, 1, 2])

        # Test invalid reorder permutation throws ValueError
        with self.assertRaises(ValueError):
            repo.reorder_project("proj-1", ["j1", "j2"])

        repo.close()

    def test_delete_job_and_compact_renumbers_sequence(self) -> None:
        repo = SQLiteReviewRepository(":memory:")
        repo.save_project({"id": "p1", "name": "Project 1", "created_at": "2026-07-17T12:00:00Z"})
        repo.create_project_jobs(
            "p1",
            [
                {"id": "j1", "filename": "1.png", "status": "queued", "progress": 0, "original_url": "/uploads/1.png"},
                {"id": "j2", "filename": "2.png", "status": "queued", "progress": 0, "original_url": "/uploads/2.png"},
                {"id": "j3", "filename": "3.png", "status": "queued", "progress": 0, "original_url": "/uploads/3.png"},
            ],
        )

        assets = repo.delete_job_and_compact("j2")
        self.assertIn("/uploads/2.png", assets)

        remaining = repo.load_jobs("p1")
        self.assertEqual([j["id"] for j in remaining], ["j1", "j3"])
        self.assertEqual([j["sequence_id"] for j in remaining], [0, 1])
        repo.close()

    def test_delete_project_cascade_and_pending_cleanup_queue(self) -> None:
        repo = SQLiteReviewRepository(":memory:")
        repo.save_project({"id": "p1", "name": "Project 1", "created_at": "2026-07-17T12:00:00Z"})
        repo.create_project_jobs(
            "p1",
            [
                {
                    "id": "j1",
                    "filename": "1.png",
                    "status": "completed",
                    "progress": 100,
                    "original_url": "/uploads/1.png",
                    "result_url": "/results/1.png",
                }
            ],
        )
        repo.replace_regions(
            "j1",
            [
                RegionRecord(
                    id="r1",
                    job_id="j1",
                    order=0,
                    x=0.1,
                    y=0.1,
                    width=0.2,
                    height=0.2,
                    source="detected",
                    mask_path="masks/j1-r1.png",
                )
            ],
        )

        assets = repo.delete_project_cascade("p1")
        self.assertIn("/uploads/1.png", assets)
        self.assertIn("/results/1.png", assets)
        self.assertIn("masks/j1-r1.png", assets)

        self.assertEqual(repo.load_jobs("p1"), [])
        self.assertEqual(repo.load_projects(), [])

        pending = repo.get_pending_asset_deletions()
        self.assertEqual(set(pending), set(assets))

        repo.remove_pending_asset_deletion(assets[0])
        remaining_pending = repo.get_pending_asset_deletions()
        self.assertEqual(len(remaining_pending), len(assets) - 1)
        repo.close()

    def test_indexed_query_plan(self) -> None:
        repo = SQLiteReviewRepository(":memory:")
        plan_rows = repo._connection.execute(
            "EXPLAIN QUERY PLAN SELECT * FROM jobs WHERE project_id = ? ORDER BY sequence_id",
            ("p1",),
        ).fetchall()
        plan_str = " ".join(str(dict(r)) for r in plan_rows)
        self.assertTrue("jobs_project_sequence_idx" in plan_str or "jobs_project_id_idx" in plan_str)
        repo.close()


if __name__ == "__main__":
    unittest.main()
