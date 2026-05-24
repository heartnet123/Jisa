# AI Manga Translator Portfolio Plan

Use this as the implementation checklist to turn the repository into an interview-ready flagship project.

## 1) Prove the product works

- [ ] Add 2-3 before/after manga examples with original, cleaned, and translated outputs.
- [ ] Add screenshots or a short demo GIF showing upload, processing, and result review.
- [ ] Add one sample input page and point to the expected output artifacts.
- [ ] Add a portfolio-focused README section with problem, approach, stack, and limitations.
- [ ] Add a simple architecture/workflow diagram for upload → segmentation → OCR → translation → inpainting → typesetting → review.

## 2) Make local setup repeatable

- [ ] Document every required backend model file and where it must live.
- [ ] Document the Ollama OCR model and how to verify it is installed.
- [ ] Document BYOK translation behavior when no API key is present.
- [ ] Document CPU vs GPU expectations and fallback behavior.
- [ ] Add a verified local run checklist for backend, frontend, upload, polling, and result inspection.

## 3) Harden the backend

- [ ] Validate upload MIME type before saving.
- [ ] Validate allowed image extensions before saving.
- [ ] Enforce a file size limit with a clear 4xx error.
- [ ] Normalize or sanitize uploaded file extensions.
- [ ] Document artifact retention and cleanup expectations.
- [ ] Reject invalid uploads before starting background processing.

## 4) Align frontend and backend contracts

- [ ] Align frontend status values with every backend job status.
- [ ] Show backend error messages consistently in the UI.
- [ ] Use backend `original_url` when available.
- [ ] Resolve relative URLs for original, cleaned, and final images.
- [ ] Make the backend API base URL configurable.
- [ ] Decide whether translation settings should be sent to the backend.
- [ ] Either wire the configuration UI through or remove unused controls.

## 5) Improve product polish

- [ ] Replace the default frontend README with project-specific instructions.
- [ ] Make the Configuration button functional or remove it.
- [ ] Add empty, uploading, failed, and completed states for the batch list.
- [ ] Confirm result toggles work with backend-returned URLs.
- [ ] Add one UI/API contract test for polling and result rendering.

## 6) Expand verification coverage

- [ ] Add tests for no-bubble fallback behavior.
- [ ] Add tests for failed OCR handling.
- [ ] Add tests for failed translation handling.
- [ ] Add tests for artifact URL generation.
- [ ] Add tests for upload validation failures.
- [ ] Add tests that confirm generated crop files are cleaned up.
- [ ] Re-run backend regression tests in an environment with dependencies available.
- [ ] Re-run frontend lint in a working Node/npm environment.
- [ ] Capture passing test/lint commands in the README or review notes.

## 7) Make the workflow durable

- [ ] Replace in-memory job storage with durable local persistence, or clearly document its limitations.
- [ ] Track original, inpainted, and final artifact paths in structured job records.
- [ ] Ensure jobs and result metadata survive backend restart.
- [ ] Add a cleanup command or documented cleanup process for generated artifacts.
- [ ] Add per-stage logging for segmentation, OCR, translation, inpainting, and typesetting.

## 8) Defer until the core workflow is proven

- [ ] Revisit accounts only after local single-user processing is reliable.
- [ ] Revisit collaboration only after durable projects and review artifacts exist.
- [ ] Revisit additional model/provider options only after the current Ollama and BYOK setup is easy to verify.
- [ ] Revisit analytics only after jobs and artifacts are durable.
- [ ] Revisit major visual redesign only after demo evidence proves the core flow works.
