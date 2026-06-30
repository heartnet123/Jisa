Project: AI Manga Translator
Vision: Local-first manga translation that turns uploaded pages into reviewable, typeset Thai releases without requiring a production studio workflow.
Phases: 4
Features: 23
Competitor Analysis Used: no
Features Addressing Competitor Pain Points: 0

Breakdown by priority:
- Must Have: 6
- Should Have: 10
- Could Have: 6
- Wont Have: 1

# AI Manga Translator Roadmap

AI Manga Translator should become a dependable local-first workstation for manga translators, scanlation teams, and independent creators who need the full page workflow: upload, detect bubbles, extract text, translate with context, clean the page, typeset Thai text, review, and export. The roadmap keeps the first release narrow: make the current pipeline dependable and recoverable before expanding into collaboration, automation, and long-term intelligence.

## Phase 1: Foundation / MVP

**Purpose:** Stabilize the existing end-to-end workflow so one user can translate and export manga pages locally with confidence.

**Why this phase matters:** The product is only useful if uploads survive processing, job state is visible, translation review is controllable, and outputs can be trusted after a restart or failure.

**Target outcome:** A deployable local MVP where users can process a small chapter, review OCR/translation blocks, approve rendering, and recover their work across app restarts.

### Milestones

- **Usable first release:** A user can upload pages, track progress, review text blocks, approve rendering, and see final pages.
- **Deployable production baseline:** Docker Compose, environment configuration, model checks, and health diagnostics are reliable enough for non-developer local setup.
- **Recoverable local workspace:** Jobs, projects, files, and failure states persist across service restarts.

### Feature 1: Core Translation Pipeline Hardening

- **Description:** Stabilize the upload-to-output pipeline across segmentation, OCR, page-context translation, inpainting, and Thai typesetting. Preserve the current stage model but make transitions deterministic, recoverable, and clearly reported to the UI.
- **Rationale:** This solves the core user problem: manual manga translation is slow because text extraction, cleanup, and re-rendering are separate error-prone tasks. Translators and hobbyist teams benefit because they can complete one page without stitching together multiple tools. It belongs in Phase 1 because every later feature depends on reliable pipeline outputs. It is more important than polish features because no dashboard improvement matters if pages fail midway. Success means a representative page moves through every stage with a predictable result or a clear actionable error.
- **Priority:** Must
- **Complexity:** Medium
- **Impact:** High
- **Phase:** Phase 1: Foundation / MVP
- **Dependencies:** Existing FastAPI job lifecycle, synthesis engines, upload storage, OCR provider, translation provider, Thai font assets.
- **Status:** Partially implemented; hardening planned.
- **Acceptance criteria:**
  - Uploading a supported image creates a queued job with a stable job ID and original image URL.
  - Each pipeline stage updates status, progress, and message consistently.
  - Failed stages return user-readable errors without losing original input or reviewed text.
  - Completed jobs include original, inpainted, and final result URLs when available.
  - The pipeline handles pages with no detected bubbles by using documented fallback behavior.
- **User stories:**
  - As a translator, I want one workflow to detect, translate, clean, and typeset a page so I do not have to move files between tools.
  - As a user with a weak GPU, I want clear fallback behavior so I know whether the page can still be processed.
  - As a reviewer, I want stage messages to tell me what is happening so I can trust long-running jobs.

### Feature 2: Human Review Gate for OCR and Translation

- **Description:** Complete the review step before inpainting and typesetting so users can inspect detected text blocks, edit OCR output, correct Thai translations, and approve the final render.
- **Rationale:** OCR and machine translation are never perfect, especially for stylized manga lettering and context-heavy dialogue. This solves inaccurate text and tone issues for translators, editors, and native Thai reviewers. It belongs in Phase 1 because user trust requires human control before irreversible page cleanup. It is more important than automation because early users need quality control, not blind speed. Success means the app pauses at review, accepts corrections, and resumes rendering from approved text.
- **Priority:** Must
- **Complexity:** Medium
- **Impact:** High
- **Phase:** Phase 1: Foundation / MVP
- **Dependencies:** Text block model, awaiting-review job state, approval API, translation editor UI, resumable inpainting/typesetting pipeline.
- **Status:** Partially implemented; OCR editing and validation hardening planned.
- **Acceptance criteria:**
  - Jobs enter an awaiting-review state after OCR and translation.
  - Users can edit translated text for each detected block before approval.
  - OCR text, translated text, and bubble coordinates remain linked after editing.
  - Approving a job resumes inpainting and typesetting without re-running completed OCR work.
  - Empty or invalid translations are flagged before approval.
