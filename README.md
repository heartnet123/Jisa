# AI Manga Translator

An end-to-end manga translation system that uploads comic pages, detects speech bubbles, extracts text with OCR, translates it into Thai, removes the original text, and renders the translated text back into the page.

## Overview

This repository combines a Python backend and a Next.js frontend to build a local-first manga translation workflow. The backend runs the image synthesis pipeline, while the frontend provides a drag-and-drop dashboard to upload pages, monitor progress, and inspect original, cleaned, and translated results.

## Problem & Solution

### The Problem

Translating manga pages manually is slow and inconsistent. A good translation is not enough on its own: the text must be extracted accurately, bubble regions must be cleaned up, and the translated dialogue must be placed back into the page without breaking the layout or tone.

### The Solution

This project automates the full workflow:

1. Detect speech bubbles on the page.
2. OCR the text inside each bubble.
3. Translate the extracted text into Thai with page-level context.
4. Inpaint the original text out of the image.
5. Typeset the translated text back into the bubble regions.

The result is a processed manga page that keeps the visual structure intact while replacing the original dialogue with translated text.

## Tech Stack

### Backend

- FastAPI for the HTTP API and job orchestration.
- Uvicorn for local server hosting.
- OpenCV, NumPy, and Pillow for image manipulation.
- PyTorch and Ultralytics for segmentation models.
- simple-lama-inpainting for text removal, with OpenCV fallback.
- httpx for OCR and translation API calls.
- Pydantic for structured job and block models.
- Ollama for local OCR inference.
- An OpenAI-compatible BYOK endpoint for translation.

### What Each Library Does

- OpenCV handles the low-level image work in the backend. It reads and writes images, converts color spaces, crops bubble regions, builds masks, dilates or erodes areas, and performs the OpenCV inpainting fallback when LaMa is unavailable.
- NumPy is the shared array layer behind almost every image operation. The pipeline uses it for image tensors, binary masks, connected-component work, threshold calculations, and fast per-pixel manipulation.
- Pillow is used where text rendering and model I/O need a higher-level image API. It is especially important in the typesetting stage, where translated text is drawn onto transparent overlays and then composited back onto the manga page.
- PyTorch is the runtime foundation for the vision models. It allows the segmentation pipeline to load and run model weights on CUDA when available, and the code explicitly manages VRAM by unloading models between stages.
- Ultralytics provides the YOLO and SAM integration layer. It is used to load the bubble detector, run segmentation inference, and optionally refine masks with SAM-style prompts.

### Why These Choices

- OpenCV was chosen because this project needs practical, production-friendly image primitives rather than abstract helpers.
- NumPy was chosen because it is the fastest and most interoperable way to move masks and images between OpenCV, Pillow, and model outputs.
- Pillow was chosen because text layout and compositing are easier and safer with its font and drawing APIs than with raw OpenCV text rendering.
- PyTorch and Ultralytics were chosen because the repo depends on modern detection and segmentation models that are already packaged around that ecosystem.
- The stack is optimized for local execution, GPU acceleration, and explicit fallback behavior so the app still works even when a model or dependency is missing.

### Frontend

- Next.js 16 with React 19.
- TypeScript for typed frontend state and API contracts.
- Tailwind CSS v4 for styling.
- Framer Motion for motion and transitions.
- Axios and polling-based status updates for API communication.
- Iconify and Lucide icons for UI affordances.

### Models and Assets

- YOLO-based speech bubble detection.
- SAM 2 checkpoint support for mask refinement.
- Local model files such as `sam2_b.pt`, `yolo11n-seg.pt`, and `yolov8n.pt`.
- Custom Thai fonts in `backend/assets/fonts/` for typesetting.

## Key Features

- Drag-and-drop upload for one or many manga pages.
- Background job processing with live status polling.
- Bubble segmentation using a detection-first pipeline.
- OCR extraction per bubble, with full-page fallback when needed.
- Page-context translation to keep dialogue tone and pronouns consistent.
- Inpainting that removes original text while preserving artwork.
- Bubble-aware typesetting that fits translated Thai text into the page.
- Side-by-side review of original, cleaned, and final translated images.
- Progress and error reporting for each uploaded file.

## Challenges & Learnings

- VRAM management matters when several vision models and an OCR model may run on the same machine. The backend explicitly unloads models between stages to stay within a practical GPU budget.
- Text cleanup is harder than simple object masking. The inpainting pipeline needs a text-only mask, not just a bubble mask, or the final image loses too much of the original bubble structure.
- Thai typesetting needs more care than naive wrapping. The renderer includes language-aware layout logic so translated text still fits inside tight speech bubbles.
- OCR and translation are not independent problems. Batch translation with page context produces more consistent dialogue than translating every bubble in isolation.
- A robust pipeline needs fallbacks. The code handles missing detections, unavailable translation credentials, and inpainting fallback paths so the app can still produce output instead of failing hard.

## Project Structure

- `backend/` - FastAPI application and synthesis pipeline.
- `backend/synthesis/` - Segmentation, inpainting, and typesetting engines.
- `backend/tests/` - Regression tests for layout and mask handling.
- `frontend/` - Next.js application and UI shell.
- `frontend/src/features/manga-translator/` - Manga translation feature, API client, and UI components.
- `uploads/` - Stored input and generated output images.

## Getting Started

### Prerequisites

- Python 3.12+
- Node.js 20+
- A local Ollama server for OCR
- Optional: a CUDA-capable GPU for faster model inference

### Backend

```bash
cd backend
uv sync
uv run uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### Environment Variables

Create a backend `.env` file if you want to override defaults:

```env
OLLAMA_URL=http://localhost:11434
OCR_MODEL=glm-ocr
BYOK_API_KEY=your_api_key_here
BYOK_API_BASE=https://api.openai.com/v1
BYOK_MODEL=gpt-4o
# Optional: overrides the built-in Master Contextual Translator prompt.
THAI_SYSTEM_PROMPT=
PAGE_CONTEXT_TRANSLATION=true
```

The default `THAI_SYSTEM_PROMPT` is configured in `backend/main.py` for Japanese-to-Thai literary and dialogue translation through the OpenAI-compatible chat completions API.

## API Endpoints

- `GET /` - Health check.
- `GET /api/ollama/status` - Checks whether Ollama is reachable.
- `POST /api/translate` - Uploads an image and starts a translation job.
- `GET /api/status/{job_id}` - Returns progress and result URLs for a job.

## Verification

The backend includes regression tests for text layout and inpainting masks. Run them with:

```bash
cd backend
uv run python -m unittest
```

## Notes

- The backend serves generated files from `/uploads`.
- The frontend resolves relative backend image URLs before rendering them.
- The translation pipeline is designed to be resilient rather than perfectly deterministic, so fallback paths are intentionally part of the system.
