# Export Package and Delivery Workflow Design

## Context

Completed manga pages currently remain inside backend-managed `uploads/` storage and appear through browser image URLs. Translators, editors, and publishers need a portable chapter handoff containing selected image stages, dialogue tables, and enough metadata to audit page order, layout, tool version, and run configuration.

This feature adds downloadable ZIP packages for one completed job or one fully completed project. It reuses durable project order, persisted regions, and existing source/inpainted/final artifacts. Scope excludes cloud delivery, export history, background export queues, and publishing integrations.

## Delivery Contract

### Endpoints

```http
GET /api/jobs/{job_id}/export
GET /api/projects/{project_id}/export
```

Shared Boolean query parameters:

| Parameter | Default |
|---|---:|
| `include_source` | `false` |
| `include_inpainted` | `false` |
| `include_final` | `true` |
| `include_translations` | `true` |

`metadata.json` is always included. Selecting no content option returns `422`.

A job export requires `status == "completed"`. A project export requires at least one ordered page and every page to be completed. Any incomplete project page rejects the whole request with `409` and identifies blocking page IDs and statuses. Backend is authoritative even when frontend state is stale.

Selected missing or unsafe artifacts fail preflight with `409`, identifying page and artifact without revealing server paths. No partial package is returned.

### Response

Success returns `application/zip` through `StreamingResponse`. `Content-Disposition` supplies sanitized ASCII fallback plus RFC 5987 `filename*` for readable Unicode names. CORS exposes `Content-Disposition` so frontend can preserve server filename.

Errors use existing FastAPI JSON detail shape:

| Condition | Status |
|---|---:|
| Unknown job/project | `404` |
| Empty/incomplete project or incomplete job | `409` |
| Selected artifact missing or unsafe | `409` |
| All options false | `422` |
| ZIP build failure | `500` |

## Archive Contract

Project order comes from durable backend `sequence_id`, loaded through `repository.load_jobs(project_id)`. Frontend order and cached `page_order` do not drive export.

Example:

```text
metadata.json
source/001_page.jpg
inpainted/001_page.png
deliverables/001_page.png
deliverables/001_page.tsv
source/002_next-page.png
inpainted/002_next-page.png
deliverables/002_next-page.png
deliverables/002_next-page.tsv
```

Rules:

- Canonical order assigns three-digit `001`, `002`, … prefixes.
- Sanitized original filename stem remains readable after prefix.
- Numeric prefix prevents duplicate-name collisions.
- Source keeps its actual extension; generated inpainted/final images use `.png`.
- Single-job export follows the same `001_<stem>` naming contract.
- Only selected artifacts are present.
- Image entries use `ZIP_STORED` because source formats are already compressed.
- JSON and TSV are written through `ZipFile.open` without assembling archive-sized buffers.

### Translation TSV

Each selected page gets UTF-8 TSV beside its final deliverable:

```text
region_order	region_id	x	y	width	height	source_text	target_text
```

Rows use persisted region ordinal. Coordinates remain normalized `[0,1]` values from SQLite. TSV quoting and line endings use Python `csv.writer` with tab delimiter.

### `metadata.json`

Metadata schema version 1 contains:

- tool name and runtime package version
- UTC export timestamp
- scope kind, ID, and project/job name
- selected options
- pages in canonical order
- per-page source filename, archive stem, image dimensions, and safe run configuration
- selected artifact archive paths
- ordered region IDs and normalized layout boxes

Every metadata `archive_path` must exist in ZIP. Every ZIP entry except `metadata.json` must map to one metadata artifact. Metadata contains no source or translated dialogue; disabling translation tables removes dialogue from package.

Representative shape:

```json
{
  "schema_version": 1,
  "tool": {"name": "backend", "version": "0.1.0"},
  "exported_at": "2026-07-23T12:00:00+00:00",
  "scope": {"kind": "project", "id": "project-id", "name": "Chapter 1"},
  "selection": {
    "source": false,
    "inpainted": false,
    "final": true,
    "translations": true
  },
  "pages": [
    {
      "index": 1,
      "job_id": "job-id",
      "source_filename": "page.png",
      "archive_stem": "001_page",
      "image": {"width": 1000, "height": 1600},
      "run_configuration": {
        "recorded": true,
        "ocr_model": "glm-ocr",
        "translation_provider": "anthropic",
        "translation_model": "model-id",
        "page_context_translation": true,
        "typesetting_font": "Itim-Regular.ttf",
        "translation_prompt_sha256": "..."
      },
      "artifacts": {
        "final": {
          "archive_path": "deliverables/001_page.png"
        },
        "translations": {
          "archive_path": "deliverables/001_page.tsv"
        }
      },
      "layout": [
        {
          "order": 0,
          "id": "region-id",
          "box": {"x": 0.1, "y": 0.2, "width": 0.3, "height": 0.1}
        }
      ]
    }
  ]
}
```

## Run Configuration Persistence

`backend/repository.py` moves SQLite schema from v2 to v3 with nullable `jobs.run_config_json TEXT`.

At upload acceptance, backend stores only:

- OCR model
- translation provider and model
- page-context translation setting
- typesetting font basename or `null`
- SHA-256 hash of active translation prompt

It never stores or exports API key, custom headers, API base, request headers, or raw prompt. Persisted summary is metadata only; live `BYOKConfig` continues serving active pipeline execution.

Existing jobs have no historical snapshot and export `{"recorded": false}`. Current settings never impersonate historical settings. Null or malformed legacy JSON loads as no snapshot instead of blocking startup.

Migration is additive and transactional. Fresh databases create v3 directly; v1 and v2 databases advance to v3. `PRAGMA user_version` remains guarded against newer unsupported schemas.

Tool version comes from installed distribution metadata, with `backend/pyproject.toml` version fallback for source-tree tests.

## Backend Components and Data Flow

### `backend/export_package.py`

Focused pure helpers own:

- export option validation
- safe archive-name sanitization
- managed asset resolution
- canonical page descriptors
- TSV generation
- metadata generation
- disk ZIP construction
- fixed-size file chunk iteration
- staged-file cleanup

No builder class, plugin interface, or new dependency.

### `backend/main.py`

Routes own:

1. Scope lookup.
2. Completed-state validation.
3. Durable ordered job loading.
4. Region loading.
5. Selected artifact preflight.
6. Threadpool ZIP build call.
7. `StreamingResponse` headers and background cleanup.

Asset resolution converts only `/uploads/...` URLs into local paths. It resolves symlinks and requires every selected path to stay under resolved `UPLOAD_DIR`. User-visible names never become filesystem paths.

### Streaming and cleanup

ZIP delivery uses disk staging because stdlib `zipfile` central directory finalizes only when archive closes. Direct non-seekable HTTP streaming would require custom producer threads, bounded queues, cancellation propagation, and late-error behavior after `200` headers.

Flow:

1. Complete preflight before creating archive.
2. Build ZIP in owned temp export directory with `NamedTemporaryFile(delete=False)` and `ZipFile(..., allowZip64=True)`.
3. Add image files with `ZipFile.write`; no OpenCV, Pillow, NumPy, Torch, or model call.
4. Write TSV and metadata incrementally.
5. Close and validate archive before response headers.
6. Stream file in fixed 64 KiB chunks.
7. Delete staged ZIP through response background task after completion or disconnect.
8. Delete staged ZIP immediately on build failure.
9. On startup, remove stale files only from owned export temp directory after retention window.

This bounds CPU RAM, uses no VRAM, and gives atomic HTTP failure before package delivery begins.

## Frontend Flow

### API client

`frontend/src/features/manga-translator/api/mangaApi.ts` gains typed export options and two Blob download methods. Each method:

- sends query options through Axios `params`
- requests `responseType: "blob"`
- parses exposed `Content-Disposition`, preferring `filename*`
- uses deterministic fallback filename
- creates and clicks a temporary anchor
- revokes object URL afterward
- decodes JSON Blob error detail when possible

### Export dialog