- **User stories:**
  - As a Thai translator, I want to adjust wording before rendering so the final page sounds natural.
  - As an editor, I want to compare OCR text and translated text block by block so I can catch recognition mistakes.
  - As a scanlation hobbyist, I want approval to resume the render automatically so review does not break the workflow.

### Feature 3: Project Sessions and Batch Upload Organization

- **Description:** Support named project sessions that group multiple pages, preserve page order, and show per-page status for batch translation work.
- **Rationale:** Manga translation usually happens by chapter, not single images. This solves disorganized uploads for solo translators and small teams processing several pages at once. It belongs in Phase 1 because first-user value requires translating a meaningful batch, not only a one-off page. It is less critical than pipeline hardening but still required for a useful MVP. Success means users can create a session, upload a page set, and track each page independently.
- **Priority:** Must
- **Complexity:** Medium
- **Impact:** High
- **Phase:** Phase 1: Foundation / MVP
- **Dependencies:** Project model, job list API, frontend session selector, upload API project_id support.
- **Status:** Partially implemented; ordering and persistence planned.
- **Acceptance criteria:**
  - Users can create and select a named project session.
  - Uploaded pages attach to the selected project.
  - Jobs display by project with filename, status, progress, and result state.
  - Page ordering is stable and editable before export.
  - Deleting a job updates its project membership.
- **User stories:**
  - As a translator, I want to group pages by chapter so I can manage work in context.
  - As a reviewer, I want to see which pages are awaiting review so I can finish a batch efficiently.
  - As a user, I want failed and completed pages separated so I know what needs attention.

### Feature 4: Durable Local Persistence and File Lifecycle

- **Description:** Replace in-memory job and project state with durable local storage, then define file retention, cleanup, and restart recovery behavior for uploads and generated images.
- **Rationale:** Current local execution is risky if metadata disappears after a restart while image files remain on disk. This solves lost work for anyone translating multi-page chapters over multiple sessions. It belongs in Phase 1 because deployment readiness requires persistence before growth or analytics. It is as important as project sessions because sessions are not trustworthy without durable state. Success means restarting backend and frontend keeps projects, jobs, statuses, and output links intact.
- **Priority:** Must
- **Complexity:** Medium
- **Impact:** High
- **Phase:** Phase 1: Foundation / MVP
- **Dependencies:** Existing jobs_db/projects_db shape, uploads directory, Docker volume configuration, migration path for current metadata.
- **Status:** Planned.
- **Acceptance criteria:**
  - Job and project metadata persist across backend restarts.
  - Stored file paths are validated against existing upload/output files on startup.
  - Users can delete jobs and associated generated files safely.
  - Orphaned files are surfaced or cleaned through an explicit maintenance action.
  - Persistence uses a low-friction local store suitable for Docker and desktop-style deployment.
- **User stories:**
  - As a user, I want my chapter work to survive restarts so I do not lose hours of review.
  - As an operator, I want old generated files cleaned safely so disk usage stays controlled.
  - As a developer, I want a durable model that can later support analytics and collaboration.

### Feature 5: Local Deployment and Configuration Baseline

- **Description:** Provide a production-ready local setup path with Docker Compose, environment templates, model cache volumes, health checks, and clear configuration for OCR, translation, device, and font settings.
- **Rationale:** The product depends on local services, model assets, API credentials, and optional GPU acceleration. This solves setup uncertainty for technical translators and self-hosters. It belongs in Phase 1 because users cannot validate demand if they cannot run the system. It is more important than advanced UI because setup failure blocks all usage. Success means a fresh user can configure the app, start services, and confirm system readiness from the UI.
- **Priority:** Must
- **Complexity:** Medium
- **Impact:** High
- **Phase:** Phase 1: Foundation / MVP
- **Dependencies:** Dockerfiles, docker-compose.yml, environment variables, health endpoint, model download/cache process, frontend API base configuration.
- **Status:** Partially implemented; documentation and validation planned.
- **Acceptance criteria:**
  - `.env.example` documents all required and optional backend/frontend settings.
  - Docker Compose starts backend and frontend with persistent uploads and model cache volumes.
  - Health checks report OCR connectivity, translation configuration, CUDA availability, and font assets.
  - Missing optional dependencies degrade gracefully with clear messages.
  - Setup documentation includes local development and production-like Docker paths.
