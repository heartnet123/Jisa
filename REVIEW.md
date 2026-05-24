Promising technical flagship candidate, but it is not yet an interview-ready portfolio piece because the repo shows strong pipeline depth without enough demo, deployment, frontend, and verification proof.

| Project | Portfolio role | Evidence found | Strengths | Gaps / risks | Hiring signal | Next action |
| --- | --- | --- | --- | --- | --- | --- |
| AI Manga Translator | Flagship candidate | Root `README.md`, `ROADMAP.md`, FastAPI backend, Next.js frontend, local model assets, Thai fonts, synthesis engines, backend regression tests | Clear problem, credible end-to-end workflow, product-minded roadmap, real AI/image-processing complexity, practical local-first positioning | No screenshots, sample input/output, deployment profile, demo link, or successful local verification captured in this review; root is not a Git worktree | High | Add proof: screenshots, sample output, verified setup steps, and a short demo path |
| Backend synthesis/API | Core technical depth | `backend/main.py`, `backend/synthesis/segmentation.py`, `inpainting.py`, `typesetting.py`, `backend/tests/test_synthesis_regressions.py`, `pyproject.toml` | Real FastAPI job flow, OCR/translation/inpainting/typesetting pipeline, YOLO/SAM/LaMa/OpenCV fallbacks, VRAM-aware unloading, Thai-aware typesetting, focused regression tests | Upload endpoint does not show MIME/size validation; jobs are in memory; generated artifacts have no retention policy; external OCR/translation/model dependencies make setup fragile | High | Harden upload validation and dependency checks, then expand tests around no-bubble, failed OCR/translation, and artifact URL contracts |
| Frontend translator UI | Supporting project evidence inside flagship | `frontend/app/page.tsx`, `MangaTranslator.tsx`, `MangaFileItem.tsx`, `mangaApi.ts`, `types/index.ts`, `package.json` | Usable drag-and-drop batch UI, status polling, original/clean/final result views, text inspection, strong visual identity, typed status model | Frontend `README.md` is still create-next-app boilerplate; configuration button/state is not wired into backend behavior; API base URL is hardcoded to localhost; no frontend tests found | Medium | Replace boilerplate docs, wire or remove unused configuration, and add one UI/API contract test |
| Portfolio evidence package | Missing proof layer | `README.md` explains stack and workflow; `ROADMAP.md` explains phased product thinking | Story is much stronger than a shallow MVP list; roadmap shows good prioritization and deliberate deferral of collaboration features | No found screenshots, demo video, hosted app, sample page, before/after output, architecture diagram, or changelog | Medium | Create a `/docs/demo.md` or README section with setup proof, sample images, known limitations, and before/after output |

## Flagship recommendation

Make `AI Manga Translator` the flagship. It has the right shape for a strong portfolio project: a concrete user problem, a non-trivial AI pipeline, full-stack integration, Thai localization concerns, and enough implementation depth to discuss tradeoffs in an interview.

The project should be presented as a local-first AI manga translation workstation, not as a generic AI wrapper. The strongest story is: upload manga page, detect bubbles, OCR text, translate with page context, remove source text, typeset Thai back into the page, and review original/clean/final outputs.

## Supporting projects

No separate supporting projects were found in this workspace. Within this codebase, the backend synthesis pipeline can carry the technical-depth story, while the Next.js dashboard can support the product/UI story.

If this is part of a larger portfolio, pair it with one smaller project that proves deployment/operations discipline and one smaller project that proves conventional CRUD or team workflow skills. Do not add unrelated mini-apps inside this repo just to increase project count.

## Do next

1. Add portfolio proof: include 2-3 before/after images, a short demo GIF or screenshots, and a sample input page with expected output.
2. Make local setup verifiable: document exact model files, Ollama model, BYOK behavior, CPU/GPU expectations, and known fallback paths.
3. Harden the public upload path: validate image type and size, sanitize extensions, document retention, and return actionable 4xx errors.
4. Align frontend/backend contract: represent every backend status, use backend `original_url`, make API base configurable, and either wire translation config through or remove it.
5. Expand regression coverage around API job states, no-bubble fallback, failed OCR/translation, artifact URL generation, and frontend polling/error display.

## Do not prioritize

- Accounts, collaboration, roles, comments, or team review workflows before the single-user local workflow is reliable.
- More model/provider options before the current Ollama and BYOK setup is easy to verify.
- A bigger visual redesign before there is demo evidence proving the core translation flow works.
- Advanced analytics before jobs and artifacts are durable.
- New dependencies unless they directly reduce setup friction, verification risk, or artifact durability problems.

## Verification notes

- Inspected root docs, backend API/pipeline files, frontend feature files, package/config files, media/deployment evidence, and tests.
- `backend/tests/test_synthesis_regressions.py` exists and covers typesetting overflow, ellipsizing, and text-mask extraction.
- Attempted `uv run python -m unittest`; sandboxed run failed on Windows cache access, and escalated run failed because `uv` tried to fetch PyPI and DNS resolution failed.
- Attempted `npm run lint`; it failed in this Codex shell with a Node initialization error. Direct `node -v` using `C:\Program Files\nodejs\node.exe` returned `v24.14.1`, but npm-based lint still did not run successfully here.
- No screenshot, sample output, demo video, deployment config, or hosted demo evidence was found by repository scan.
