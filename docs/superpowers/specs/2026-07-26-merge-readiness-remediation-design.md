# Merge-Readiness Remediation Design

**Status:** Approved for implementation planning
**Date:** 2026-07-26
**Branch:** `feat/batch-project-sessions`
**Target:** `origin/main`

## 1. Context

The merge-readiness review found that the branch's intended project batch-upload, ordering, deletion, and BYOK behavior is not yet safe to merge.

The highest-risk failures are:

1. `backend/repository.py` commits each job independently from `create_project_jobs()`, so a batch can persist partially.
2. `backend/main.py` finalizes uploaded files before the batch is durably committed, with no complete compensation or crash-recovery record.
3. The v1-to-v2 migration performs schema changes before legacy data backfill finishes, so a failed migration can leave `user_version = 1` with v2 columns already present and fail every later startup.
4. Project deletion can race uploads and workers because project existence is checked only once, active work is not coordinated durably, and process-local caches are treated as authoritative.
5. The frontend deletion, reorder, and BYOK flows can remain stale or violate their documented contracts without an SSE repair event.
6. The frontend lint gate currently fails.

The chosen approach is a small coordination layer rather than an in-place patch or a full persistent workflow engine.

## 2. Goals

- Make a project batch upload all-or-nothing for handled runtime failures.
- Recover deterministically after a process crash during batch finalization.
- Make project-operation coordination safe across multiple processes sharing the same SQLite database and upload filesystem.
- Reject project deletion with `409 Conflict` while any unexpired project operation is active.
- Support lease cancellation, heartbeats, and expiration without allowing a stale worker to continue durable writes.
- Make schema migration atomic, idempotent, restart-safe, and capable of repairing the known partially applied v1-to-v2 state.
- Keep repository state authoritative for integrity decisions.
- Correct frontend deletion, reorder, and BYOK state without depending on SSE timing.
- Add bounded batch resource usage and restore all repository quality gates.

## 3. Non-goals

- A general-purpose distributed workflow engine.
- Automatic cancellation of active work when a user requests project deletion. Deletion remains a retryable `409` while work is active.
- Multi-host coordination when processes do not share the same SQLite file and upload filesystem. That topology requires a shared database and distributed storage or lock service.
- Cross-process SSE fanout. The current Docker deployment runs one Uvicorn worker. Data integrity will be multi-process-safe on shared storage, but a future multi-worker real-time UI requires shared pub/sub.
- Durable storage of request-scoped BYOK API keys. Secrets must not be written to the batch journal or jobs database.
- Unrelated repository refactoring.

## 4. Decisions

### 4.1 Coordination boundary

Add a `ProjectOperationCoordinator` as a thin service over SQLite-backed leases. It owns shared/exclusive acquisition, heartbeat renewal, cancellation checks, expiration, and release. It does not own project or job business data.

The repository remains the source of truth for project existence and durable job state. `jobs_db` and `projects_db` remain process-local execution/UI caches and must not be used to authorize a write, decide whether deletion is safe, or recreate a missing durable row.

### 4.2 Deletion behavior

Deletion uses an exclusive project lease. If any unexpired shared or exclusive lease exists, the API returns `409 Conflict`. It does not request cancellation. The caller may retry after work becomes idle.

### 4.3 Filesystem and database consistency

SQLite and filesystem renames cannot share one physical transaction. Batch upload therefore uses both:

1. a durable upload-batch journal written before finalization, and
2. explicit compensation for every staged or finalized path when the database transaction does not commit.

Crash recovery uses the journal manifest to resolve any incomplete state.

### 4.4 Migration version

The new schema version is v3. Fresh databases are created directly at v3. Existing v1 and v2 databases migrate in ordered, explicit steps.

## 5. Durable Project Leases

### 5.1 Table

Add `project_operation_leases` with these logical fields:

- `lease_id TEXT PRIMARY KEY`
- `project_id TEXT`, nullable only for standalone resource leases
- `operation_kind TEXT NOT NULL`, such as `upload`, `translate`, `resume`, `recovery`, or `delete`
- `resource_id TEXT`, such as a batch or job ID
- `lock_mode TEXT NOT NULL`, constrained to `shared` or `exclusive`
- `owner_id TEXT NOT NULL`, unique to the application process
- `state TEXT NOT NULL`, constrained to `active` or `cancel_requested`
- `acquired_at TEXT NOT NULL`
- `heartbeat_at TEXT NOT NULL`
- `expires_at TEXT NOT NULL`
- `cancel_requested_at TEXT`
- optional foreign key from `project_id` to `projects(id)` with `ON DELETE CASCADE`; project-scoped shared or exclusive leases require a non-null project ID

Indexes must support project conflict checks, expiration cleanup, owner heartbeats, and resource cancellation.

### 5.2 SQLite settings

Every coordinator/repository connection enables:

- `PRAGMA foreign_keys = ON`
- `PRAGMA journal_mode = WAL`
- a bounded `busy_timeout`

Lease acquisition uses `BEGIN IMMEDIATE` so conflict checks and insertion are serialized across processes sharing `state.sqlite3`. A lock timeout is an infrastructure failure and maps to `503 Service Unavailable`, not `409 Project Busy`.

### 5.3 Acquisition rules

Shared project acquisition performs one transaction:

1. remove or mark expired leases,
2. verify the project still exists in SQLite,
3. verify no unexpired exclusive lease exists,
4. insert the shared lease,
5. commit.

Exclusive deletion acquisition performs one transaction:

1. remove or mark expired leases,
2. verify the project exists,
3. verify no unexpired lease exists,
4. insert the exclusive lease,
5. commit.

An exclusive recovery lease follows the same rule and is used to reconcile an abandoned batch whose associated lease is absent or expired. Recovery may instead run under an already-held exclusive deletion lease; it must never acquire a nested exclusive lease for the same project.

### 5.4 Heartbeat, cancellation, and expiration

A process-level coordinator heartbeat loop renews all locally owned active leases and upload-journal claims through a dedicated SQLite connection. It must not depend solely on the FastAPI request event loop because image/model stages can block that loop.

Defaults are configurable:

- `PROJECT_LEASE_TTL_SECONDS=180`
- `PROJECT_LEASE_HEARTBEAT_SECONDS=30`

Startup validates that the heartbeat interval is no more than one third of the TTL.

The process owner ID combines a fresh startup UUID with process metadata; a PID alone is not sufficient because PIDs are reused.

Workers check lease validity and cancellation:

- before each major pipeline stage,
- before each filesystem finalization,
- before each durable database write.

If the lease is canceled, expired, replaced, or otherwise lost, the worker stops and must not perform later writes. Release is idempotent and happens in `finally`. Graceful shutdown releases owned leases, while expiration remains the crash-safety mechanism.

The existing job-cancel action requests cancellation on the matching worker lease and updates the job consistently. Project deletion never invokes this cancellation path.

### 5.5 Defensive durable writes

Creation and update are separated:

- batch or standalone creation uses explicit insert methods,
- worker progress uses update-only methods that fail or no-op when the job no longer exists,
- a worker must never use an upsert to recreate a job removed by project deletion.

This remains a final integrity guard if a worker loses its lease at a stage boundary.

### 5.6 Atomic lease fencing

A separate `ensure_active()` call is advisory and is not sufficient for a durable mutation. Every durable write that depends on a project lease must be fenced by the exact `lease_id` in the same `BEGIN IMMEDIATE` transaction as the write:

1. load the exact lease row,
2. verify its project, owner, resource, mode, state, and unexpired timestamp,
3. renew its expiry,
4. perform the database mutation,
5. commit once.

If the lease row is missing, expired, canceled, or replaced, the mutation does not run. Because deletion acquisition requires the same SQLite write lock, an exclusive delete cannot interleave between lease validation and the guarded mutation. The unique lease ID is the fencing token; a stale worker cannot act through a newer lease.

Generated original, inpainted, final, and mask assets are first written to temporary paths. Final `os.replace()` and the related job/region database update occur while the fenced write transaction is held. If finalization raises, the temporary/final path is compensated. If commit outcome is uncertain, a fresh connection verifies the durable job/region state before any file is removed. When the database outcome cannot be determined, files are left in place for recovery rather than deleted speculatively.