- **User stories:**
  - As a self-hosting user, I want one setup path so I can run the translator locally without guessing dependencies.
  - As a developer, I want health diagnostics so I can identify whether OCR, translation, GPU, or fonts are misconfigured.
  - As a team lead, I want repeatable setup so contributors can reproduce issues.

### Feature 6: Regression Test and Fixture Quality Gate

- **Description:** Expand backend regression tests and add a small fixture suite covering masks, layout, model fallbacks, API response contracts, project workflows, and review/resume behavior.
- **Rationale:** Image pipelines regress easily because small changes affect masks, text wrapping, and generated files. This solves quality drift for developers and protects users from broken outputs. It belongs in Phase 1 because reliable iteration needs safety checks before adding complex editors or performance work. It is lower direct user impact than persistence but critical to maintain trust. Success means core pipeline behavior is testable without requiring full GPU inference in every test run.
- **Priority:** Must
- **Complexity:** Medium
- **Impact:** Medium
- **Phase:** Phase 1: Foundation / MVP
- **Dependencies:** Existing backend tests, synthesis modules, API models, deterministic image fixtures, CI-compatible fallback paths.
- **Status:** Partially implemented; expanded coverage planned.
- **Acceptance criteria:**
  - Tests cover API response models, project workflows, review approval, cancellation, and deletion.
  - Synthesis tests verify mask normalization, text layout boundaries, and fallback rendering behavior.
  - Test fixtures avoid large model downloads in default CI/local validation.
  - A documented validation command runs the MVP quality gate.
  - Failures identify the broken stage or contract clearly.
- **User stories:**
  - As a maintainer, I want tests around image and API contracts so I can refactor safely.
  - As a user, I want new versions not to break previously working pages.
  - As a contributor, I want fast fixture tests so I can validate changes without a high-end GPU.

## Phase 2: Enhancement

**Purpose:** Improve quality control, translation consistency, export readiness, and daily usability after the MVP workflow is dependable.

**Why this phase matters:** Once users can complete pages, they need tools to reduce manual correction effort and produce cleaner chapter outputs.

**Target outcome:** A translator can manage chapter-level terminology, fix detection mistakes, configure engines from the UI, export a clean delivery package, and recover from common errors without developer help.

### Milestones

- **Review quality complete:** Users can fix text, masks, and layout problems before rendering.
- **Self-serve configuration complete:** Users can validate OCR/translation settings without editing code.
- **Chapter export ready:** Users can package final pages and review artifacts for release or handoff.

### Feature 7: Visual Bubble and Mask Editor

- **Description:** Add an editor for missed, merged, or incorrect bubble regions with simple add, move, resize, delete, and mask preview controls.
- **Rationale:** Detection models will miss stylized bubbles, narration boxes, or handwritten effects. This solves the false positive/false negative problem for translators who need clean pages. It belongs in Phase 2 because it depends on stable block data and review flow from Phase 1. It is more important than export polish when model accuracy limits output quality. Success means users can correct detection without leaving the app.
- **Priority:** Should
- **Complexity:** High
- **Impact:** High
- **Phase:** Phase 2: Enhancement
- **Dependencies:** Durable block storage, review state, frontend image inspector, backend rerender/resume endpoint.
- **Status:** Planned.
- **Acceptance criteria:**
  - Users can create, edit, and remove text regions on a page preview.
  - Edited regions update OCR/translation block data consistently.
  - Mask preview shows what will be removed before approval.
  - Region edits can trigger re-OCR for selected blocks or manual text entry.
  - Saved edits survive refresh and restart.
- **User stories:**
  - As an editor, I want to fix a missed speech bubble so the final page includes every line.
  - As a translator, I want to remove false detections so non-dialogue art is not damaged.
  - As a reviewer, I want mask preview so I can approve cleanup with confidence.

### Feature 8: Glossary and Character Voice Memory

- **Description:** Add project-level glossary terms, character names, pronouns, honorific preferences, and tone notes that feed translation prompts and review UI.
- **Rationale:** Manga quality depends on consistent names, relationships, speech style, and register. This solves inconsistent translation for recurring characters and key terms. It belongs in Phase 2 because it needs project sessions and stable translation configuration first. It is more important than broad language expansion because Thai consistency is the product's current focus. Success means repeated names and character voices remain consistent across pages.
- **Priority:** Should
- **Complexity:** Medium
- **Impact:** High
- **Phase:** Phase 2: Enhancement
- **Dependencies:** Project persistence, translation prompt builder, review UI, sandbox translation testing.
- **Status:** Planned.
- **Acceptance criteria:**
  - Users can add glossary entries and character voice notes per project.
  - Translation prompts include relevant glossary context.
  - Review UI highlights glossary terms and possible inconsistencies.
  - Sandbox translation can test glossary behavior before batch processing.
  - Glossary data exports with the project package.
