from __future__ import annotations

import json
import sqlite3
import threading
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Mapping, Protocol, Sequence


@dataclass(frozen=True)
class RegionRecord:
    id: str
    job_id: str
    order: int
    x: float
    y: float
    width: float
    height: float
    source: str
    source_text: str | None = None
    translated_text: str | None = None
    mask_path: str | None = None


class ReviewRepository(Protocol):
    def save_job(self, job: Mapping[str, Any]) -> None: ...

    def create_project_jobs(
        self, project_id: str, jobs: Sequence[Mapping[str, Any]]
    ) -> list[dict[str, Any]]: ...

    def load_jobs(self, project_id: str | None = None) -> list[dict[str, Any]]: ...

    def reorder_project(
        self, project_id: str, page_order: Sequence[str]
    ) -> list[str]: ...

    def delete_job(self, job_id: str) -> None: ...

    def delete_job_and_compact(self, job_id: str) -> list[str]: ...

    def replace_regions(
        self, job_id: str, regions: Sequence[RegionRecord]
    ) -> None: ...

    def load_regions(self, job_id: str) -> list[RegionRecord]: ...

    def save_project(self, project: Mapping[str, Any]) -> None: ...

    def load_projects(self) -> list[dict[str, Any]]: ...

    def delete_project(self, project_id: str) -> None: ...

    def delete_project_cascade(self, project_id: str) -> list[str]: ...

    def enqueue_pending_asset_deletions(self, paths: Sequence[str]) -> None: ...

    def get_pending_asset_deletions(self) -> list[str]: ...

    def remove_pending_asset_deletion(self, path: str) -> None: ...

    def close(self) -> None: ...



