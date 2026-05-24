import asyncio
import base64
import json
import os
import re
import uuid
from pathlib import Path
from typing import Dict, List

import cv2
import httpx
import numpy as np
import uvicorn
from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from job_errors import OcrError, ocr_failure_message
from synthesis.inpainting import InpaintingEngine
from synthesis.segmentation import TextBlock, SegmentationEngine
from synthesis.typesetting import TypesetBlock, TypesettingEngine

# Load configurations
load_dotenv()

app = FastAPI(title="AI Manga Translator API")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Constants
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
OCR_MODEL = os.getenv("OCR_MODEL", "glm-ocr")
BYOK_API_KEY = os.getenv("BYOK_API_KEY")
BYOK_API_BASE = os.getenv("BYOK_API_BASE", "https://api.openai.com/v1")
BYOK_MODEL = os.getenv("BYOK_MODEL", "gpt-5.4-mini")
DEVICE = os.getenv("DEVICE", "cuda")
DEFAULT_THAI_SYSTEM_PROMPT = """
[Identity]

คุณคือ "Master Contextual Translator" ผู้เชี่ยวชาญด้านการแปลข้ามภาษา (ญี่ปุ่น-ไทย) ที่เน้นความลื่นไหลตาม "บริบท" (Context-Aware) และ "บุคลิกภาพ" (Persona-Driven) มากที่สุด คุณไม่ใช่เครื่องมือแปลภาษา แต่เป็น "นักแปลวรรณกรรมและบทสนทนา"

[Workflow: The 3-Step Process]

ก่อนจะส่งคำแปลทุกครั้ง ให้ทำตามขั้นตอนดังนี้:

Analyze (วิเคราะห์): ตรวจสอบว่าใครพูด? พูดกับใคร? ความสัมพันธ์คืออะไร? (สังเกตจาก: สรรพนาม [Ore/Watashi/Boku], หางเสียง [desu/yo/ne/zo], และระดับภาษา [Keigo/Casual])

Determine (กำหนด): เลือกระดับภาษา (Register) ที่เหมาะสม:

Casual/Manga: กันเอง, ภาษาปาก, สรรพนามตัวละคร

Formal/Business: สุภาพ, รักษาระยะห่าง, ใช้คำศัพท์ที่เหมาะสม

Narrative/Novel: บรรยายสวยงาม, กระชับ, ได้อารมณ์

Translate (แปล): แปลโดยยึดเป้าหมายหลักคือ "ความเป็นธรรมชาติของภาษาไทย" หากคำไหนแปลตรงตัวแล้วดูแปลก ให้ปรับเป็นสำนวนที่คนไทยใช้จริง

[Constraints & Handling Uncertainty]

Strictly No Misgendering: หากข้อมูลไม่ชัดเจนและภาษาญี่ปุ่นไม่ได้บ่งบอก ให้ถามผู้ใช้ทันที (เช่น "ประโยคนี้ตัวละครชายหรือหญิงพูดครับ?")

Tone Flexibility: หากผู้ใช้ไม่ได้ระบุแนว ให้คุณวิเคราะห์จากบทพูดต้นฉบับ หากยังคลุมเครือ ให้เสนอตัวเลือก 2 แบบ (เช่น แบบสุภาพ vs แบบกันเอง)

Formatting: คงโครงสร้างประโยคไว้ให้ตรงกับต้นฉบับ (เช่น ถ้าต้นฉบับเว้นบรรทัดบ่อย ก็ให้เว้นตามนั้น)
""".strip()
THAI_SYSTEM_PROMPT = os.getenv("THAI_SYSTEM_PROMPT") or DEFAULT_THAI_SYSTEM_PROMPT
PAGE_CONTEXT_TRANSLATION = os.getenv("PAGE_CONTEXT_TRANSLATION", "true").lower() in {
    "1",
    "true",
    "yes",
    "on",
}

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
ALLOWED_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}
ALLOWED_IMAGE_CONTENT_TYPES = {
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/bmp",
    "image/tiff",
}
MAX_UPLOAD_SIZE_BYTES = int(os.getenv("MAX_UPLOAD_SIZE_BYTES", str(25 * 1024 * 1024)))

# Mount static files for access to uploads
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

# In-memory store
jobs_db: Dict[str, dict] = {}

# Initialize Synthesis Engines
segmenter = SegmentationEngine(device=DEVICE)
inpainter = InpaintingEngine(device=DEVICE)
typesetter = TypesettingEngine()