- **User stories:**
  - As a translator, I want character voice notes so dialogue stays faithful across a chapter.
  - As a reviewer, I want key terms highlighted so I can catch inconsistency quickly.
  - As a team, we want shared glossary rules so everyone edits toward the same style.

### Feature 9: Chapter Context and Translation Memory

- **Description:** Store approved source/target pairs and page-level summaries so later pages can reuse context, preserve terminology, and reduce repeated corrections.
- **Rationale:** Translating every bubble in isolation creates tone drift and repeated work. This solves context loss for longer chapters and recurring phrases. It belongs in Phase 2 because it depends on approved translations and durable projects. It is adjacent to glossary work but more automated and therefore should follow explicit glossary controls. Success means approved corrections improve later suggestions without hiding changes from reviewers.
- **Priority:** Should
- **Complexity:** High
- **Impact:** High
- **Phase:** Phase 2: Enhancement
- **Dependencies:** Durable persistence, review approval records, prompt construction, glossary system.
- **Status:** Planned.
- **Acceptance criteria:**
  - Approved translations are stored as reusable memory within a project.
  - The translation engine receives relevant prior lines or summaries within safe context limits.
  - Users can view and remove memory entries that are wrong or outdated.
  - Translation memory improves repeated phrases without forcing exact matches.
  - Memory usage is visible in job metadata or review notes.
- **User stories:**
  - As a translator, I want prior approved lines reused so repeated catchphrases stay consistent.
  - As an editor, I want to remove bad memory entries so mistakes do not spread.
  - As a reviewer, I want to know when context influenced a translation so I can judge it properly.

### Feature 10: Export Package and Delivery Workflow

- **Description:** Export completed jobs or full projects as organized packages containing final pages, optional inpainted pages, source images, translation tables, and project metadata.
- **Rationale:** Users need to hand off or publish results outside the app. This solves the final-mile problem for translators, editors, and creators. It belongs in Phase 2 because export value depends on completed jobs and durable projects. It is more important than external integrations because a local ZIP or folder export is the simplest useful handoff. Success means a chapter can be downloaded with predictable filenames and review artifacts.
- **Priority:** Should
- **Complexity:** Medium
- **Impact:** Medium
- **Phase:** Phase 2: Enhancement
- **Dependencies:** Project ordering, file lifecycle, completed job metadata, frontend download action.
- **Status:** Planned.
- **Acceptance criteria:**
  - Users can export one job or an entire project.
  - Exported files use stable page order and readable filenames.
  - Users can choose whether to include source, inpainted, final, and translation table files.
  - Export fails gracefully if expected files are missing.
  - Export metadata records tool version, date, and configuration summary.
- **User stories:**
  - As a translator, I want a ZIP of final pages so I can share a completed chapter.
  - As an editor, I want translation tables included so I can review text separately.
  - As a creator, I want source and final files organized so I can archive work cleanly.

### Feature 11: Translation and OCR Configuration UI

- **Description:** Move key OCR, translation, prompt, model, provider, and font settings into a validated UI with sandbox testing and clear defaults.
- **Rationale:** Editing environment variables is too brittle for day-to-day translation work. This solves configuration friction for users who experiment with local OCR models, BYOK providers, and Thai style prompts. It belongs in Phase 2 because the MVP can start with environment configuration, but serious usage needs self-serve tuning. It is less important than review correctness but directly improves adoption. Success means users can validate settings before processing a batch.
- **Priority:** Should
- **Complexity:** Medium
- **Impact:** Medium
- **Phase:** Phase 2: Enhancement
- **Dependencies:** System health endpoint, sandbox translation API, secure config storage, frontend settings panel.
- **Status:** Partially implemented through sandbox; expanded UI planned.
- **Acceptance criteria:**
  - Users can view active OCR model, translation model, prompt, and font configuration.
  - Users can test sample text and see latency, result, and errors.
  - Invalid provider settings are caught before batch processing.
  - Sensitive keys are never exposed back to the browser after save.
  - Configuration changes are versioned or logged per project/job.
