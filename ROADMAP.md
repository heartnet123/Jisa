
Project: AI Manga Translator
Vision: An end-to-end, local-first manga translation studio that turns comic pages into high-quality Thai editions.
Phases: 4
Features: 22
Competitor Analysis Used: yes
Features Addressing Competitor Pain Points: 5

Breakdown by priority:
- Must Have: 6
- Should Have: 8
- Could Have: 6
- Wont Have: 2

# AI Manga Translator Roadmap

This roadmap outlines the evolution of the AI Manga Translator from a functional local prototype into a professional-grade, review-driven translation studio. It prioritizes the "local-first" promise, emphasizing privacy, control, and a "human-in-the-loop" workflow that allows for manual correction of AI errors before they are finalized.

## Phase 1: Foundation / MVP

**Purpose**: Harden the core pipeline and environment to ensure the existing upload-to-translation workflow is reliable, repeatable, and safe for local use.

**Why it matters**: A manga translator is only as good as its reliability. Users need a predictable setup and clear visibility into the complex AI pipeline (segmentation → OCR → translation → inpainting → typesetting) to trust the results.

**Target outcome**: A user can set up the system locally with minimal friction, upload batches of manga pages, and receive usable translated outputs with clear error reporting when things go wrong.

**Milestones**:
- **Environment Baseline**: Documented and validated local setup for models (YOLO, SAM, Ollama) and Thai fonts.
- **Contract Stability**: Alignment between frontend status polling and backend job execution states.
- **Safety & Validation**: Prevention of invalid uploads and uncontrolled resource usage.

| Feature | Description | Rationale | Priority | Complexity | Impact | Status | Dependencies |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Local Setup Hardening** | Provide a verified checklist for backend (uv/uvicorn), frontend (npm), and model assets (weights, Ollama models, fonts). | Solves the "it doesn't run on my machine" problem common in local AI projects. | Must | Low | High | Partially Done | README, .env |
| **API Contract Stabilization** | Fully align backend job states with frontend TypeScript types, ensuring original/clean/final URLs are always correctly resolved. | Prevents UI "ghosting" or broken image links during long processing runs. | Must | Medium | High | In Progress | `mangaApi.ts`, `main.py` |
| **Upload Safety & Validation** | Implement MIME type checks, file size limits, and extension normalization before processing begins. | Prevents the backend from crashing on malformed files or exhausting disk space during batches. | Must | Medium | Medium | Not Started | `POST /api/translate` |
| **Synthesis Regression Suite** | Expand backend tests to cover edge cases: no bubbles found, failed OCR, empty translation results, and Thai text wrapping. | Protects the "magic" of the synthesis pipeline from breaking during future refactors. | Must | Medium | High | Partially Done | `backend/tests/` |
| **Minimal UI Configuration** | Allow users to configure the backend URL, target language, and translation prompt directly in the UI. | Moves critical translation control from `.env` files into the hands of the user. | Must | Medium | Medium | In Progress | Config store, API client |
| **Artifact Lifecycle Management** | Implement automatic or manual cleanup for temporary crop files and intermediate job artifacts. | Prevents the `uploads/` directory from bloating local storage during heavy use. | Must | Low | Medium | Not Started | Storage logic |

## Phase 2: Enhancement

**Purpose**: Shift from "automated-only" to "assisted" translation by introducing tools for review and correction.

**Why it matters**: Automated OCR and translation are rarely 100% perfect. To produce a professional-grade manga page, users must be able to correct text before it is "burned" into the image during the typesetting and inpainting stages.

**Target outcome**: Users can inspect intermediate results (OCR text, translation) and manually edit them to ensure quality before the final image is generated.

**Milestones**:
- **Review Editor**: Functional UI for editing per-bubble source and translated text.
- **Selective Retry**: Ability to rerun specific stages (e.g., only typesetting) after corrections.
- **Visual Confidence**: Overlay of bubble detection boundaries to diagnose segmentation issues.