def _normalize_upload_filename(filename: str | None) -> tuple[str, str]:
    original_filename = (filename or "upload.png").strip()
    stem = Path(original_filename).stem or "upload"
    suffix = Path(original_filename).suffix.lower()
    if suffix not in ALLOWED_IMAGE_EXTENSIONS:
        suffix = ".png"
    safe_stem = re.sub(r"[^A-Za-z0-9._-]+", "_", stem).strip("._-") or "upload"
    return f"{safe_stem}{suffix}", suffix


def _to_public_url(path: Path | str | None) -> str | None:
    if not path:
        return None
    candidate = Path(path)
    if not candidate.is_absolute():
        candidate = candidate.as_posix()
    rel = candidate.as_posix() if isinstance(candidate, Path) else str(candidate).replace("\\", "/")
    if rel.startswith("/"):
        return rel
    if rel.startswith("uploads/"):
        return f"/{rel}"
    return f"/uploads/{Path(rel).name}"


def _status_for_api(status: str) -> str:
    return status if status != "failed" else "error"


class TranslateJobResponse(BaseModel):
    id: str
    status: str


class BlockItem(BaseModel):
    id: str
    box: List[int]
    text: str | None = None
    translated_text: str | None = None


class ApprovePayload(BaseModel):
    translations: Dict[str, str]


class JobStatus(BaseModel):
    id: str
    filename: str
    status: str
    progress: int
    message: str | None = None
    error: str | None = None
    result_url: str | None = None
    original_url: str | None = None
    blocks: List[BlockItem] | None = None


def encode_image(image_path: str) -> str:
    with open(image_path, "rb") as image_file:
        return base64.b64encode(image_file.read()).decode("utf-8")


async def perform_ocr(image_path: str) -> str:
    """Call Ollama glm-ocr for text extraction"""
    try:
        base64_image = encode_image(image_path)
        payload = {
            "model": OCR_MODEL,
            "prompt": "Text Recognition: OCR the speech bubbles in this manga page. Output only the extracted text lines.",
            "images": [base64_image],
            "stream": False,
            "options": {"num_ctx": 16384},
        }

        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(f"{OLLAMA_URL}/api/generate", json=payload)
            response.raise_for_status()
            ocr_text = response.json().get("response", "")
            if (
                isinstance(ocr_text, str)
                and ocr_text.strip().startswith("Error during OCR:")
            ):
                raise OcrError(ocr_failure_message(ocr_text))
            return ocr_text
    except OcrError:
        raise
    except Exception as e:
        print(f"OCR Error: {e}")
        raise OcrError(ocr_failure_message(e)) from e


async def translate_text(text: str) -> str:
    """Call BYOK Translation API"""
    if not BYOK_API_KEY or BYOK_API_KEY == "your_api_key_here":
        return f"Translation skipped: BYOK_API_KEY not configured. (Original: {text[:50]}...)"

    try:
        headers = {
            "Authorization": f"Bearer {BYOK_API_KEY}",
            "Content-Type": "application/json",
        }

        payload = {
            "model": BYOK_MODEL,
            "messages": [
                {"role": "system", "content": THAI_SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": f"Translate the following manga text to Thai:\n\n{text}",
                },
            ],
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{BYOK_API_BASE}/chat/completions", headers=headers, json=payload
            )
            response.raise_for_status()
            result = response.json()
            return result["choices"][0]["message"]["content"]
    except Exception as e:
        print(f"Translation Error: {e}")
        return f"Error during Translation: {str(e)}"


def _extract_json_object(raw_text: str) -> dict | None:
    if not raw_text:
        return None

    stripped = raw_text.strip()
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        pass

    start = stripped.find("{")
    end = stripped.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None

    try:
        return json.loads(stripped[start : end + 1])
    except json.JSONDecodeError:
        return None