- **User stories:**
  - As a user, I want to test a translation prompt before running a chapter so I avoid wasted processing.
  - As a self-hoster, I want clear model status so I know whether Ollama and BYOK are ready.
  - As a Thai typesetter, I want to choose fonts so translated text fits the visual style.

### Feature 12: Error Recovery and Operator Diagnostics

- **Description:** Improve failed-job handling with retry controls, stage-specific recovery, diagnostic snapshots, and user-facing recommendations for OCR, GPU, translation, and file errors.
- **Rationale:** Local AI pipelines fail for environmental reasons as often as code reasons. This solves blocked users who do not know whether a failure came from model loading, GPU memory, credentials, or image input. It belongs in Phase 2 because Phase 1 must expose clear state first; Phase 2 makes recovery self-serve. It is more important than analytics because it reduces support burden immediately. Success means users can retry only the failed part or know exactly what to fix.
- **Priority:** Should
- **Complexity:** Medium
- **Impact:** High
- **Phase:** Phase 2: Enhancement
- **Dependencies:** Stage-specific status model, durable job state, system health diagnostics, job logs.
- **Status:** Planned.
- **Acceptance criteria:**
  - Failed jobs show the failed stage, root error category, and suggested fix.
  - Users can retry safe stages without re-uploading the page.
  - Diagnostics include relevant provider, hardware, file, and model state without leaking secrets.
  - Canceled jobs and failed jobs have distinct UI states.
  - Recovery actions are recorded in job history.
- **User stories:**
  - As a user, I want to retry translation after fixing an API key so I do not redo segmentation and OCR.
  - As a developer, I want diagnostic snapshots so I can reproduce user failures.
  - As an operator, I want secret-safe logs so troubleshooting does not expose credentials.

### Feature 13: Layout Preview and Typesetting Controls

- **Description:** Add preview controls for font, size, line breaks, alignment, padding, and overflow handling before committing the final typeset image.
- **Rationale:** Good translation still fails if Thai text does not fit the bubble or feels visually wrong. This solves layout quality problems for typesetters and reviewers. It belongs in Phase 2 because the basic typesetting engine must exist first. It is slightly lower urgency than mask editing because detection errors can destroy art, but it strongly improves final quality. Success means reviewers can fix cramped or awkward text directly in the app.
- **Priority:** Should
- **Complexity:** High
- **Impact:** Medium
- **Phase:** Phase 2: Enhancement
- **Dependencies:** Typesetting engine, review UI, block persistence, render preview endpoint.
- **Status:** Planned.
- **Acceptance criteria:**
  - Users can preview text layout for each block before final render.
  - Font and sizing controls respect available project fonts.
  - Overflow warnings appear when Thai text does not fit the target region.
  - Users can adjust line breaks or reduce size per block.
  - Final render matches preview within documented tolerances.
- **User stories:**
  - As a typesetter, I want to adjust line breaks so Thai text fits naturally.
  - As a reviewer, I want overflow warnings so I can fix cramped bubbles before export.
  - As a creator, I want final pages to look intentional rather than machine-stamped.

## Phase 3: Scale / Growth

**Purpose:** Prepare the product for heavier usage, richer operations, and adoption by teams or power users.

**Why this phase matters:** After the workflow is useful, growth depends on speed, observability, automation entry points, and integrations with existing file and review processes.

**Target outcome:** The system can process larger projects reliably, expose operational visibility, support automation, and fit into team or studio workflows.

### Milestones

- **Performance baseline ready:** Larger batches process predictably with controlled GPU and queue behavior.
- **Analytics-driven optimization ready:** Product and pipeline metrics reveal bottlenecks and quality issues.
- **Automation surface ready:** Power users can drive batch workflows through documented APIs or CLI commands.

### Feature 14: Queue, Concurrency, and GPU Resource Management

- **Description:** Add controlled worker concurrency, queue prioritization, model loading policy, VRAM-aware execution, and batch scheduling safeguards.
- **Rationale:** Vision and inpainting models can exhaust GPU memory or slow the entire workstation. This solves performance instability for power users processing many pages. It belongs in Phase 3 because Phase 1 and 2 should prove usage before optimizing throughput. It is more important than integrations for users already hitting batch limits. Success means large jobs process without uncontrolled parallelism or silent GPU failure.
- **Priority:** Should
- **Complexity:** High
- **Impact:** High
- **Phase:** Phase 3: Scale / Growth
- **Dependencies:** Durable job queue, stage model, model cache, diagnostics, retry/recovery behavior.
- **Status:** Planned.
- **Acceptance criteria:**
  - Backend enforces configurable max active jobs and per-stage concurrency.
  - Queue position and estimated stage wait are visible in the UI.
  - Model loading/unloading behavior is documented and observable.
  - GPU/CPU fallback decisions are recorded per job.
  - Large batch processing avoids starting more model-heavy work than hardware can support.