| Feature | Description | Rationale | Priority | Complexity | Impact | Status | Dependencies |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **OCR & Translation Editor** | A side-by-side text editor for each detected bubble to correct OCR mistakes or refine Thai dialogue. | Addresses the #1 competitor pain point: lack of manual control over the "final" text. | Should | High | High | Not Started | Stable job contract, persisted blocks |
| **Selective Stage Retry** | Support rerunning *only* the typesetting or inpainting stage using edited text without re-processing the whole page. | Saves time and compute (VRAM) by avoiding redundant segmentation and OCR. | Should | High | High | Not Started | Stage-aware pipeline |
| **Bubble Visualization** | Overlay detected bubble masks and confidence scores over the original image in the review dashboard. | Helps users understand *why* a translation might be missing (e.g., the model didn't see the bubble). | Should | Medium | Medium | Not Started | API metadata, Canvas/SVG overlay |
| **Layout Tuning Controls** | Add per-job or per-bubble controls for font size, line spacing, and text alignment. | Improves the aesthetic quality of the Thai edition, allowing for better "fit" in tight bubbles. | Should | Medium | Medium | Not Started | Typesetting engine args |
| **Batch Management UI** | Improve the queue view with filtering (Success/Fail/Running) and bulk actions (Cancel All, Download All). | Necessary for processing whole chapters rather than just single demo pages. | Should | Medium | Medium | Not Started | Frontend list state |
| **Export Package (ZIP)** | Download all final images and a text sidecar (OCR/Trans) in a single archive. | Facilitates handoff to external manga editing tools or archival. | Could | Medium | Medium | Not Started | Jobs storage, ZIP lib |

## Phase 3: Scale / Growth

**Purpose**: Transition from a stateless prototype to a durable application capable of handling multi-chapter projects.

**Why it matters**: Users working on long-running translations need their progress to survive server restarts. Resource management also becomes critical as batch sizes grow.

**Target outcome**: A durable job system with a database, background workers for GPU tasks, and a stable API for automation.

**Milestones**:
- **Durable Persistence**: SQLite or similar local DB for job and artifact tracking.
- **Worker Queue**: Controlled execution of GPU-heavy stages to prevent VRAM exhaustion.
- **Public API**: Stable endpoints for integration with external scanlation scripts.

| Feature | Description | Rationale | Priority | Complexity | Impact | Status | Dependencies |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Durable Job Persistence** | Move job data from memory to a local SQLite database. | Ensures that job history and artifact links are not lost when the backend restarts. | Should | High | High | Not Started | Job schema refactor |
| **Background Worker Queue** | Implement a task queue (e.g., Taskiq or simple asyncio queue) to serialize model inference. | Prevents the system from crashing when multiple large images are uploaded simultaneously. | Should | High | High | Not Started | Durable persistence |
| **Observability Dashboard** | Track timing and success rates for each pipeline stage (Seg, OCR, etc.). | Provides data-driven insights into which stage is the bottleneck or most prone to failure. | Could | Medium | Low | Not Started | Structured logging |
| **Stable Public API** | Formalize the API boundaries and document them (OpenAPI/Swagger). | Enables power users to build CLI tools or bulk-processing scripts on top of the backend. | Could | Medium | Medium | Not Started | main.py cleanup |
| **Deployment Profiles** | Pre-configured `CPU-only`, `Low-VRAM`, and `High-Performance` profiles for different hardware. | Makes the "local-first" promise inclusive of users without high-end GPUs. | Could | Medium | Medium | Not Started | Model loading logic |

## Phase 4: Future / Vision

**Purpose**: Invest in advanced differentiators that move the needle from "tool" to "intelligent studio."

**Why it matters**: Manga translation is a creative act. Future features should focus on consistency, context, and learning from the user's manual corrections.

**Target outcome**: Intelligence that understands series-level context and automates repetitive layout decisions.

**Milestones**:
- **Translation Memory**: Consistency across pages and chapters.
- **Multi-page Context**: Dialogue that flows naturally across the entire story.

| Feature | Description | Rationale | Priority | Complexity | Impact | Status | Dependencies |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Multi-page Context** | Pass dialogue from previous pages into the translation prompt for current bubbles. | Solves the "broken continuity" problem where pronouns or tones shift between pages. | Should | High | High | Not Started | Durable project grouping |
| **Translation Glossary** | Store and apply character names and recurring terms consistently across a project. | Critical for series-level translation quality and character identity. | Could | Medium | High | Not Started | Durable persistence |
| **Learning-Assisted Layout** | Suggest font sizes and wrapping based on historical user corrections for similar bubble shapes. | Reduces the manual "fiddling" required to make text look good. | Could | High | Medium | Not Started | Edit history data |
| **Cloud-Sync (Optional)** | Secure, encrypted backup of project metadata (not images) for multi-device sync. | For users who want to translate on a desktop but review on a tablet. | Wont | High | Low | Deferred | Auth, Encryption, Cloud backend |
| **Collaborative Teams** | Multi-user support with roles (Translator, Editor, Typesetter). | Explicitly deferred to maintain focus on the single-user local-first experience. | Wont | High | Medium | Deferred | Auth, Project roles |

---

### Prioritization Rationale (MoSCoW)

- **Must**: Core workflow reliability. The app must be safe, documented, and testable before it's ready for any user.
- **Should**: The "Human-in-the-loop" workflow. Without the Review Editor, the tool is just another "one-shot" AI experiment.
- **Could**: Polish and scale. Durable databases and observability are great, but the product can still provide value without them in the short term.
- **Wont**: Features that break the "Local-First" focus or add unnecessary architectural complexity (Auth, Cloud, Teams) in the current maturity stage.