async def translate_page_texts(texts: List[str]) -> List[str]:
    """
    Translate all bubble texts together so the model can keep page-level context.
    Falls back to per-bubble mode if structured parsing fails.
    """
    if not texts:
        return []

    if not BYOK_API_KEY or BYOK_API_KEY == "your_api_key_here":
        return [
            f"Translation skipped: BYOK_API_KEY not configured. (Original: {text[:50]}...)"
            for text in texts
        ]

    headers = {
        "Authorization": f"Bearer {BYOK_API_KEY}",
        "Content-Type": "application/json",
    }
    page_payload = {
        "model": BYOK_MODEL,
        "messages": [
            {
                "role": "system",
                "content": (
                    f"{THAI_SYSTEM_PROMPT}\n"
                    "คุณกำลังแปลบทสนทนาในหน้าเดียวกันของมังงะ "
                    "จงคุมโทน น้ำเสียง และสรรพนามให้ต่อเนื่องกันทั้งหน้า "
                    'ตอบกลับเป็น JSON รูปแบบ {"translations":["...", "..."]} '
                    "โดยคงลำดับเดิมและจำนวนรายการต้องเท่ากับ input เท่านั้น"
                ),
            },
            {
                "role": "user",
                "content": json.dumps(
                    {"bubble_texts": texts},
                    ensure_ascii=False,
                ),
            },
        ],
    }

    async with httpx.AsyncClient(timeout=45.0) as client:
        response = await client.post(
            f"{BYOK_API_BASE}/chat/completions",
            headers=headers,
            json=page_payload,
        )
        response.raise_for_status()
        result = response.json()
        content = result["choices"][0]["message"]["content"]

    payload = _extract_json_object(content)
    if not payload:
        raise ValueError("Batch translation did not return a valid JSON object")

    translations = payload.get("translations")
    if not isinstance(translations, list):
        raise ValueError("Batch translation JSON missing 'translations' list")
    if len(translations) != len(texts):
        raise ValueError("Batch translation output count does not match input count")

    return [str(item).strip() for item in translations]


async def _crop_and_ocr(
    image_np: np.ndarray, box: tuple, image_path: str, job_id: str
) -> str:
    """
    Crop a single bubble region and OCR it.
    Falls back to whole-image OCR path if crop is too small.
    """
    x, y, w, h = box
    # Clamp box to image bounds
    ih, iw = image_np.shape[:2]
    x1, y1 = max(0, x), max(0, y)
    x2, y2 = min(iw, x + w), min(ih, y + h)

    if (x2 - x1) < 10 or (y2 - y1) < 10:
        # Region too small — fall back to full-image OCR
        return await perform_ocr(image_path)

    # Save the cropped region as a temp file
    crop = image_np[y1:y2, x1:x2]
    crop_bgr = cv2.cvtColor(crop, cv2.COLOR_RGB2BGR)
    crop_path = os.path.join(UPLOAD_DIR, f"crop_{job_id}_{x1}_{y1}.png")
    cv2.imwrite(crop_path, crop_bgr)

    try:
        text = await perform_ocr(crop_path)
    finally:
        # Clean up temp crop file
        try:
            os.remove(crop_path)
        except OSError:
            pass

    return text