- **User stories:**
  - As a power user, I want batches queued safely so my GPU does not run out of memory.
  - As an operator, I want queue visibility so I know why a job is waiting.
  - As a maintainer, I want controlled workers so performance bugs are reproducible.

### Feature 15: Pipeline Analytics and Quality Metrics

- **Description:** Track job duration, stage failures, correction rates, retry counts, provider latency, and export completion so the team can improve the workflow with evidence.
- **Rationale:** Without metrics, it is hard to know whether OCR, translation, inpainting, or typesetting is the main blocker. This solves blind optimization for maintainers and helps users understand workflow health. It belongs in Phase 3 because analytics depends on stable events and durable history. It is less urgent than user-facing review tools but necessary for sustainable growth. Success means product decisions are based on actual processing and correction patterns.
- **Priority:** Should
- **Complexity:** Medium
- **Impact:** Medium
- **Phase:** Phase 3: Scale / Growth
- **Dependencies:** Durable persistence, event model, health endpoint, review correction data.
- **Status:** Planned.
- **Acceptance criteria:**
  - Each job stores stage timing, failure category, retry count, and provider latency.
  - Review correction rate can be calculated per project and stage.
  - Dashboard surfaces active, completed, failed, awaiting-review, and average processing metrics.
  - Metrics exclude sensitive source text unless explicitly exported by the user.
  - Analytics data can be reset or pruned for local privacy.
- **User stories:**
  - As a maintainer, I want to see where jobs fail most often so I can prioritize fixes.
  - As a translator, I want to know whether OCR or translation is causing most edits.
  - As a self-hoster, I want performance metrics so I can decide whether GPU upgrades matter.

### Feature 16: Public API and CLI Batch Automation

- **Description:** Document and stabilize API contracts, then add a CLI for project creation, batch upload, status watch, approval import, and export.
- **Rationale:** Power users and small teams often script repetitive workflows. This solves automation friction for users with existing file pipelines. It belongs in Phase 3 because public contracts should wait until the domain model is stable. It is less important than queue management but unlocks integrations and advanced usage. Success means a folder of pages can be processed from the terminal without clicking through the UI.
- **Priority:** Could
- **Complexity:** Medium
- **Impact:** Medium
- **Phase:** Phase 3: Scale / Growth
- **Dependencies:** Stable API models, durable projects/jobs, export workflow, authentication or local trust model.
- **Status:** Planned.
- **Acceptance criteria:**
  - API endpoints are documented with request/response examples.
  - CLI can create a project, upload a folder, watch jobs, and export completed pages.
  - CLI returns machine-readable errors for automation.
  - API versioning policy is defined before external consumers depend on it.
  - CLI respects local-only privacy assumptions by default.
- **User stories:**
  - As a power user, I want to upload a folder from the terminal so I can automate chapters.
  - As a developer, I want stable API docs so I can build custom workflows.
  - As a reviewer, I want exported translation tables importable after offline review.

### Feature 17: Team Review Roles and Handoff Workflow

- **Description:** Add lightweight roles and workflow states for translator, editor, typesetter, and approver so small teams can coordinate review responsibilities.
- **Rationale:** Scanlation and creator workflows often involve multiple people. This solves confusion over who should edit text, approve masks, or export final pages. It belongs in Phase 3 because solo local workflow should be proven before team overhead. It is useful but not required for the first adoption wave. Success means teams can hand a project through review stages without overwriting each other's decisions.
- **Priority:** Could
- **Complexity:** High
- **Impact:** Medium
- **Phase:** Phase 3: Scale / Growth
- **Dependencies:** Durable users or local profiles, project state, review history, export workflow.
- **Status:** Planned.
- **Acceptance criteria:**
  - Projects can assign lightweight local roles or reviewer labels.
  - Review actions record who changed what and when.
  - Jobs can move through translation, edit, typeset, and approval states.
  - Permissions remain simple and optional for solo users.
  - Handoff notes export with project metadata.
- **User stories:**
  - As a translator, I want to mark pages ready for editing so the next person knows what to review.
  - As an editor, I want change history so I can see what was modified after translation.
  - As a solo user, I want team features to stay out of the way unless enabled.