class SQLiteReviewRepository:
    SCHEMA_VERSION = 2
    _JOB_COLUMNS = (
        "id",
        "filename",
        "status",
        "progress",
        "message",
        "error",
        "original_url",
        "result_url",
        "inpainted_url",
        "project_id",
        "sequence_id",
        "image_width",
        "image_height",
        "region_mode",
        "ocr_text",
        "translated_text",
        "mask_preview_url",
        "preview_revision",
        "created_at",
        "updated_at",
    )

    def __init__(self, database_path: Path | str):
        self.database_path = str(database_path)
        if self.database_path != ":memory:":
            Path(self.database_path).parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._connection = sqlite3.connect(
            self.database_path,
            check_same_thread=False,
        )
        self._connection.row_factory = sqlite3.Row
        self._connection.execute("PRAGMA foreign_keys = ON")
        self._migrate()

    def _migrate(self) -> None:
        with self._lock:
            version = int(
                self._connection.execute("PRAGMA user_version").fetchone()[0]
            )
            if version > self.SCHEMA_VERSION:
                raise RuntimeError(
                    f"State database schema {version} is newer than supported "
                    f"schema {self.SCHEMA_VERSION}."
                )
            if version == 0:
                with self._connection:
                    self._connection.executescript(
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
                            job_ids_json TEXT,
                            page_order_json TEXT
                        );

                        CREATE TABLE pending_asset_deletions (
                            path TEXT PRIMARY KEY,
                            created_at TEXT NOT NULL
                        );

                        CREATE INDEX regions_job_order_idx
                            ON regions(job_id, ordinal);

                        CREATE INDEX jobs_project_id_idx
                            ON jobs(project_id);

                        CREATE INDEX jobs_sequence_id_idx
                            ON jobs(sequence_id);

                        CREATE UNIQUE INDEX jobs_project_sequence_idx
                            ON jobs(project_id, sequence_id)
                            WHERE project_id IS NOT NULL;

                        PRAGMA user_version = {self.SCHEMA_VERSION};
                        """
                    )
            elif version == 1:
                self._connection.execute("BEGIN IMMEDIATE")
                try:
                    jobs_columns = self._table_columns("jobs")
                    if "sequence_id" not in jobs_columns:
                        self._connection.execute(
                            "ALTER TABLE jobs ADD COLUMN sequence_id INTEGER"
                        )

                    self._connection.execute(
                        """
                        CREATE TABLE IF NOT EXISTS pending_asset_deletions (
                            path TEXT PRIMARY KEY,
                            created_at TEXT NOT NULL
                        )
                        """
                    )
                    self._connection.execute(
                        "CREATE INDEX IF NOT EXISTS jobs_project_id_idx ON jobs(project_id)"
                    )
                    self._connection.execute(
                        "CREATE INDEX IF NOT EXISTS jobs_sequence_id_idx ON jobs(sequence_id)"
                    )
                    self._connection.execute(
                        """
                        CREATE UNIQUE INDEX IF NOT EXISTS jobs_project_sequence_idx
                            ON jobs(project_id, sequence_id)
                            WHERE project_id IS NOT NULL
                        """
                    )

                    projects = self._connection.execute(
                        "SELECT id, job_ids_json, page_order_json FROM projects"
                    ).fetchall()
                    for proj in projects:
                        project_id = proj["id"]
                        page_order_raw = self._json_list_or_empty(proj["page_order_json"])
                        job_ids_raw = self._json_list_or_empty(proj["job_ids_json"])

                        self._connection.execute(
                            "UPDATE jobs SET sequence_id = NULL WHERE project_id = ?",
                            (project_id,),
                        )

                        db_jobs = self._connection.execute(
                            "SELECT id FROM jobs WHERE project_id = ? ORDER BY created_at, rowid",
                            (project_id,),
                        ).fetchall()
                        db_job_ids = {row["id"] for row in db_jobs}

                        ordered_ids: list[str] = []
                        for jid in page_order_raw:
                            if jid in db_job_ids and jid not in ordered_ids:
                                ordered_ids.append(jid)
                        for jid in job_ids_raw:
                            if jid in db_job_ids and jid not in ordered_ids:
                                ordered_ids.append(jid)
                        for row in db_jobs:
                            jid = row["id"]
                            if jid not in ordered_ids:
                                ordered_ids.append(jid)

                        for seq_idx, jid in enumerate(ordered_ids):
                            self._connection.execute(
                                "UPDATE jobs SET sequence_id = ? WHERE id = ?",
                                (seq_idx, jid),
                            )

                    self._connection.execute(f"PRAGMA user_version = {self.SCHEMA_VERSION}")
                except Exception:
                    self._connection.rollback()
                    raise
                else:
                    self._connection.commit()

    @staticmethod
    def _json_list_or_empty(raw: Any) -> list[str]:
        if not isinstance(raw, str):
            return []
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return []
        if not isinstance(parsed, list):
            return []
        return [item for item in parsed if isinstance(item, str)]

    def _table_columns(self, table_name: str) -> set[str]:
        rows = self._connection.execute(f"PRAGMA table_info({table_name})").fetchall()
        return {row["name"] for row in rows}

    def _save_job_locked(self, job: Mapping[str, Any]) -> None:
        now = datetime.now(UTC).isoformat()
        values = {
            "id": str(job["id"]),
            "filename": str(job.get("filename") or "upload.png"),
            "status": str(job.get("status") or "queued"),
            "progress": int(job.get("progress") or 0),
            "message": job.get("message"),
            "error": job.get("error"),
            "original_url": job.get("original_url"),
            "result_url": job.get("result_url"),
            "inpainted_url": job.get("inpainted_url"),
            "project_id": job.get("project_id"),
            "sequence_id": job.get("sequence_id"),
            "image_width": job.get("image_width"),
            "image_height": job.get("image_height"),
            "region_mode": str(job.get("region_mode") or "detected"),
            "ocr_text": job.get("ocr_text"),
            "translated_text": job.get("translated_text"),
            "mask_preview_url": job.get("mask_preview_url"),
            "preview_revision": int(job.get("preview_revision") or 0),
            "created_at": str(job.get("created_at") or now),
            "updated_at": now,
        }
        placeholders = ", ".join("?" for _ in self._JOB_COLUMNS)
        assignments = ", ".join(
            f"{column} = excluded.{column}"
            for column in self._JOB_COLUMNS
            if column not in {"id", "created_at"}
        )
        self._connection.execute(
            f"""
            INSERT INTO jobs ({', '.join(self._JOB_COLUMNS)})
            VALUES ({placeholders})
            ON CONFLICT(id) DO UPDATE SET {assignments}
            """,
            tuple(values[column] for column in self._JOB_COLUMNS),
        )

    def save_job(self, job: Mapping[str, Any]) -> None:
        with self._lock, self._connection:
            self._save_job_locked(job)

    def create_project_jobs(
        self, project_id: str, jobs: Sequence[Mapping[str, Any]]
    ) -> list[dict[str, Any]]:
        with self._lock, self._connection:
            cur = self._connection.execute(
                "SELECT COALESCE(MAX(sequence_id), -1) FROM jobs WHERE project_id = ?",
                (project_id,),
            )
            max_seq = cur.fetchone()[0]
            start_seq = max_seq + 1

            saved_jobs = []
            for i, job_input in enumerate(jobs):
                job_dict = dict(job_input)
                job_dict["project_id"] = project_id
                job_dict["sequence_id"] = start_seq + i
                self._save_job_locked(job_dict)
                saved_jobs.append(job_dict)
            return saved_jobs

    def load_jobs(self, project_id: str | None = None) -> list[dict[str, Any]]:
        with self._lock:
            if project_id is not None:
                rows = self._connection.execute(
                    "SELECT * FROM jobs WHERE project_id = ? ORDER BY sequence_id, created_at, rowid",
                    (project_id,),
                ).fetchall()
            else:
                rows = self._connection.execute(
                    "SELECT * FROM jobs ORDER BY created_at, rowid"
                ).fetchall()
        return [dict(row) for row in rows]

    def reorder_project(
        self, project_id: str, page_order: Sequence[str]
    ) -> list[str]:
        with self._lock, self._connection:
            existing_jobs = self._connection.execute(
                "SELECT id FROM jobs WHERE project_id = ?", (project_id,)
            ).fetchall()
            existing_ids = {row["id"] for row in existing_jobs}
            new_order_ids = list(page_order)

            if len(new_order_ids) != len(existing_ids) or set(new_order_ids) != existing_ids:
                raise ValueError(
                    f"Page order must be an exact permutation of project jobs. "
                    f"Expected {existing_ids}, got {new_order_ids}"
                )

            # Use negative temporary sequences to avoid unique index collisions
            for idx, jid in enumerate(new_order_ids):
                self._connection.execute(
                    "UPDATE jobs SET sequence_id = ? WHERE id = ?",
                    (-1 - idx, jid),
                )
            for idx, jid in enumerate(new_order_ids):
                self._connection.execute(
                    "UPDATE jobs SET sequence_id = ? WHERE id = ?",
                    (idx, jid),
                )
            return new_order_ids

    def delete_job(self, job_id: str) -> None:
        with self._lock, self._connection:
            self._connection.execute("DELETE FROM jobs WHERE id = ?", (job_id,))

    def delete_job_and_compact(self, job_id: str) -> list[str]:
        with self._lock, self._connection:
            job_row = self._connection.execute(
                "SELECT project_id, original_url, result_url, inpainted_url, mask_preview_url FROM jobs WHERE id = ?",
                (job_id,),
            ).fetchone()
            if not job_row:
                return []

            project_id = job_row["project_id"]

            # Collect asset paths for this job
            asset_paths: list[str] = []
            for col in ("original_url", "result_url", "inpainted_url", "mask_preview_url"):
                val = job_row[col]
                if val:
                    asset_paths.append(val)

            regions = self._connection.execute(
                "SELECT mask_path FROM regions WHERE job_id = ?", (job_id,)
            ).fetchall()
            for r in regions:
                if r["mask_path"]:
                    asset_paths.append(r["mask_path"])

            # Delete the job (cascades to regions)
            self._connection.execute("DELETE FROM jobs WHERE id = ?", (job_id,))

            # Compact remaining sequence for project
            if project_id:
                remaining = self._connection.execute(
                    "SELECT id FROM jobs WHERE project_id = ? ORDER BY sequence_id, created_at, rowid",
                    (project_id,),
                ).fetchall()
                for idx, r in enumerate(remaining):
                    self._connection.execute(
                        "UPDATE jobs SET sequence_id = ? WHERE id = ?",
                        (idx, r["id"]),
                    )

            if asset_paths:
                now = datetime.now(UTC).isoformat()
                self._connection.executemany(
                    "INSERT OR IGNORE INTO pending_asset_deletions (path, created_at) VALUES (?, ?)",
                    [(p, now) for p in asset_paths],
                )

            return asset_paths

    def delete_project_cascade(self, project_id: str) -> list[str]:
        with self._lock, self._connection:
            job_rows = self._connection.execute(
                "SELECT id, original_url, result_url, inpainted_url, mask_preview_url FROM jobs WHERE project_id = ?",
                (project_id,),
            ).fetchall()

            asset_paths: list[str] = []
            job_ids: list[str] = []
            for jrow in job_rows:
                job_ids.append(jrow["id"])
                for col in ("original_url", "result_url", "inpainted_url", "mask_preview_url"):
                    val = jrow[col]
                    if val:
                        asset_paths.append(val)

            if job_ids:
                placeholders = ", ".join("?" for _ in job_ids)
                region_rows = self._connection.execute(
                    f"SELECT mask_path FROM regions WHERE job_id IN ({placeholders})",
                    tuple(job_ids),
                ).fetchall()
                for r in region_rows:
                    if r["mask_path"]:
                        asset_paths.append(r["mask_path"])

            # Delete all jobs for project (cascades to regions)
            self._connection.execute("DELETE FROM jobs WHERE project_id = ?", (project_id,))
            # Delete project row
            self._connection.execute("DELETE FROM projects WHERE id = ?", (project_id,))

            if asset_paths:
                now = datetime.now(UTC).isoformat()
                self._connection.executemany(
                    "INSERT OR IGNORE INTO pending_asset_deletions (path, created_at) VALUES (?, ?)",
                    [(p, now) for p in asset_paths],
                )

            return asset_paths

    def enqueue_pending_asset_deletions(self, paths: Sequence[str]) -> None:
        if not paths:
            return
        now = datetime.now(UTC).isoformat()
        with self._lock, self._connection:
            self._connection.executemany(
                "INSERT OR IGNORE INTO pending_asset_deletions (path, created_at) VALUES (?, ?)",
                [(p, now) for p in paths],
            )

    def get_pending_asset_deletions(self) -> list[str]:
        with self._lock:
            rows = self._connection.execute(
                "SELECT path FROM pending_asset_deletions ORDER BY created_at"
            ).fetchall()
        return [row["path"] for row in rows]

    def remove_pending_asset_deletion(self, path: str) -> None:
        with self._lock, self._connection:
            self._connection.execute(
                "DELETE FROM pending_asset_deletions WHERE path = ?", (path,)
            )

    def replace_regions(
        self, job_id: str, regions: Sequence[RegionRecord]
    ) -> None:
        rows = []
        for order, region in enumerate(regions):
            record = asdict(region)
            record["job_id"] = job_id
            record["order"] = order
            rows.append(record)

        with self._lock, self._connection:
            self._connection.execute("DELETE FROM regions WHERE job_id = ?", (job_id,))
            self._connection.executemany(
                """
                INSERT INTO regions (
                    id, job_id, ordinal, x, y, width, height, source,
                    source_text, translated_text, mask_path
                ) VALUES (
                    :id, :job_id, :order, :x, :y, :width, :height, :source,
                    :source_text, :translated_text, :mask_path
                )
                """,
                rows,
            )

    def load_regions(self, job_id: str) -> list[RegionRecord]:
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT id, job_id, ordinal, x, y, width, height, source,
                       source_text, translated_text, mask_path
                FROM regions
                WHERE job_id = ?
                ORDER BY ordinal
                """,
                (job_id,),
            ).fetchall()
        return [
            RegionRecord(
                id=row["id"],
                job_id=row["job_id"],
                order=row["ordinal"],
                x=row["x"],
                y=row["y"],
                width=row["width"],
                height=row["height"],
                source=row["source"],
                source_text=row["source_text"],
                translated_text=row["translated_text"],
                mask_path=row["mask_path"],
            )
            for row in rows
        ]

    def save_project(self, project: Mapping[str, Any]) -> None:
        with self._lock, self._connection:
            self._connection.execute(
                """
                INSERT INTO projects (
                    id, name, created_at
                ) VALUES (?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name
                """,
                (
                    project["id"],
                    project["name"],
                    project["created_at"],
                ),
            )

    def load_projects(self) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._connection.execute(
                "SELECT * FROM projects ORDER BY created_at, rowid"
            ).fetchall()

            projects = []
            for row in rows:
                proj_id = row["id"]
                job_rows = self._connection.execute(
                    "SELECT id FROM jobs WHERE project_id = ? ORDER BY sequence_id, created_at, rowid",
                    (proj_id,),
                ).fetchall()
                derived_ids = [j["id"] for j in job_rows]

                projects.append(
                    {
                        "id": proj_id,
                        "name": row["name"],
                        "created_at": row["created_at"],
                        "job_ids": derived_ids,
                        "page_order": derived_ids,
                    }
                )
        return projects

    def delete_project(self, project_id: str) -> None:
        with self._lock, self._connection:
            self._connection.execute(
                "DELETE FROM projects WHERE id = ?", (project_id,)
            )

    def close(self) -> None:
        with self._lock:
            self._connection.close()
