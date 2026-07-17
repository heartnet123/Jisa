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

    def load_jobs(self) -> list[dict[str, Any]]: ...

    def delete_job(self, job_id: str) -> None: ...

    def replace_regions(
        self, job_id: str, regions: Sequence[RegionRecord]
    ) -> None: ...

    def load_regions(self, job_id: str) -> list[RegionRecord]: ...

    def save_project(self, project: Mapping[str, Any]) -> None: ...

    def load_projects(self) -> list[dict[str, Any]]: ...

    def delete_project(self, project_id: str) -> None: ...

    def close(self) -> None: ...


class SQLiteReviewRepository:
    SCHEMA_VERSION = 1
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

                        CREATE INDEX regions_job_order_idx
                            ON regions(job_id, ordinal);
                        PRAGMA user_version = 1;
                        """
                    )

    def save_job(self, job: Mapping[str, Any]) -> None:
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
        with self._lock, self._connection:
            self._connection.execute(
                f"""
                INSERT INTO jobs ({', '.join(self._JOB_COLUMNS)})
                VALUES ({placeholders})
                ON CONFLICT(id) DO UPDATE SET {assignments}
                """,
                tuple(values[column] for column in self._JOB_COLUMNS),
            )

    def load_jobs(self) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._connection.execute(
                "SELECT * FROM jobs ORDER BY created_at, rowid"
            ).fetchall()
        return [dict(row) for row in rows]

    def delete_job(self, job_id: str) -> None:
        with self._lock, self._connection:
            self._connection.execute("DELETE FROM jobs WHERE id = ?", (job_id,))

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
                    id, name, created_at, job_ids_json, page_order_json
                ) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    job_ids_json = excluded.job_ids_json,
                    page_order_json = excluded.page_order_json
                """,
                (
                    project["id"],
                    project["name"],
                    project["created_at"],
                    json.dumps(project.get("job_ids", [])),
                    json.dumps(project.get("page_order", [])),
                ),
            )

    def load_projects(self) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._connection.execute(
                "SELECT * FROM projects ORDER BY created_at, rowid"
            ).fetchall()
        return [
            {
                "id": row["id"],
                "name": row["name"],
                "created_at": row["created_at"],
                "job_ids": json.loads(row["job_ids_json"]),
                "page_order": json.loads(row["page_order_json"]),
            }
            for row in rows
        ]

    def delete_project(self, project_id: str) -> None:
        with self._lock, self._connection:
            self._connection.execute(
                "DELETE FROM projects WHERE id = ?", (project_id,)
            )

    def close(self) -> None:
        with self._lock:
            self._connection.close()