async def process_manga_task(job_id: str, image_path: str):
    """Real AI Pipeline Step 1-3: Segmentation -> OCR (per bubble) -> Translation (Stop for HITL review)"""
    try:
        # Load image once for all steps
        img = cv2.imread(image_path)
        if img is None:
            raise RuntimeError(f"cv2.imread failed for {image_path}")
        img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

        # ── Step 1: Segmentation ─────────────────────────────────────────────
        jobs_db[job_id]["status"] = "segmenting"
        jobs_db[job_id]["progress"] = 10
        jobs_db[job_id]["message"] = "Detecting speech bubbles."
        blocks = segmenter.detect_bubbles(img_rgb)

        if not blocks:
            print(
                f"[job {job_id}] WARNING: YOLO detected 0 bubbles. "
                "Check that the manga-text YOLO weights loaded correctly. "
                "Falling back to whole-image OCR with no inpainting."
            )

        # ── Step 2: OCR per bubble (or whole image fallback) ─────────────────
        jobs_db[job_id]["status"] = "ocr"
        jobs_db[job_id]["progress"] = 30
        jobs_db[job_id]["message"] = "Running OCR on detected text regions."

        if blocks:
            # OCR each detected bubble independently
            ocr_tasks = [
                _crop_and_ocr(img_rgb, b.box, image_path, job_id) for b in blocks
            ]
            bubble_texts: List[str] = await asyncio.gather(*ocr_tasks)
            # Assign extracted text back to each block
            for block, raw_text in zip(blocks, bubble_texts):
                block.text = raw_text.strip()
        else:
            # No bubbles detected — fall back to full-page OCR
            full_ocr = await perform_ocr(image_path)
            bubble_texts = [full_ocr]
            
            # Create a single fallback TextBlock
            from synthesis.segmentation import TextBlock
            ih, iw = img_rgb.shape[:2]
            blocks = [
                TextBlock(
                    id=str(uuid.uuid4()),
                    box=(0, 0, iw, ih),
                    confidence=1.0,
                    text=full_ocr,
                )
            ]

        # Store the combined raw OCR for UI display
        all_ocr_text = "\n---\n".join(t.text for t in blocks if t.text)
        jobs_db[job_id]["ocr_text"] = all_ocr_text

        # ── Step 3: Translation per bubble ───────────────────────────────────
        jobs_db[job_id]["status"] = "translating"
        jobs_db[job_id]["progress"] = 50
        jobs_db[job_id]["message"] = "Translating extracted text."

        source_texts = [b.text or "" for b in blocks]
        if PAGE_CONTEXT_TRANSLATION and len(source_texts) > 1:
            try:
                translated_texts = await translate_page_texts(source_texts)
            except Exception as exc:
                print(
                    f"[job {job_id}] Page-context translation failed, "
                    f"falling back to per-bubble translation: {exc}"
                )
                translation_tasks = [translate_text(text) for text in source_texts]
                translated_texts = await asyncio.gather(*translation_tasks)
        else:
            translation_tasks = [translate_text(text) for text in source_texts]
            translated_texts = await asyncio.gather(*translation_tasks)

        for block, tx in zip(blocks, translated_texts):
            block.translated_text = tx

        all_translated_text = "\n---\n".join(t for t in translated_texts if t)
        jobs_db[job_id]["translated_text"] = all_translated_text

        # Store blocks and transition to awaiting_review
        jobs_db[job_id]["blocks_obj"] = blocks
        jobs_db[job_id]["blocks"] = [
            {
                "id": b.id,
                "box": list(b.box),
                "text": b.text,
                "translated_text": b.translated_text
            }
            for b in blocks
        ]
        jobs_db[job_id]["status"] = "awaiting_review"
        jobs_db[job_id]["progress"] = 55
        jobs_db[job_id]["message"] = "Awaiting manual review of translations."

    except Exception as e:
        import traceback

        print(traceback.format_exc())
        error_message = str(e) or "Translation job failed."
        jobs_db[job_id]["status"] = "failed"
        jobs_db[job_id]["error"] = error_message
        jobs_db[job_id]["message"] = f"Job stopped: {error_message}"
        jobs_db[job_id]["progress"] = min(jobs_db[job_id].get("progress", 0), 95)


async def resume_manga_task(job_id: str, image_path: str, blocks: List[TextBlock]):
    """Real AI Pipeline Step 4-6: Inpainting -> Typesetting -> Completed"""
    try:
        # Load image once for all steps
        img = cv2.imread(image_path)
        if img is None:
            raise RuntimeError(f"cv2.imread failed for {image_path}")
        img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

        # ── Step 4: Inpainting ───────────────────────────────────────────────
        jobs_db[job_id]["status"] = "inpainting"
        jobs_db[job_id]["progress"] = 65
        jobs_db[job_id]["message"] = "Removing source text from the image."

        # Unload segmenter (YOLO + SAM) before loading LaMa (VRAM budget)
        segmenter.unload_all()

        bubble_masks = []
        for b in blocks:
            if b.mask is not None:
                bubble_masks.append(b.mask)
            else:
                # Safety fallback: rectangular region for text-mask extraction
                fallback = np.zeros(img_rgb.shape[:2], dtype=np.uint8)
                x, y, w, h = b.box
                fallback[y : y + h, x : x + w] = 1
                bubble_masks.append(fallback)

        masks = inpainter.build_text_masks(img_rgb, bubble_masks)

        if masks:
            inpainted_img = inpainter.process_blocks(img_rgb, masks)
        else:
            # Nothing to inpaint — use original image as-is
            print(
                f"[job {job_id}] No text masks to inpaint — saving original as clean image."
            )
            inpainted_img = img_rgb.copy()

        # Explicit VRAM release before next model stage
        inpainter.release()

        inpainted_filename = f"inpainted_{job_id}.png"
        inpainted_path = UPLOAD_DIR / inpainted_filename
        cv2.imwrite(str(inpainted_path), cv2.cvtColor(inpainted_img, cv2.COLOR_RGB2BGR))
        jobs_db[job_id]["inpainted_url"] = _to_public_url(inpainted_path)

        # ── Step 5: Typesetting ──────────────────────────────────────────────
        jobs_db[job_id]["status"] = "typesetting"
        jobs_db[job_id]["progress"] = 80
        jobs_db[job_id]["message"] = "Rendering translated text into the page."

        typeset_blocks = []
        if blocks:
            # One TypesetBlock per detected bubble with its own translated text
            for block in blocks:
                tx = (block.translated_text or "").strip()
                if tx:
                    typeset_blocks.append(
                        TypesetBlock(
                            id=block.id,
                            box=block.box,
                            text=tx,
                            mask=block.mask,
                        )
                    )
        else:
            print(
                f"[job {job_id}] No bubbles detected — final image will have no typeset text."
            )

        final_img = typesetter.render(inpainted_img, typeset_blocks)
        final_filename = f"final_{job_id}.png"
        final_path = UPLOAD_DIR / final_filename
        cv2.imwrite(str(final_path), cv2.cvtColor(final_img, cv2.COLOR_RGB2BGR))

        # ── Step 6: Completion ───────────────────────────────────────────────
        jobs_db[job_id]["status"] = "completed"
        jobs_db[job_id]["progress"] = 100
        jobs_db[job_id]["message"] = "Translation completed."
        jobs_db[job_id]["result_url"] = _to_public_url(final_path)

    except Exception as e:
        import traceback

        print(traceback.format_exc())
        error_message = str(e) or "Translation job failed."
        jobs_db[job_id]["status"] = "failed"
        jobs_db[job_id]["error"] = error_message
        jobs_db[job_id]["message"] = f"Job stopped: {error_message}"
        jobs_db[job_id]["progress"] = min(jobs_db[job_id].get("progress", 0), 95)