A focused `ExportPackageDialog` presents four labeled checkboxes and shared defaults. It receives scope kind, ID, and display name.

Behavior:

- Submit disabled while preparing or when all options are false.
- Visible text changes to `Preparing download...`.
- Failures remain visible in `role="alert"`.
- Dialog exposes accessible name, close action, labels, and status text.
- No new route, state framework, or dependency.

`MangaFileItem` exposes export only for completed jobs. `ProjectWorkspace` adds project export in header; control is disabled until project has pages and all pages are completed, with explanatory text. Backend still enforces all guards.

## Failure and Consistency Rules

- Project reorder during export: package uses one durable order snapshot loaded during preflight.
- Artifact disappears after preflight but before ZIP close: build fails, staged file is deleted, and no partial response begins.
- Project/job deleted before preflight: `404`.
- Unsafe stored URL or symlink escape: `409`; no server path appears in response.
- Disk or ZIP error: `500`; staged file removed.
- Client disconnect: background cleanup removes staged ZIP.
- Backend crash before cleanup: next startup removes stale owned temp ZIP.
- Legacy job without snapshot: metadata says `recorded: false`.
- Secret-bearing BYOK config: only safe allowlisted summary reaches SQLite or ZIP.

## Testing and Evidence

### Repository

- Fresh v3 schema contains nullable `run_config_json`.
- v1 and v2 fixtures migrate to v3.
- Safe snapshot survives repository close/reopen.
- Malformed JSON returns no snapshot without startup failure.
- API key, custom headers, API base, and raw prompt never persist.

### Backend export

- Completed single job exports default final PNG, TSV, and metadata.
- Completed reordered project exports exact `001`, `002`, … order.
- Every option combination produces exact expected entries.
- All false returns `422`.
- Unknown scope returns `404`.
- Empty/incomplete project and incomplete job return `409` before builder invocation.
- Missing/unsafe selected artifact returns `409` with safe detail.
- Duplicate original names remain collision-free.
- TSV row order and target dialogue match persisted regions.
- Metadata normalized boxes match persisted regions.
- Metadata entry map exactly matches ZIP entries.
- Tool version and UTC timestamp validate.
- Temp directory is empty after successful response and failed build.
- `Path.read_bytes`, `BytesIO`, image pipeline calls, and GPU paths are patched to fail if invoked.
- Chunk iterator never yields more than 64 KiB.

### Frontend

- API methods send exact options and Blob response type.
- Filename parser handles `filename*`, quoted `filename`, and fallback.
- JSON Blob errors surface backend detail.
- Object URLs revoke after download.
- Job export appears only for completed jobs.
- Project export disables for empty or partially complete projects.
- Checkbox selections reach API.
- Loading text and disabled state prevent duplicate submission.
- Failure appears through `role="alert"`.

### Final validation

```bash
cd backend && uv run python -m unittest
cd frontend && npm test && npm run lint && npm run build
```

Then start both services, export one job and one reordered completed project, inspect ZIP names/order/content, compare TSV and metadata with UI regions, and confirm temp export directory is clean.

Before completion, scan feature changes for `TODO`, `FIXME`, `test.skip`, `test.only`, stubs, and unimplemented branches.

## Scope Boundaries

In scope:

- Local browser ZIP download
- Job and project export
- Four artifact options
- Durable safe run snapshot
- Stable naming/order
- JSON layout metadata and TSV dialogue
- Graceful atomic errors
- Bounded-memory streaming delivery

Out of scope:

- Cloud/object-storage delivery
- Email or publisher integrations
- Folder export on server
- Export history or resumable downloads
- Cached/reusable packages
- Partial project export
- Authentication changes
- Unrelated deletion UX or project refactors

## Branch and Change Isolation

Current checkout is `feat/batch-project-sessions`, while requested branch is `feat/export-package-workflow`. Working tree already contains many modified files. Implementation must preserve them: create requested branch only after approval, inspect current changes and dependency commits, never reset or overwrite user work, stage exact feature files/hunks, and never use `git add .` or `git add -A`.
