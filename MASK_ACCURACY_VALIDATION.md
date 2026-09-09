# Mask accuracy fixes, 2026-09-08

## Fixed and verified

| Issue | Change | Evidence |
| --- | --- | --- |
| YOLO mask coordinates drift after letterboxing | Restore page coordinates with existing Ultralytics `scale_masks`, not direct `cv2.resize`. Preserve already-native masks exactly. | Portrait and landscape regression masks had IoU 0.60 before the fix and exceed 0.95 afterward. Square and native-resolution cases pass. |
| Old preview success/error overwrites a changed region or another page | Invalidate request generation immediately on canvas changes and commits, and on page cleanup/unmount. Ignore obsolete success and failure responses. | Three deferred-response regressions failed before the fix. Final cases cover drag, commit, regeneration, old error after new success, and page changes. |
| Small-region text is detected but clipped by a larger downstream safe-zone erosion | Use one shared safe-zone calculation for extraction and expansion: existing 2 px margin for small masks, 6 px for larger masks. | Edge-glyph regression failed at expanded-mask coverage before the fix. Now covers every glyph pixel while excluding the tested bubble outline and region exterior. |

## Validation

- Backend: `cd backend && .venv\Scripts\python.exe -m unittest discover -s tests`, 79 tests passed.
- Frontend: `cd frontend && npm test`, 41 tests passed across 8 files.
- Production frontend: `cd frontend && npm run build`, passed including TypeScript.
- Ruff check/fix and format on edited Python files, oxlint on edited TSX files: passed.
- Existing inpainting/artwork-protection regressions remain passing in the working tree.
- The new edge-mask test is scoped to mask generation, not the separately pending fill/compositing changes. The staged-only inpainting implementation is checked separately to avoid accidentally depending on those uncommitted changes.

## Real-image check

Ran the locally cached manga YOLO model on an existing 2040 x 2880 page without writing to jobs, saved masks, or the database. Eleven regions were detected with raw masks of 1600 x 1152. Compared old direct-resize masks with corrected masks against original-coordinate bounding boxes, allowing a 3 px tolerance. Outside-box mask area fell in 9 regions, stayed equal in 1, and increased from 0 to 0.05% in 1. This is a coordinate sanity check, not a semantic accuracy score or hand-labeled ground truth.

Visually inspected side-by-side detector-mask overlays at `%TEMP%/jisa-mask-coordinates-before-after.png`. Boxes and bubble masks align better after correction, but this does not prove perfect text extraction or inpainting quality.

## Deliberate limits

- Cached model metadata contains only `{0: 'balloon'}`. No guessed SFX/free-text classification or schema migration added.
- Moving a detected region still deliberately invalidates its old segmentation and uses the edited rectangle as extraction scope. Automatically shifting the old mask or rerunning a large segmentation model is not assumed safe.
- Boundary-connected artwork rejection remains intact. The fix addresses inconsistent erosion, not every tightly cropped glyph or difficult background.
- Previously saved detection masks are not retroactively rewritten. Preview regeneration reuses those saved masks. To verify the coordinate correction on an old page without losing edits, process a newly uploaded copy after restarting the backend if reload is disabled.
- No live-browser end-to-end run: browser bridge was not configured. Frontend checks use the existing Vitest/component harness with mocked API responses.
- Pre-existing dirty changes in main.py, typesetting, inpainting, regression tests and validation notes are preserved and excluded from this commit except the narrowly staged shared mask-margin fix.