### Feature 18: Import and Storage Integrations

- **Description:** Add optional import/export integrations for local folders, network-mounted storage, and simple cloud storage providers while preserving local-first defaults.
- **Rationale:** Users may keep source scans and outputs in structured folders or shared drives. This solves file movement friction for teams and recurring projects. It belongs in Phase 3 because integrations depend on stable project/export models. It is less important than CLI because local file automation covers many early cases. Success means users can connect existing storage without changing the core workflow.
- **Priority:** Could
- **Complexity:** Medium
- **Impact:** Medium
- **Phase:** Phase 3: Scale / Growth
- **Dependencies:** Export package workflow, file lifecycle rules, project session model, security boundaries for external paths.
- **Status:** Planned.
- **Acceptance criteria:**
  - Users can import a folder into a project without manual file selection.
  - Export can write to a configured local or mounted output directory.
  - Integration settings validate path availability and permissions.
  - Failed sync/write operations do not corrupt project state.
  - Cloud integrations remain optional and disabled by default.
- **User stories:**
  - As a team, we want output written to a shared folder so editors can pick it up.
  - As a solo user, I want to import a chapter folder so I avoid repetitive drag-and-drop.
  - As a privacy-focused user, I want integrations optional so files stay local.

### Feature 19: Privacy, Licensing, and Safe-Use Controls

- **Description:** Add visible local-first privacy notices, source ownership reminders, API data handling disclosures, and export metadata that helps users keep usage lawful and transparent.
- **Rationale:** Manga content can be copyrighted, and translation APIs may process source text externally. This solves trust and compliance concerns for creators, translators, and operators. It belongs in Phase 3 because MVP usage validates the workflow first, but broader adoption needs clearer guardrails. It is more important for public growth than visual polish. Success means users understand where data goes and that the tool is intended for owned, licensed, or authorized content.
- **Priority:** Should
- **Complexity:** Low
- **Impact:** Medium
- **Phase:** Phase 3: Scale / Growth
- **Dependencies:** Configuration UI, export metadata, provider settings, documentation.
- **Status:** Planned.
- **Acceptance criteria:**
  - UI explains local processing versus external provider calls.
  - Setup docs state intended use for owned, licensed, or authorized content.
  - Export metadata can include processing/provider summary without secrets.
  - Users can see whether source text may leave the machine for translation.
  - The app avoids presenting itself as a distribution or piracy platform.
- **User stories:**
  - As a creator, I want to know whether my source pages are sent to external services.
  - As a team lead, I want safe-use language so contributors understand content boundaries.
  - As a privacy-focused user, I want local-first defaults to be explicit.

## Phase 4: Future / Vision

**Purpose:** Explore strategic differentiators that only make sense after the local workflow, review quality, and scaling foundation are stable.

**Why this phase matters:** Long-term value comes from making translation smarter, more adaptive, and easier to extend without turning the MVP into a premature enterprise platform.

**Target outcome:** The product can evolve into an intelligent manga localization workstation while avoiding scope creep that would distract from core translation reliability.

### Milestones

- **Intelligence layer validated:** Corrections and quality signals improve future translations without removing human review.
- **Ecosystem expansion explored:** Presets, templates, and language packs can extend the product safely.
- **Scope boundaries confirmed:** Deferred features stay out of the roadmap until usage proves they are worth the investment.

### Feature 20: AI-Assisted Quality Scoring and Correction Suggestions

- **Description:** Use review history, glossary rules, OCR confidence, and layout signals to suggest likely translation, OCR, mask, or typesetting issues before approval.
- **Rationale:** Reviewers need help finding the most likely mistakes in a page. This solves hidden quality issues for editors and reduces time spent checking easy lines. It belongs in Phase 4 because it depends on stable correction data, metrics, glossary, and layout controls. It is strategically valuable but should not replace human review. Success means the system points reviewers toward likely issues with explainable suggestions.
- **Priority:** Could
- **Complexity:** High
- **Impact:** High
- **Phase:** Phase 4: Future / Vision
- **Dependencies:** Review history, correction metrics, glossary, translation memory, layout preview, analytics.
- **Status:** Planned.
- **Acceptance criteria:**
  - The app flags suspicious blocks with a clear reason.
  - Suggestions can be accepted, edited, or dismissed.
  - The system never auto-publishes changes without user approval.
  - False-positive feedback can improve future suggestions.
  - Quality scoring is evaluated against real correction outcomes.