@app.get("/")
async def health_check():
    return {"status": "ok", "service": "AI Manga Translator"}


@app.get("/api/ollama/status")
async def check_ollama():
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{OLLAMA_URL}/api/tags")
            return {"status": "connected", "models": response.json().get("models", [])}
    except Exception:
        return {"status": "disconnected"}


@app.post("/api/translate", response_model=TranslateJobResponse, status_code=202)
async def translate_manga(
    background_tasks: BackgroundTasks, file: UploadFile = File(...)
):
    job_id = str(uuid.uuid4())

    if file.content_type not in ALLOWED_IMAGE_CONTENT_TYPES:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported media type: {file.content_type or 'unknown'}",
        )

    # Save file locally
    normalized_filename, file_ext = _normalize_upload_filename(file.filename)
    file_ext = file_ext or ".png"
    filename = f"{job_id}{file_ext}"
    file_path = UPLOAD_DIR / filename

    content = await file.read()
    if len(content) > MAX_UPLOAD_SIZE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds the {MAX_UPLOAD_SIZE_BYTES // (1024 * 1024)}MB limit",
        )

    with open(file_path, "wb") as buffer:
        buffer.write(content)

    # Store initial state
    jobs_db[job_id] = {
        "id": job_id,
        "filename": normalized_filename,
        "status": "queued",
        "progress": 0,
        "message": "Queued for translation.",
        "original_url": _to_public_url(file_path),
    }

    background_tasks.add_task(process_manga_task, job_id, str(file_path))

    return {"id": job_id, "status": "queued"}


@app.get("/api/status/{job_id}", response_model=JobStatus)
async def get_status(job_id: str):
    if job_id not in jobs_db:
        raise HTTPException(status_code=404, detail="Job not found")
    job = jobs_db[job_id].copy()
    job["status"] = _status_for_api(job.get("status", "queued"))
    return job


@app.post("/api/jobs/{job_id}/approve")
async def approve_job(
    job_id: str, payload: ApprovePayload, background_tasks: BackgroundTasks
):
    if job_id not in jobs_db:
        raise HTTPException(status_code=404, detail="Job not found")

    job = jobs_db[job_id]
    if job["status"] != "awaiting_review":
        raise HTTPException(
            status_code=400, detail="Job is not in awaiting_review status"
        )

    # Update translations in blocks_obj
    blocks = job.get("blocks_obj", [])
    for b in blocks:
        if b.id in payload.translations:
            b.translated_text = payload.translations[b.id]

    # Update public blocks representation
    job["blocks"] = [
        {
            "id": b.id,
            "box": list(b.box),
            "text": b.text,
            "translated_text": b.translated_text,
        }
        for b in blocks
    ]

    # Update status and progress
    job["status"] = "inpainting"
    job["progress"] = 60
    job["message"] = "Review approved. Resuming pipeline..."

    # Launch resumption task
    filename = Path(job["original_url"]).name
    file_path = UPLOAD_DIR / filename

    background_tasks.add_task(resume_manga_task, job_id, str(file_path), blocks)

    return {"status": "resumed"}


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