Process-local cache updates happen only after the fenced durable write succeeds.

## 6. Durable Batch Journal

### 6.1 Table and job linkage

Add nullable `batch_id` to `jobs` and add `upload_batch_journal` with these logical fields:

- `batch_id TEXT PRIMARY KEY`
- `project_id TEXT`
- `lease_id TEXT`
- `staging_dir TEXT NOT NULL`
- `state TEXT NOT NULL`
- `manifest_json TEXT NOT NULL`
- `error TEXT`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`
- `claim_token TEXT`
- `claim_owner_id TEXT`
- `claim_expires_at TEXT`

Journal states are:

- `receiving`: the request is streaming into a known staging directory under an active claim,
- `staged`: all request files are closed in staging and the durable manifest exists,
- `committed`: job rows and all final file locations committed successfully,
- `compensation_pending`: rollback completed but one or more files still require cleanup,
- `compensated`: all noncommitted files were removed,
- `reconciled`: startup or on-demand recovery verified the final state.

Transient `applying` state may be written inside the main database transaction, but because it is not visible before commit, recovery must remain correct when the durable state is still `staged`.

The manifest contains only non-secret reconciliation data: job IDs, normalized filenames, staged paths, final paths, byte sizes, and project ID. It must not contain BYOK keys or authorization headers. Every compensation and recovery path revalidates manifest paths beneath the configured upload or staging root before deleting anything.

Every batch, including a standalone batch with no project, has an exclusive journal claim. Active upload code creates and heartbeats that claim with the staged journal. Recovery claims an incomplete journal through one compare-and-set transaction only when the prior claim is absent or expired. The claim token is revalidated before each recovery state change or destructive filesystem action and is cleared only after the journal reaches a stable state. If a recovery process crashes, claim expiration allows another process to continue. A project recovery additionally holds the project-exclusive recovery or deletion lease; the journal claim is still required and prevents two recoverers from acting on the same batch.

### 6.2 Staging and limits

Files stage beneath `uploads/.staging/<batch-id>/`, on the same filesystem as their final paths so each `os.replace()` is an atomic single-file rename.

Uploads stream to disk in bounded chunks instead of retaining every file body in memory. The endpoint enforces:

- the existing per-file size limit,
- `MAX_BATCH_FILES`, default `50`,
- `MAX_BATCH_UPLOAD_SIZE_BYTES`, default `250 MiB`.

It rejects an excessive file count before reading bodies and rejects an aggregate-size overflow as soon as the streamed counter crosses the limit. Any rejection removes the batch staging directory and creates no jobs.

### 6.3 Commit flow

For a project batch:

1. Acquire a shared project upload lease when `project_id` is present.
2. Generate the batch and claim tokens, create the staging directory, and persist a `receiving` journal row with the active claim before reading file bodies. Standalone uploads begin here because they have no project lease.
3. Stream, validate, and close every file in the batch staging directory while heartbeating the claim.
4. Update the journal to `staged` with the complete manifest in a short transaction.
5. Begin one `BEGIN IMMEDIATE` database transaction.
6. Revalidate the project inside that transaction when `project_id` is present.
7. Allocate contiguous sequence IDs for project jobs; standalone jobs retain a null sequence.
8. Insert all job rows with the same `batch_id`, without nested commits.
9. Insert all per-job worker leases in the same transaction. Project jobs receive shared project leases; standalone jobs receive resource leases with a null project ID. The existing upload lease guarantees that an exclusive delete cannot appear between the conflict check and these inserts.
10. Rename every staged file to its final path with `os.replace()`.
11. Mark the journal `committed` in the same transaction as the job rows and worker leases.
12. Commit once.
13. Mirror committed rows into the current process cache and register one batch-runner callback with `BackgroundTasks`; that callback owns dispatch of the complete job set.
14. If callback registration unexpectedly fails, atomically mark every committed job failed, release all worker leases, and return the committed failed jobs in the normal `202` response so the client does not retry the upload and create duplicates. No subset may run.
15. Release the upload lease and journal claim only after callback registration removes the deletion and recovery race windows.

Standalone, non-project uploads use the same journal and compensation machinery but do not require a project lease or sequence allocation.

### 6.4 Runtime compensation

Failure handling distinguishes a known rollback from an uncertain commit outcome.

For any failure before `commit()` is attempted:

1. roll back the SQLite transaction,
2. remove every staged path and every final path listed in the manifest,
3. remove the staging directory,
4. mark the journal `compensated`, or `compensation_pending` if any cleanup fails,
5. return an error that includes a safe batch correlation ID but no local filesystem paths.

If `commit()` raises, the code must not assume rollback. It opens a fresh SQLite connection and verifies the journal plus expected job rows:

- `committed` with the complete expected row set means the commit succeeded; keep all final files and continue the committed path,
- `staged` with no batch jobs means the commit did not succeed; run normal compensation,
- a mixed result or unavailable database is indeterminate; delete nothing, retain the journal/claim for recovery, and return HTTP `500` with `BATCH_OUTCOME_UNKNOWN`, `retryable: false`, and the batch correlation ID.

The client must not automatically repeat a file upload after `BATCH_OUTCOME_UNKNOWN`. Compensation is idempotent, and a missing path counts as already cleaned.

### 6.5 Crash recovery

Startup runs recovery before hydrating runtime caches or accepting work. On-demand recovery also runs before acquiring a new project operation when an incomplete journal is associated with an absent or expired project lease. Recovery must first acquire the journal's exclusive compare-and-set claim. A project batch also requires an exclusive project recovery or deletion lease while its project exists. If the project is already absent, recovery verifies that absence transactionally and uses the journal claim alone. Standalone batches always use the journal claim without a project lease.

Recovery rules:

- `receiving` with an expired claim: remove the recorded staging directory and mark `compensated`.
- `staged` with no committed jobs: remove all staged/final paths and mark `compensated`.
- `compensation_pending`: retry all manifest cleanup and mark `compensated` only when complete.
- `committed`: verify all expected job rows and final files, then mark `reconciled`.
- committed rows with a missing final file: mark affected jobs failed with an explicit recovery error and retain the journal for diagnosis.
- a journal with an unexpired upload or recovery claim is active and must not be recovered by another process.

`reconciled` and `compensated` journals are retained for a bounded diagnostic window, default seven days, then pruned during startup maintenance. Incomplete and failed journals are never age-pruned.

A committed job whose model task was interrupted follows the existing secure restart policy and becomes failed rather than silently rerunning without its request-scoped BYOK key. Automatic model-task resumption is intentionally out of scope because BYOK secrets are not persisted.

## 7. Project Deletion Flow

1. Acquire an exclusive deletion lease.
2. If acquisition finds active work, return structured `409 PROJECT_BUSY` and release nothing because no delete lease was acquired.
3. While holding the exclusive lease, reconcile any abandoned batch for the project.
4. Run `delete_project_cascade()` in one database transaction. It records all known asset paths in `pending_asset_deletions` before deleting jobs and the project.
5. The project deletion cascades its lease row. Explicit release remains idempotent.
6. Remove the project and its jobs from the current process caches.
7. Drain pending asset deletions. Failed paths remain durably queued.
8. Publish state changes and return `cleanup_pending` accurately.

Because shared acquisition revalidates the project in SQLite and exclusive acquisition blocks new shared leases, no new project batch or worker can begin after deletion starts.

The API response for a busy project is:

```json
{
  "detail": {
    "code": "PROJECT_BUSY",
    "message": "Project has active work and cannot be deleted yet.",
    "project_id": "...",
    "retryable": true,
    "active_operations": [
      { "kind": "translate", "count": 1 }
    ]
  }
}
```

Owner IDs, lease IDs, filesystem paths, and secrets are never returned.

## 8. Migration and Startup

### 8.1 Migration mechanics

Replace migration `executescript()` calls with explicit migration functions and statements. Migration uses a cross-process SQLite write lock and re-reads `user_version` after acquiring that lock, so two processes starting together cannot both apply the same step. Each version step:

1. inspects current tables, columns, and indexes,
2. prepares and validates legacy backfill data before schema mutation where practical,
3. begins one explicit transaction,
4. applies only missing changes,
5. performs the backfill,
6. sets `PRAGMA user_version` last,
7. commits once.

Any exception rolls back the step. Repository construction closes the connection before re-raising.

Before changing a persistent database version, use SQLite's backup API to create one bounded pre-v3 backup if it does not already exist. Write to a unique temporary backup, validate it with `PRAGMA integrity_check`, then atomically rename it to the stable pre-v3 backup name. Concurrent migrators discard their validated temporary backup if the stable backup already exists. Rolling back the application after v3 migration requires restoring that backup because older code rejects newer schema versions.

### 8.2 v1-to-v2 repair

The v1-to-v2 step is schema-introspective:

- if `sequence_id` is missing, add it,
- if it already exists while `user_version` is still `1`, treat that as the known interrupted migration and continue,
- create indexes with idempotent checks,
- decode legacy `job_ids_json` and `page_order_json` as lists of string IDs,
- if either JSON value is malformed, log a warning and infer order from valid IDs plus actual project jobs ordered by creation time and row ID,
- backfill contiguous sequence IDs,
- set version `2` only after the complete repair succeeds.

### 8.3 v2-to-v3

The v2-to-v3 step adds:

- `jobs.batch_id`,
- `project_operation_leases`,
- `upload_batch_journal`,
- their indexes and constraints.

Fresh v0 databases create the complete v3 schema directly.

### 8.4 Startup order

Startup order is fixed:

1. open SQLite with required pragmas,
2. migrate to v3,
3. reclaim expired leases,
4. recover incomplete batch journals,
5. hydrate runtime caches,
6. drain pending asset deletions,
7. start heartbeat and health-broadcast loops,
8. accept normal work.

Every recovery action is idempotent.

## 9. Frontend and API Corrections

### 9.1 Project deletion

- Only one UI layer owns the permanent-deletion confirmation.
- Confirmation text states that project pages and generated assets are permanently deleted.
- `handleDeleteProject()` returns a discriminated result such as `deleted`, `busy`, or `failed` rather than swallowing errors.
- On `409`, the project remains selected, the route does not change, no jobs are removed, and the user sees the retryable busy message.
- On success, the project and all of its jobs are removed from local state. The jobs are not converted to unlinked standalone pages.
- Navigation occurs only after a successful deletion response.
- `cleanup_pending` is surfaced as a nonblocking warning when true.

### 9.2 Reordering

After a successful reorder response, the frontend updates both:

- the project's `page_order` and `job_ids`, and
- every affected file's `sequence_id` according to the returned order.

The visible result must be correct when SSE is disconnected or delayed.

### 9.3 BYOK

- `saveBYOKConfig()` migrates a legacy top-level `provider` plus `apiKey` into `apiKeys[provider]` before saving another provider.
- Custom providers retain a user-editable model field instead of forcing a fixed `default` option.
- Sandbox requests use the same selected provider, key, model, API base, and system prompt shown in the UI.
- The frontend sends the established `X-BYOK-Provider`, `X-BYOK-Key`, `X-BYOK-Model`, and `X-BYOK-Api-Base` headers.
- The backend sandbox endpoint accepts `Request`, calls `extract_byok_config(request)`, and routes through `byok_completion()` rather than the process-global OpenAI-compatible HTTP path.
- Error responses remain sanitized and never echo API keys.

### 9.4 Quality cleanup

Fix all branch-introduced ESLint errors, warnings that violate the configured gate, and `git diff --check` whitespace failures. Do not weaken lint rules to make the branch pass.

## 10. Testing Strategy

### 10.1 Repository and migration tests

Add tests that prove:

- a failure on the second job insert persists zero jobs,
- `create_project_jobs()` performs one commit boundary and revalidates the project,
- a v1 database with `sequence_id` already present and `user_version = 1` repairs successfully,
- malformed legacy project JSON migrates deterministically without partial schema state,
- an injected migration failure leaves both schema and `user_version` unchanged,
- repeated migration and startup recovery are idempotent,
- two processes starting against the same older database serialize migration and both finish on v3,
- concurrent pre-v3 backup attempts leave one integrity-checked stable backup,
- constructor failure closes the SQLite connection,
- v2-to-v3 creates lease/journal objects and fresh v0 creates v3 directly.

### 10.2 Batch upload and recovery tests

Add failure-injection tests for:

- invalid media within a batch,
- aggregate file-count and byte limits,
- a crash during `receiving` cleans the whole recorded staging directory after claim expiry,
- partial final rename,
- database insert failure,
- database commit failure after all file renames,
- compensation cleanup failure followed by successful retry,
- two processes attempting to recover the same journal, with exactly one claim winner,
- an active standalone batch never being recovered by another process,
- simulated process crash after one rename but before commit,
- `commit()` succeeding and then raising, without deleting committed rows or files,
- `commit()` failing before persistence and compensating all paths,
- an indeterminate commit outcome preserving files for later recovery,
- committed journal with a missing file,
- no persisted jobs or orphan files after a noncommitted batch,
- contiguous sequence IDs after success.

### 10.3 Lease and deletion tests

Use separate coordinator/repository instances and a shared temporary SQLite file. Add tests for:

- concurrent upload versus project deletion,
- active worker versus deletion,
- two processes acquiring operations for the same project,
- exclusive deletion blocked by any unexpired shared lease,
- new shared work blocked by an exclusive lease,
- worker crash represented by stopped heartbeats and lease expiry,
- cancellation observed at a pipeline boundary,
- stale worker denied by an atomic lease-validated database write,
- lease expiration racing a generated-asset rename cannot write after exclusive deletion,
- deletion succeeding after expiry/recovery,
- no late job or asset creation after deletion,
- SQLite lock timeout mapping to `503`, not `409`.

At least one test uses actual child processes rather than only threads so process-local state cannot accidentally satisfy the assertion.

### 10.4 Frontend tests

Add tests that prove:

- canceling confirmation performs no API call or navigation,
- `409 PROJECT_BUSY` preserves project, jobs, selection, and route,
- successful deletion removes the project and its jobs exactly once,
- successful reorder updates sequence IDs without SSE,
- legacy BYOK storage preserves the old provider key when another provider is saved,
- custom model text is retained,
- sandbox calls include the selected BYOK headers and model,
- API keys never appear in rendered errors or persisted nonsecret payloads.

## 11. Verification Gate

The branch is merge-ready only when all of these pass from a clean worktree:

1. full backend unit/integration suite,
2. targeted migration, journal, compensation, lease, and multi-process tests,
3. frontend Vitest suite,
4. `npm run lint`,
5. `npx tsc --noEmit`,
6. `npm run build`,
7. `git diff --check`,
8. merge-tree conflict check against the current `origin/main`,
9. a final repository-aware code and architecture review with no High findings.

Expected evidence includes pass counts, zero unexpected skips, and filesystem/database assertions from the injected-failure tests.

## 12. Rollout and Rollback

- Deploy v3 first in the existing single-Uvicorn-worker topology.
- Confirm migration, recovery, lease heartbeat, and pending deletion logs before increasing process count.
- If multiple local processes are enabled, they must mount the same local SQLite database and upload filesystem.
- Do not place the SQLite WAL database on storage without reliable cross-process file locking.
- Rollback before migration is a normal application rollback.
- Rollback after migration requires stopping all processes and restoring the pre-v3 SQLite backup.
- Journal and pending-deletion recovery can be rerun safely after restart.

## 13. Observability

Log structured, secret-free events for:

- lease acquire, conflict, renewal failure, expiry, cancellation, and release,
- batch state transitions and compensation outcomes,
- migration start, repair path, completion, and rollback,
- journal recovery decisions,
- deletion conflicts and pending asset cleanup.

Use batch, project, job, and lease correlation IDs where applicable. Never log BYOK keys or full authorization headers.