- **User stories:**
  - As an editor, I want likely mistakes highlighted so I can review faster.
  - As a translator, I want suggestions explained so I can decide whether to trust them.
  - As a maintainer, I want feedback data so quality models improve over time.

### Feature 21: Language Packs and Style Presets

- **Description:** Add configurable language packs, font/style presets, and prompt templates for workflows beyond Japanese-to-Thai while keeping Thai manga translation the primary path.
- **Rationale:** The core pipeline can support broader localization once Thai quality is stable. This solves expansion demand for creators working across languages. It belongs in Phase 4 because premature multi-language support would weaken focus and test coverage. It is less important than correction intelligence for current users but valuable for market growth. Success means new language packs can be added without rewriting the pipeline.
- **Priority:** Could
- **Complexity:** High
- **Impact:** Medium
- **Phase:** Phase 4: Future / Vision
- **Dependencies:** Prompt configuration UI, font management, glossary model, export metadata, test fixtures for new scripts.
- **Status:** Planned.
- **Acceptance criteria:**
  - Language packs define target language, default prompts, fonts, and layout rules.
  - Users can choose presets per project.
  - Thai defaults remain first-class and unchanged.
  - New language packs include fixture tests for text layout and prompt behavior.
  - Unsupported languages fail gracefully with setup guidance.
- **User stories:**
  - As a creator, I want reusable style presets so projects have consistent visual treatment.
  - As a translator, I want language-specific defaults so I do not rebuild prompts every time.
  - As a maintainer, I want language expansion isolated from the core Thai workflow.

### Feature 22: Plugin and Model Extension System

- **Description:** Define extension points for OCR engines, translation providers, segmentation models, inpainting backends, and export formats.
- **Rationale:** AI tooling changes quickly, and users may prefer different local or BYOK models. This solves long-term adaptability for developers and power users. It belongs in Phase 4 because extension architecture is costly before stable internal boundaries exist. It is lower urgency than direct user workflow improvements but important for ecosystem durability. Success means providers can be added through documented interfaces instead of ad hoc code changes.
- **Priority:** Could
- **Complexity:** High
- **Impact:** Medium
- **Phase:** Phase 4: Future / Vision
- **Dependencies:** Stable API contracts, provider configuration UI, diagnostics, test harness, security model for local plugins.
- **Status:** Planned.
- **Acceptance criteria:**
  - Provider interfaces are documented for OCR, translation, segmentation, inpainting, and export.
  - Built-in providers use the same interface as external providers.
  - Plugin failures are isolated and reported clearly.
  - Provider capabilities appear in health diagnostics.
  - Example extension proves the pattern without requiring a marketplace.
- **User stories:**
  - As a developer, I want to add a new OCR provider without editing the entire pipeline.
  - As a power user, I want to swap models as better local options appear.
  - As a maintainer, I want extension boundaries so integrations do not destabilize core code.

### Feature 23: Deferred Scope Boundaries

- **Description:** Keep several tempting ideas outside the current roadmap window: a public manga distribution/reader platform, custom model training pipeline, and fully autonomous no-review publishing.
- **Rationale:** These ideas are either legally sensitive, operationally heavy, or premature before the local translation workflow proves quality and demand. This protects solo users, creators, and maintainers from scope creep. It belongs in Phase 4 as an explicit boundary because saying no keeps the roadmap buildable. It is less important than near-term user needs, but it prevents misdirected investment. Success means the team stays focused on local translation, review, and export instead of becoming a hosting, training, or publishing company too early.
- **Priority:** Wont
- **Complexity:** High
- **Impact:** Low
- **Phase:** Phase 4: Future / Vision
- **Dependencies:** None for current roadmap; revisit only after strong usage data and clear legal/product strategy.
- **Status:** Deferred.
- **Acceptance criteria:**
  - Public distribution/reader features are not added to the current roadmap window.
  - Custom detector/OCR/translation model training is not prioritized until correction data and model gaps justify it.
  - Fully autonomous publishing remains blocked by required human approval.
  - Deferred ideas are revisited only with evidence from usage, support, and quality metrics.
  - Documentation distinguishes supported local translation workflows from out-of-scope platform ambitions.
- **User stories:**
  - As a maintainer, I want explicit non-goals so roadmap discussions do not derail implementation.
  - As a creator, I want the tool focused on authorized local workflow rather than questionable distribution.
  - As an editor, I want human approval preserved so automation does not publish low-quality pages.
