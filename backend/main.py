import asyncio
import base64
import json
import math
import os
import re
import uuid
from pathlib import Path
from typing import Any, Dict, List, Literal, Set
from fastapi.responses import StreamingResponse


import cv2
import httpx
import numpy as np
import uvicorn
from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, File, HTTPException, UploadFile, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, model_validator

from job_errors import OcrError, ocr_failure_message
from repository import RegionRecord, ReviewRepository, SQLiteReviewRepository
from synthesis.inpainting import InpaintingEngine
from synthesis.segmentation import TextBlock, SegmentationEngine
from synthesis.typesetting import TypesetBlock, TypesettingEngine
from byok import BYOKConfig, extract_byok_config, byok_completion, PRESET_PROVIDERS

# Load configurations
load_dotenv()

app = FastAPI(title="AI Manga Translator API")

# Event Manager for Server-Sent Events (SSE)
class EventManager:
    def __init__(self):
        self.listeners: Set[asyncio.Queue] = set()

    def subscribe(self) -> asyncio.Queue:
        queue = asyncio.Queue()
        self.listeners.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue):
        self.listeners.discard(queue)

    async def publish(self, event_type: str, data: any):
        payload = {"event": event_type, "data": data}
        for queue in list(self.listeners):
            await queue.put(payload)

event_manager = EventManager()


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
TYPESETTING_FONT = os.getenv("TYPESETTING_FONT")

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
MASK_DIR = UPLOAD_DIR / "masks"
MASK_DIR.mkdir(parents=True, exist_ok=True)
STATE_DB_PATH = Path(os.getenv("STATE_DB_PATH", str(UPLOAD_DIR / "state.sqlite3")))
ALLOWED_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}
ALLOWED_IMAGE_CONTENT_TYPES = {
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/bmp",
    "image/tiff",
}
MAX_UPLOAD_SIZE_BYTES = int(os.getenv("MAX_UPLOAD_SIZE_BYTES", str(25 * 1024 * 1024)))
MAX_BATCH_UPLOAD_FILES = int(os.getenv("MAX_BATCH_UPLOAD_FILES", "20"))

# Mount static files for access to uploads
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

# In-memory store
jobs_db: Dict[str, dict] = {}
projects_db: Dict[str, dict] = {}
repository: ReviewRepository = SQLiteReviewRepository(STATE_DB_PATH)

# Initialize Synthesis Engines
segmenter = SegmentationEngine(device=DEVICE)
inpainter = InpaintingEngine(device=DEVICE)

typeset_font_path = None
if TYPESETTING_FONT:
    candidate_path = Path(__file__).resolve().parent / "assets" / "fonts" / TYPESETTING_FONT
    if candidate_path.exists():
        typeset_font_path = str(candidate_path)

typesetter = TypesettingEngine(font_path=typeset_font_path)


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


def set_repository(new_repository: ReviewRepository, *, hydrate: bool = False) -> None:
    """Replace durable storage without invalidating the runtime cache contract."""
    global repository
    repository = new_repository
    if hydrate:
        hydrate_repository_state()


def pixel_box_to_normalized(
    box: tuple[int, int, int, int], image_width: int, image_height: int
) -> tuple[float, float, float, float]:
    x, y, width, height = box
    if image_width <= 0 or image_height <= 0:
        raise ValueError("Image dimensions must be positive")
    if width <= 0 or height <= 0:
        raise ValueError("Box dimensions must be positive")
    if x < 0 or y < 0 or x + width > image_width or y + height > image_height:
        raise ValueError("Pixel box must be contained within the image")
    return (
        x / image_width,
        y / image_height,
        width / image_width,
        height / image_height,
    )


def normalized_box_to_pixels(
    box: tuple[float, float, float, float], image_width: int, image_height: int
) -> tuple[int, int, int, int]:
    x, y, width, height = box
    if image_width <= 0 or image_height <= 0:
        raise ValueError("Image dimensions must be positive")
    values = (x, y, width, height)
    if not all(math.isfinite(value) for value in values):
        raise ValueError("Normalized box values must be finite")
    if x < 0 or y < 0 or width <= 0 or height <= 0:
        raise ValueError("Normalized box must have a non-negative origin and positive size")
    if x + width > 1 or y + height > 1:
        raise ValueError("Normalized box must be contained within the page")

    left = min(image_width - 1, max(0, math.floor(round(x * image_width, 12))))
    top = min(image_height - 1, max(0, math.floor(round(y * image_height, 12))))
    right = min(
        image_width,
        max(left + 1, math.ceil(round((x + width) * image_width, 12))),
    )
    bottom = min(
        image_height,
        max(top + 1, math.ceil(round((y + height) * image_height, 12))),
    )
    return left, top, right - left, bottom - top


def _mask_path_for(job_id: str, block_id: str) -> Path:
    safe_block_id = re.sub(r"[^A-Za-z0-9._-]+", "_", block_id)
    return MASK_DIR / f"{job_id}_{safe_block_id}.png"


def _persist_runtime_regions(job_id: str, blocks: List[TextBlock]) -> None:
    job = jobs_db[job_id]
    image_width = int(job["image_width"])
    image_height = int(job["image_height"])
    existing = {region.id: region for region in repository.load_regions(job_id)}
    regions: list[RegionRecord] = []

    for order, block in enumerate(blocks):
        prior = existing.get(block.id)
        mask_path = prior.mask_path if prior else None
        if block.mask is not None and (prior is None or prior.source == "detected"):
            candidate = _mask_path_for(job_id, block.id)
            if not cv2.imwrite(str(candidate), (block.mask > 0).astype(np.uint8) * 255):
                raise RuntimeError(f"Failed to persist detected mask for block {block.id}")
            mask_path = str(candidate)

        x, y, width, height = pixel_box_to_normalized(
            block.box, image_width, image_height
        )
        regions.append(
            RegionRecord(
                id=block.id,
                job_id=job_id,
                order=order,
                x=x,
                y=y,
                width=width,
                height=height,
                source=prior.source if prior else "detected",
                source_text=block.text,
                translated_text=block.translated_text,
                mask_path=mask_path,
            )
        )

    repository.save_job(job)
    repository.replace_regions(job_id, regions)
    job["blocks"] = _public_regions(job_id)


def _public_region(region: RegionRecord) -> dict:
    return {
        "id": region.id,
        "box": {
            "x": region.x,
            "y": region.y,
            "width": region.width,
            "height": region.height,
        },
        "source": region.source,
        "text": region.source_text,
        "translated_text": region.translated_text,
        "mask_available": bool(region.mask_path),
    }


def _public_regions(job_id: str) -> list[dict]:
    return [_public_region(region) for region in repository.load_regions(job_id)]


def hydrate_engine_blocks(
    job: dict, regions: list[RegionRecord] | None = None
) -> list[TextBlock]:
    image_width = int(job.get("image_width") or 0)
    image_height = int(job.get("image_height") or 0)
    if image_width <= 0 or image_height <= 0:
        return []

    durable_regions = regions if regions is not None else repository.load_regions(job["id"])
    blocks: list[TextBlock] = []
    for region in durable_regions:
        box = normalized_box_to_pixels(
            (region.x, region.y, region.width, region.height),
            image_width,
            image_height,
        )
        mask = None
        if region.source == "detected" and region.mask_path:
            loaded = cv2.imread(region.mask_path, cv2.IMREAD_GRAYSCALE)
            if loaded is not None and loaded.shape == (image_height, image_width):
                mask = (loaded > 0).astype(np.uint8)
        if mask is None:
            mask = np.zeros((image_height, image_width), dtype=np.uint8)
            x, y, width, height = box
            mask[y : y + height, x : x + width] = 1

        blocks.append(
            TextBlock(
                id=region.id,
                box=box,
                text=region.source_text,
                translated_text=region.translated_text,
                mask=mask,
            )
        )
    return blocks


def _hydrate_job_regions(job: dict) -> None:
    image_width = job.get("image_width")
    image_height = job.get("image_height")
    if not image_width or not image_height:
        return

    regions = repository.load_regions(job["id"])
    blocks = hydrate_engine_blocks(job, regions)
    public_blocks: list[dict] = []
    for region in regions:
        public_blocks.append(_public_region(region))

    job["blocks_obj"] = blocks
    job["blocks"] = public_blocks


def hydrate_repository_state() -> None:
    interrupted_statuses = {
        "queued",
        "segmenting",
        "ocr",
        "translating",
        "inpainting",
        "typesetting",
    }
    jobs_db.clear()
    projects_db.clear()

    for job in repository.load_jobs():
        if job["status"] in interrupted_statuses:
            job["status"] = "failed"
            job["error"] = "Job interrupted by backend restart."
            job["message"] = "Job stopped because the backend restarted."
            job["progress"] = min(int(job.get("progress") or 0), 95)
            repository.save_job(job)
        _hydrate_job_regions(job)
        jobs_db[job["id"]] = job

    for project in repository.load_projects():
        projects_db[project["id"]] = project


class BatchTranslateJobItem(BaseModel):
    id: str
    filename: str
    status: str
    progress: int
    project_id: str | None = None
    sequence_id: int | None = None
    original_url: str | None = None
    result_url: str | None = None
    inpainted_url: str | None = None
    message: str | None = None
    error: str | None = None



class TranslateJobResponse(BaseModel):
    id: str
    status: str
    jobs: List[BatchTranslateJobItem] | None = None


class NormalizedBox(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)

    @model_validator(mode="after")
    def validate_page_bounds(self) -> "NormalizedBox":
        if self.x + self.width > 1 or self.y + self.height > 1:
            raise ValueError("Box must be contained within the normalized page")
        return self

    def as_tuple(self) -> tuple[float, float, float, float]:
        return self.x, self.y, self.width, self.height


class BlockItem(BaseModel):
    id: str
    box: NormalizedBox
    source: Literal["detected", "manual"] = "detected"
    text: str | None = None
    translated_text: str | None = None
    mask_available: bool = False


class RegionMutation(BaseModel):
    id: str = Field(min_length=1)
    box: NormalizedBox
    text: str | None = None
    translated_text: str | None = None


class ReplaceRegionsPayload(BaseModel):
    regions: List[RegionMutation]

    @model_validator(mode="after")
    def validate_unique_ids(self) -> "ReplaceRegionsPayload":
        ids = [region.id for region in self.regions]
        if len(ids) != len(set(ids)):
            raise ValueError("Region IDs must be unique")
        return self


class PatchRegionPayload(BaseModel):
    text: str | None = None
    translated_text: str | None = None

    @model_validator(mode="after")
    def validate_non_empty_patch(self) -> "PatchRegionPayload":
        if not self.model_fields_set:
            raise ValueError("At least one text field must be provided")
        return self


class RegionCollectionResponse(BaseModel):
    region_mode: Literal["detected", "manual_override"]
    regions: List[BlockItem]


class MaskPreviewResponse(BaseModel):
    url: str
    revision: int


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
    inpainted_url: str | None = None
    blocks: List[BlockItem] | None = None
    project_id: str | None = None
    sequence_id: int | None = None
    region_mode: Literal["detected", "manual_override"] = "detected"
    mask_preview_url: str | None = None
    preview_revision: int = 0


class ProjectCreatePayload(BaseModel):
    name: str


class ProjectResponse(BaseModel):
    id: str
    name: str
    created_at: str
    job_ids: List[str]
    page_order: List[str]


class ReorderPayload(BaseModel):
    page_order: List[str]



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


async def translate_text(text: str, byok_config: BYOKConfig | None = None) -> str:
    """Call BYOK Translation API via LiteLLM"""
    config = byok_config or extract_byok_config()
    messages = [
        {"role": "system", "content": THAI_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": f"Translate the following manga text to Thai:\n\n{text}",
        },
    ]
    try:
        return await byok_completion(messages=messages, config=config)
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


async def translate_page_texts(texts: List[str], byok_config: BYOKConfig | None = None) -> List[str]:
    """
    Translate all bubble texts together so the model can keep page-level context.
    Falls back to per-bubble mode if structured parsing fails.
    """
    if not texts:
        return []

    config = byok_config or extract_byok_config()
    messages = [
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
    ]

    content = await byok_completion(messages=messages, config=config)
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


async def process_manga_task(job_id: str, image_path: str, byok_config: BYOKConfig | None = None):
    """Real AI Pipeline Step 1-3: Segmentation -> OCR (per bubble) -> Translation (Stop for HITL review)"""
    try:
        if byok_config and job_id in jobs_db:
            jobs_db[job_id]["byok_config"] = byok_config

        # Load image once for all steps
        img = cv2.imread(image_path)
        if img is None:
            raise RuntimeError(f"cv2.imread failed for {image_path}")
        img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        image_height, image_width = img_rgb.shape[:2]
        jobs_db[job_id]["image_width"] = image_width
        jobs_db[job_id]["image_height"] = image_height
        jobs_db[job_id].setdefault("region_mode", "detected")

        # ── Step 1: Segmentation ─────────────────────────────────────────────
        if job_id not in jobs_db or jobs_db[job_id]["status"] == "canceled":
            return
        jobs_db[job_id]["status"] = "segmenting"
        jobs_db[job_id]["progress"] = 10
        jobs_db[job_id]["message"] = "Detecting speech bubbles."
        await notify_state_change()

        manual_override = jobs_db[job_id].get("region_mode") == "manual_override"
        if manual_override:
            blocks = hydrate_engine_blocks(jobs_db[job_id])
        else:
            blocks = segmenter.detect_bubbles(img_rgb)

        if not blocks and not manual_override:
            print(
                f"[job {job_id}] WARNING: YOLO detected 0 bubbles. "
                "Check that the manga-text YOLO weights loaded correctly. "
                "Falling back to whole-image OCR with no inpainting."
            )

        # ── Step 2: OCR per bubble (or whole image fallback) ─────────────────
        if job_id not in jobs_db or jobs_db[job_id]["status"] == "canceled":
            return
        jobs_db[job_id]["status"] = "ocr"
        jobs_db[job_id]["progress"] = 30
        jobs_db[job_id]["message"] = "Running OCR on detected text regions."
        await notify_state_change()


        if blocks:
            # OCR each detected bubble independently
            ocr_tasks = [
                _crop_and_ocr(img_rgb, b.box, image_path, job_id) for b in blocks
            ]
            bubble_texts: List[str] = await asyncio.gather(*ocr_tasks)
            # Assign extracted text back to each block
            for block, raw_text in zip(blocks, bubble_texts):
                block.text = raw_text.strip()
        elif not manual_override:
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
        if job_id not in jobs_db or jobs_db[job_id]["status"] == "canceled":
            return
        jobs_db[job_id]["status"] = "translating"
        jobs_db[job_id]["progress"] = 50
        jobs_db[job_id]["message"] = "Translating extracted text."
        await notify_state_change()

        byok_cfg = byok_config or jobs_db[job_id].get("byok_config")
        source_texts = [b.text or "" for b in blocks]
        if PAGE_CONTEXT_TRANSLATION and len(source_texts) > 1:
            try:
                translated_texts = await translate_page_texts(source_texts, byok_config=byok_cfg)
            except Exception as exc:
                print(
                    f"[job {job_id}] Page-context translation failed, "
                    f"falling back to per-bubble translation: {exc}"
                )
                translation_tasks = [translate_text(text, byok_config=byok_cfg) for text in source_texts]
                translated_texts = await asyncio.gather(*translation_tasks)
        else:
            translation_tasks = [translate_text(text, byok_config=byok_cfg) for text in source_texts]
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
        _persist_runtime_regions(job_id, blocks)
        await notify_state_change()


    except Exception as e:
        import traceback

        print(traceback.format_exc())
        error_message = str(e) or "Translation job failed."
        jobs_db[job_id]["status"] = "failed"
        jobs_db[job_id]["error"] = error_message
        jobs_db[job_id]["message"] = f"Job stopped: {error_message}"
        jobs_db[job_id]["progress"] = min(jobs_db[job_id].get("progress", 0), 95)
        await notify_state_change()



async def resume_manga_task(
    job_id: str, image_path: str, blocks: List[TextBlock] | None = None
):
    """Real AI Pipeline Step 4-6: Inpainting -> Typesetting -> Completed"""
    try:
        durable_blocks = hydrate_engine_blocks(jobs_db.get(job_id, {}))
        if durable_blocks or repository.load_regions(job_id):
            blocks = durable_blocks
        elif blocks is None:
            blocks = []

        # Load image once for all steps
        img = cv2.imread(image_path)
        if img is None:
            raise RuntimeError(f"cv2.imread failed for {image_path}")
        img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

        # ── Step 4: Inpainting ───────────────────────────────────────────────
        if job_id not in jobs_db or jobs_db[job_id]["status"] == "canceled":
            return
        jobs_db[job_id]["status"] = "inpainting"
        jobs_db[job_id]["progress"] = 65
        jobs_db[job_id]["message"] = "Removing source text from the image."
        await notify_state_change()


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
        if job_id not in jobs_db or jobs_db[job_id]["status"] == "canceled":
            return
        jobs_db[job_id]["status"] = "typesetting"
        jobs_db[job_id]["progress"] = 80
        jobs_db[job_id]["message"] = "Rendering translated text into the page."
        await notify_state_change()


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
        await notify_state_change()


    except Exception as e:
        import traceback

        print(traceback.format_exc())
        error_message = str(e) or "Translation job failed."
        jobs_db[job_id]["status"] = "failed"
        jobs_db[job_id]["error"] = error_message
        jobs_db[job_id]["message"] = f"Job stopped: {error_message}"
        jobs_db[job_id]["progress"] = min(jobs_db[job_id].get("progress", 0), 95)
        await notify_state_change()



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


def _verify_image_signature(content: bytes) -> bool:
    if len(content) < 8:
        return False
    # PNG: \x89PNG\r\n\x1a\n
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return True
    # JPEG: \xff\xd8\xff
    if content.startswith(b"\xff\xd8\xff"):
        return True
    # WEBP: RIFF....WEBP
    if content.startswith(b"RIFF") and content[8:12] == b"WEBP":
        return True
    # BMP: BM
    if content.startswith(b"BM"):
        return True
    # TIFF: II*\x00 or MM\x00*
    if content.startswith(b"II\x2a\x00") or content.startswith(b"MM\x00\x2a"):
        return True
    return False


@app.post("/api/translate", response_model=TranslateJobResponse, status_code=202)
async def translate_manga(
    request: Request,
    background_tasks: BackgroundTasks,
    files: list[UploadFile] | None = File(None),
    file: UploadFile | None = File(None),
    project_id: str | None = Form(None)
):
    file_list: list[UploadFile] = []
    if files:
        if isinstance(files, list):
            file_list.extend(files)
        else:
            file_list.append(files)
    if file and file not in file_list:
        file_list.append(file)

    if not file_list:
        raise HTTPException(status_code=400, detail="No upload files provided.")

    if project_id and project_id not in projects_db:
        raise HTTPException(status_code=404, detail="Project not found")

    byok_config = extract_byok_config(request)
    if len(file_list) > MAX_BATCH_UPLOAD_FILES:
        raise HTTPException(
            status_code=413,
            detail=f"Too many files provided. Maximum is {MAX_BATCH_UPLOAD_FILES}.",
        )

    staged: list[tuple[Path, str, str]] = []

    try:
        for upload_file in file_list:
            if upload_file.content_type not in ALLOWED_IMAGE_CONTENT_TYPES:
                raise HTTPException(
                    status_code=415,
                    detail=f"Unsupported media type: {upload_file.content_type or 'unknown'}",
                )

            content = await upload_file.read()
            if len(content) > MAX_UPLOAD_SIZE_BYTES:
                raise HTTPException(
                    status_code=413,
                    detail=f"File exceeds the {MAX_UPLOAD_SIZE_BYTES // (1024 * 1024)}MB limit",
                )

            if not _verify_image_signature(content):
                raise HTTPException(
                    status_code=415,
                    detail="Unsupported media type: invalid image signature",
                )

            normalized_filename, file_ext = _normalize_upload_filename(upload_file.filename)
            file_ext = file_ext or ".png"
            temp_filename = f"temp_{uuid.uuid4()}{file_ext}"
            temp_path = UPLOAD_DIR / temp_filename

            with open(temp_path, "wb") as buffer:
                buffer.write(content)

            staged.append((temp_path, normalized_filename, file_ext))
    except Exception:
        for temp_path, _, _ in staged:
            if temp_path.exists():
                try:
                    temp_path.unlink()
                except Exception:
                    pass
        raise

    jobs_to_create: list[dict[str, Any]] = []
    file_paths_for_tasks: list[tuple[str, Path]] = []
    renamed_final_paths: list[Path] = []

    try:
        for temp_path, normalized_filename, file_ext in staged:
            job_id = str(uuid.uuid4())
            final_filename = f"{job_id}{file_ext}"
            final_path = UPLOAD_DIR / final_filename

            temp_path.rename(final_path)
            renamed_final_paths.append(final_path)

            job_dict = {
                "id": job_id,
                "filename": normalized_filename,
                "status": "queued",
                "progress": 0,
                "message": "Queued for translation.",
                "original_url": _to_public_url(final_path),
                "project_id": project_id,
                "region_mode": "detected",
                "byok_config": byok_config,
            }
            jobs_to_create.append(job_dict)
            file_paths_for_tasks.append((job_id, final_path))

        if project_id:
            created_jobs = repository.create_project_jobs(project_id, jobs_to_create)
            for j in created_jobs:
                jobs_db[j["id"]] = j
            proj_repo = [p for p in repository.load_projects() if p["id"] == project_id]
            if proj_repo:
                projects_db[project_id]["job_ids"] = proj_repo[0]["job_ids"]
                projects_db[project_id]["page_order"] = proj_repo[0]["page_order"]
        else:
            for j in jobs_to_create:
                repository.save_job(j)
                jobs_db[j["id"]] = j
            created_jobs = jobs_to_create
    except Exception:
        for temp_path, _, _ in staged:
            if temp_path.exists():
                try:
                    temp_path.unlink()
                except Exception:
                    pass
        for final_path in renamed_final_paths:
            if final_path.exists():
                try:
                    final_path.unlink()
                except Exception:
                    pass
        raise

    for job_id, final_path in file_paths_for_tasks:
        background_tasks.add_task(process_manga_task, job_id, str(final_path), byok_config=byok_config)

    await notify_state_change(
        job_ids=[j["id"] for j in created_jobs],
        project_ids=[project_id] if project_id else None,
    )

    first_job_id = created_jobs[0]["id"] if created_jobs else ""
    return {
        "id": first_job_id,
        "status": "queued",
        "jobs": [_sanitize_job_for_api(j) for j in created_jobs],
    }


@app.get("/api/byok/providers")
async def get_byok_providers():
    return {"providers": PRESET_PROVIDERS}


class BYOKTestRequest(BaseModel):
    provider: str = Field(default="openai")
    api_key: str | None = Field(default=None)
    model: str = Field(default="gpt-4o-mini")
    api_base: str | None = Field(default=None)


@app.post("/api/byok/test")
async def test_byok_connection(request: Request, payload: BYOKTestRequest | None = None):
    if payload and payload.provider:
        config = BYOKConfig(
            provider=payload.provider.lower(),
            api_key=payload.api_key,
            model=payload.model,
            api_base=payload.api_base,
        )
    else:
        config = extract_byok_config(request)

    test_messages = [
        {"role": "system", "content": "You are an API connection tester. Reply briefly with 'OK'."},
        {"role": "user", "content": "Ping"},
    ]

    try:
        reply = await byok_completion(messages=test_messages, config=config, timeout=15.0)
        return {
            "status": "success",
            "message": f"Successfully connected to provider '{config.provider}' using model '{config.model}'.",
            "reply": reply,
            "config": {
                "provider": config.provider,
                "model": config.model,
                "api_base": config.api_base,
            },
        }
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"Connection test failed for provider '{config.provider}': {str(e)}",
        )



@app.get("/api/status/{job_id}", response_model=JobStatus)
async def get_status(job_id: str):
    if job_id not in jobs_db:
        raise HTTPException(status_code=404, detail="Job not found")
    job = jobs_db[job_id].copy()
    job["status"] = _status_for_api(job.get("status", "queued"))
    return job


def _require_review_job(job_id: str) -> dict:
    if job_id not in jobs_db:
        raise HTTPException(status_code=404, detail="Job not found")
    job = jobs_db[job_id]
    if job.get("status") != "awaiting_review":
        raise HTTPException(
            status_code=409,
            detail="Regions can only be edited while the job is awaiting review",
        )
    if not job.get("image_width") or not job.get("image_height"):
        raise HTTPException(status_code=409, detail="Job image dimensions are unavailable")
    return job


def _source_image_path(job: dict) -> Path:
    image_path = UPLOAD_DIR / Path(job.get("original_url") or "").name
    if not image_path.is_file():
        raise HTTPException(status_code=404, detail="Source image not found")
    return image_path


def _mask_preview_path(job_id: str) -> Path:
    return UPLOAD_DIR / f"mask_preview_{job_id}.png"


def _invalidate_mask_preview(job: dict) -> None:
    job["preview_revision"] = int(job.get("preview_revision") or 0) + 1
    job["mask_preview_url"] = None
    try:
        _mask_preview_path(job["id"]).unlink(missing_ok=True)
    except OSError as exc:
        print(f"Error deleting stale mask preview for {job['id']}: {exc}")


def _same_region_box(region: RegionRecord, box: NormalizedBox) -> bool:
    return all(
        math.isclose(current, proposed, rel_tol=0, abs_tol=1e-12)
        for current, proposed in zip(
            (region.x, region.y, region.width, region.height), box.as_tuple()
        )
    )


@app.put(
    "/api/jobs/{job_id}/regions",
    response_model=RegionCollectionResponse,
)
async def replace_job_regions(
    job_id: str, payload: ReplaceRegionsPayload
) -> RegionCollectionResponse:
    job = _require_review_job(job_id)
    previous_regions = repository.load_regions(job_id)
    previous_by_id = {region.id: region for region in previous_regions}
    saved_regions: list[RegionRecord] = []
    stale_mask_paths: set[str] = set()

    for order, mutation in enumerate(payload.regions):
        previous = previous_by_id.get(mutation.id)
        geometry_unchanged = previous is not None and _same_region_box(
            previous, mutation.box
        )
        if previous and previous.mask_path and not geometry_unchanged:
            stale_mask_paths.add(previous.mask_path)

        source_text = mutation.text
        translated_text = mutation.translated_text
        if previous:
            if "text" not in mutation.model_fields_set:
                source_text = previous.source_text
            if "translated_text" not in mutation.model_fields_set:
                translated_text = previous.translated_text

        saved_regions.append(
            RegionRecord(
                id=mutation.id,
                job_id=job_id,
                order=order,
                x=mutation.box.x,
                y=mutation.box.y,
                width=mutation.box.width,
                height=mutation.box.height,
                source=(previous.source if geometry_unchanged else "manual"),
                source_text=source_text,
                translated_text=translated_text,
                mask_path=previous.mask_path if geometry_unchanged else None,
            )
        )

    saved_ids = {region.id for region in saved_regions}
    stale_mask_paths.update(
        region.mask_path
        for region in previous_regions
        if region.id not in saved_ids and region.mask_path
    )

    repository.replace_regions(job_id, saved_regions)
    job["region_mode"] = "manual_override"
    _invalidate_mask_preview(job)
    repository.save_job(job)
    _hydrate_job_regions(job)

    for mask_path in stale_mask_paths:
        try:
            Path(mask_path).unlink(missing_ok=True)
        except OSError as exc:
            print(f"Error deleting stale mask {mask_path}: {exc}")

    await notify_state_change()
    return RegionCollectionResponse(
        region_mode="manual_override",
        regions=[BlockItem.model_validate(region) for region in job["blocks"]],
    )


@app.patch(
    "/api/jobs/{job_id}/regions/{region_id}",
    response_model=BlockItem,
)
async def patch_job_region(
    job_id: str, region_id: str, payload: PatchRegionPayload
) -> BlockItem:
    job = _require_review_job(job_id)
    regions = repository.load_regions(job_id)
    region_index = next(
        (index for index, region in enumerate(regions) if region.id == region_id),
        None,
    )
    if region_index is None:
        raise HTTPException(status_code=404, detail="Region not found")

    current = regions[region_index]
    source_text = current.source_text
    translated_text = current.translated_text
    if "text" in payload.model_fields_set:
        source_text = payload.text
        if "translated_text" not in payload.model_fields_set:
            translated_text = None
    if "translated_text" in payload.model_fields_set:
        translated_text = payload.translated_text

    regions[region_index] = RegionRecord(
        id=current.id,
        job_id=current.job_id,
        order=current.order,
        x=current.x,
        y=current.y,
        width=current.width,
        height=current.height,
        source=current.source,
        source_text=source_text,
        translated_text=translated_text,
        mask_path=current.mask_path,
    )
    repository.replace_regions(job_id, regions)
    _hydrate_job_regions(job)
    await notify_state_change()
    return BlockItem.model_validate(job["blocks"][region_index])


@app.post(
    "/api/jobs/{job_id}/regions/{region_id}/ocr",
    response_model=BlockItem,
)
async def rerun_region_ocr(job_id: str, region_id: str) -> BlockItem:
    job = _require_review_job(job_id)
    regions = repository.load_regions(job_id)
    region_index = next(
        (index for index, region in enumerate(regions) if region.id == region_id),
        None,
    )
    if region_index is None:
        raise HTTPException(status_code=404, detail="Region not found")

    image_path = _source_image_path(job)
    image_bgr = cv2.imread(str(image_path))
    if image_bgr is None:
        raise HTTPException(status_code=422, detail="Source image could not be decoded")
    image_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
    current = regions[region_index]
    pixel_box = normalized_box_to_pixels(
        (current.x, current.y, current.width, current.height),
        int(job["image_width"]),
        int(job["image_height"]),
    )
    try:
        source_text = (
            await _crop_and_ocr(image_rgb, pixel_box, str(image_path), job_id)
        ).strip()
    except OcrError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    regions[region_index] = RegionRecord(
        id=current.id,
        job_id=current.job_id,
        order=current.order,
        x=current.x,
        y=current.y,
        width=current.width,
        height=current.height,
        source=current.source,
        source_text=source_text,
        translated_text=None,
        mask_path=current.mask_path,
    )
    repository.replace_regions(job_id, regions)
    _hydrate_job_regions(job)
    await notify_state_change()
    return BlockItem.model_validate(job["blocks"][region_index])


@app.post(
    "/api/jobs/{job_id}/mask-preview",
    response_model=MaskPreviewResponse,
)
async def generate_mask_preview(job_id: str) -> MaskPreviewResponse:
    job = _require_review_job(job_id)
    regions = repository.load_regions(job_id)
    for region in regions:
        if region.source != "detected":
            continue
        if not region.mask_path or not Path(region.mask_path).is_file():
            raise HTTPException(
                status_code=409,
                detail=f"Detected mask is unavailable for region {region.id}",
            )

    image_path = _source_image_path(job)
    image_bgr = cv2.imread(str(image_path))
    if image_bgr is None:
        raise HTTPException(status_code=422, detail="Source image could not be decoded")
    image_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
    blocks = hydrate_engine_blocks(job, regions)
    bubble_masks = [block.mask for block in blocks if block.mask is not None]
    text_masks = inpainter.build_text_masks(image_rgb, bubble_masks)
    combined_mask = inpainter._combine_masks(
        image_rgb.shape[:2], text_masks, dilation_px=12
    )

    overlay = np.zeros((*image_rgb.shape[:2], 4), dtype=np.uint8)
    overlay[combined_mask > 0] = (255, 0, 128, 160)

    preview_path = _mask_preview_path(job_id)
    if not cv2.imwrite(
        str(preview_path), cv2.cvtColor(overlay, cv2.COLOR_RGBA2BGRA)
    ):
        raise HTTPException(status_code=500, detail="Mask preview could not be written")

    revision = int(job.get("preview_revision") or 0) + 1
    preview_url = f"/uploads/{preview_path.name}?v={revision}"
    job["preview_revision"] = revision
    job["mask_preview_url"] = preview_url
    repository.save_job(job)
    await notify_state_change()
    return MaskPreviewResponse(url=preview_url, revision=revision)


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

    # Hydrate current geometry and masks from durable state before approval.
    blocks = hydrate_engine_blocks(job)
    if not blocks and not repository.load_regions(job_id):
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
    if job.get("image_width") and job.get("image_height"):
        _persist_runtime_regions(job_id, blocks)
        blocks = hydrate_engine_blocks(job)
        job["blocks_obj"] = blocks

    # Update status and progress
    job["status"] = "inpainting"
    job["progress"] = 60
    job["message"] = "Review approved. Resuming pipeline..."

    # Launch resumption task
    filename = Path(job["original_url"]).name
    file_path = UPLOAD_DIR / filename

    background_tasks.add_task(resume_manga_task, job_id, str(file_path))
    await notify_state_change()

    return {"status": "resumed"}



@app.post("/api/jobs/{job_id}/cancel")
async def cancel_job(job_id: str):
    if job_id not in jobs_db:
        raise HTTPException(status_code=404, detail="Job not found")

    job = jobs_db[job_id]
    if job["status"] in ["completed", "failed", "error", "canceled"]:
        raise HTTPException(
            status_code=400, detail=f"Job cannot be canceled in '{job['status']}' state"
        )

    job["status"] = "canceled"
    job["message"] = "Job canceled by user."
    await notify_state_change()
    return {"status": "canceled"}



class SandboxPayload(BaseModel):
    text: str
    provider: str
    model: str
    system_prompt: str


@app.post("/api/sandbox/translate")
async def sandbox_translate(payload: SandboxPayload):
    """Executes a test translation for the configuration sandbox."""
    try:
        if not BYOK_API_KEY or BYOK_API_KEY == "your_api_key_here":
            # Return a mock translation in the absence of configured key for testing
            # Translate words mockingly to show connection and functionality
            mocked = f"[Sandbox Simulation] แปล: {payload.text} (ใช้ระบบแปลอัตโนมัติจำลอง เนื่องจากไม่ได้ตั้งค่าคีย์ API)"
            return {"translated_text": mocked}
        
        headers = {
            "Authorization": f"Bearer {BYOK_API_KEY}",
            "Content-Type": "application/json",
        }
        api_payload = {
            "model": payload.model if payload.model else BYOK_MODEL,
            "messages": [
                {"role": "system", "content": payload.system_prompt if payload.system_prompt else THAI_SYSTEM_PROMPT},
                {"role": "user", "content": f"Translate the following manga text to Thai:\n\n{payload.text}"},
            ],
        }
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{BYOK_API_BASE}/chat/completions", headers=headers, json=api_payload
            )
            response.raise_for_status()
            result = response.json()
            translated = result["choices"][0]["message"]["content"]
            return {"translated_text": translated}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _sanitize_job_for_api(job: dict) -> dict:
    job_copy = job.copy()
    job_copy["status"] = _status_for_api(job_copy.get("status", "queued"))
    if "blocks_obj" in job_copy:
        del job_copy["blocks_obj"]
    if "byok_config" in job_copy:
        del job_copy["byok_config"]
    return job_copy


@app.get("/api/jobs")
async def list_jobs(project_id: str | None = None):
    """Returns a list of jobs, optionally filtered by project_id and ordered by sequence_id."""
    result = []
    if project_id is not None:
        db_jobs = repository.load_jobs(project_id=project_id)
        for repo_job in db_jobs:
            job_id = repo_job["id"]
            job = jobs_db.get(job_id, repo_job)
            result.append(_sanitize_job_for_api(job))
        return result
    else:
        for job_id, job in jobs_db.items():
            result.append(_sanitize_job_for_api(job))
        return result[::-1]


@app.post("/api/projects", response_model=ProjectResponse, status_code=201)
async def create_project(payload: ProjectCreatePayload):
    import datetime
    project_id = str(uuid.uuid4())
    project = {
        "id": project_id,
        "name": payload.name,
        "created_at": datetime.datetime.now().isoformat(),
        "job_ids": [],
        "page_order": []
    }
    projects_db[project_id] = project
    await notify_state_change(project_ids=[project_id])
    return project


@app.get("/api/projects", response_model=List[ProjectResponse])
async def list_projects():
    db_projects = repository.load_projects()
    for proj in db_projects:
        projects_db[proj["id"]] = proj
    return list(projects_db.values())[::-1]


@app.put("/api/projects/{project_id}/reorder", response_model=ProjectResponse)
async def reorder_project_pages(project_id: str, payload: ReorderPayload):
    if project_id not in projects_db:
        raise HTTPException(status_code=404, detail="Project not found")

    try:
        new_order = repository.reorder_project(project_id, payload.page_order)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    for idx, jid in enumerate(new_order):
        if jid in jobs_db:
            jobs_db[jid]["sequence_id"] = idx

    projects_db[project_id]["page_order"] = new_order
    projects_db[project_id]["job_ids"] = new_order
    await notify_state_change(project_ids=[project_id], job_ids=new_order)
    return projects_db[project_id]


@app.put("/api/projects/{project_id}", response_model=ProjectResponse)
async def update_project(project_id: str, payload: ProjectCreatePayload):
    if project_id not in projects_db:
        raise HTTPException(status_code=404, detail="Project not found")
    
    projects_db[project_id]["name"] = payload.name
    await notify_state_change()
    return projects_db[project_id]


def _safe_unlink_asset(raw_path_or_url: str) -> bool:
    if not raw_path_or_url:
        return True
    if raw_path_or_url.startswith("/uploads/"):
        rel_name = raw_path_or_url.removeprefix("/uploads/").split("?", 1)[0]
        target_path = (UPLOAD_DIR / rel_name).resolve()
    else:
        target_path = Path(raw_path_or_url).resolve()

    allowed_roots = [UPLOAD_DIR.resolve(), MASK_DIR.resolve()]
    for root in allowed_roots:
        try:
            target_path.relative_to(root)
            break
        except ValueError:
            continue
    else:
        print(f"Refusing to delete path outside managed asset roots: {target_path}")
        return False

    try:
        if target_path.exists():
            target_path.unlink()
        return True
    except Exception as exc:
        print(f"Failed to unlink asset {target_path}: {exc}")
        return False


MAX_DELETION_ATTEMPTS = 3
_deletion_attempts: dict[str, int] = {}


def _drain_pending_asset_deletions(max_attempts: int = MAX_DELETION_ATTEMPTS) -> bool:
    pending_paths = repository.get_pending_asset_deletions()
    all_success = True
    for path in pending_paths:
        attempts = _deletion_attempts.get(path, 0) + 1
        _deletion_attempts[path] = attempts
        if _safe_unlink_asset(path):
            repository.remove_pending_asset_deletion(path)
            _deletion_attempts.pop(path, None)
        else:
            if attempts >= max_attempts:
                print(f"Exceeded max deletion attempts ({max_attempts}) for {path}, removing pending record.")
                repository.remove_pending_asset_deletion(path)
                _deletion_attempts.pop(path, None)
            all_success = False
    return all_success


@app.delete("/api/projects/{project_id}")
async def delete_project(project_id: str, background_tasks: BackgroundTasks):
    if project_id not in projects_db:
        raise HTTPException(status_code=404, detail="Project not found")

    asset_paths = repository.delete_project_cascade(project_id)

    job_ids_to_del = [jid for jid, j in jobs_db.items() if j.get("project_id") == project_id]
    for jid in job_ids_to_del:
        del jobs_db[jid]

    if project_id in projects_db:
        del projects_db[project_id]

    failed_paths = []
    for path in asset_paths:
        if not _safe_unlink_asset(path):
            failed_paths.append(path)

    if failed_paths:
        repository.enqueue_pending_asset_deletions(failed_paths)

    drain_success = await asyncio.to_thread(_drain_pending_asset_deletions)
    cleanup_pending = bool(failed_paths) or not drain_success

    if cleanup_pending:
        background_tasks.add_task(_drain_pending_asset_deletions)

    await notify_state_change()
    return {
        "status": "deleted",
        "project_id": project_id,
        "cleanup_pending": cleanup_pending,
    }



@app.delete("/api/jobs/{job_id}")
async def delete_job(job_id: str):
    """Deletes a job from the database and cleans up associated files on disk."""
    if job_id not in jobs_db:
        raise HTTPException(status_code=404, detail="Job not found")

    job = jobs_db[job_id]
    project_id = job.get("project_id")
    asset_paths = repository.delete_job_and_compact(job_id)

    for path in asset_paths:
        if _safe_unlink_asset(path):
            repository.remove_pending_asset_deletion(path)

    if project_id and project_id in projects_db:
        if job_id in projects_db[project_id]["job_ids"]:
            projects_db[project_id]["job_ids"].remove(job_id)
        if "page_order" in projects_db[project_id] and job_id in projects_db[project_id]["page_order"]:
            projects_db[project_id]["page_order"].remove(job_id)

    del jobs_db[job_id]
    if project_id:
        db_jobs = repository.load_jobs(project_id=project_id)
        for repo_job in db_jobs:
            if repo_job["id"] in jobs_db:
                jobs_db[repo_job["id"]]["sequence_id"] = repo_job["sequence_id"]

    if project_id and project_id in projects_db:
        proj_repo = [p for p in repository.load_projects() if p["id"] == project_id]
        if proj_repo:
            projects_db[project_id]["job_ids"] = proj_repo[0]["job_ids"]
            projects_db[project_id]["page_order"] = proj_repo[0]["page_order"]
        else:
            projects_db[project_id]["job_ids"] = [jid for jid in projects_db[project_id]["job_ids"] if jid != job_id]
            projects_db[project_id]["page_order"] = [jid for jid in projects_db[project_id].get("page_order", []) if jid != job_id]

    await notify_state_change(project_ids=[project_id] if project_id else None)
    return {"status": "deleted", "job_id": job_id}



@app.get("/api/system/health")
async def get_system_health():
    """Checks system health including GPU capabilities, Ollama models, and loaded fonts."""
    import torch
    
    ollama_status = "disconnected"
    ollama_models = []
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            response = await client.get(f"{OLLAMA_URL}/api/tags")
            if response.status_code == 200:
                ollama_status = "connected"
                ollama_models = [m.get("name") for m in response.json().get("models", [])]
    except Exception:
        pass
        
    cuda_available = torch.cuda.is_available()
    device_name = torch.cuda.get_device_name(0) if cuda_available else "CPU (No GPU)"
    cuda_device = DEVICE
    
    fonts_dir = Path("assets/fonts")
    available_fonts = []
    if fonts_dir.exists():
        available_fonts = [f.name for f in fonts_dir.glob("*.ttf")]
        
    total_jobs = len(jobs_db)
    completed_jobs = sum(1 for j in jobs_db.values() if j.get("status") == "completed")
    active_jobs = sum(1 for j in jobs_db.values() if j.get("status") in ["queued", "segmenting", "ocr", "translating", "inpainting", "typesetting"])
    awaiting_review = sum(1 for j in jobs_db.values() if j.get("status") == "awaiting_review")
    failed_jobs = sum(1 for j in jobs_db.values() if j.get("status") in ["failed", "error", "canceled"])
    
    return {
        "ollama": {
            "status": ollama_status,
            "models": ollama_models,
            "ocr_model": OCR_MODEL,
        },
        "translation": {
            "byok_configured": bool(BYOK_API_KEY and BYOK_API_KEY != "your_api_key_here"),
            "model": BYOK_MODEL,
            "page_context_translation": PAGE_CONTEXT_TRANSLATION,
        },
        "hardware": {
            "cuda_available": cuda_available,
            "device": cuda_device,
            "device_name": device_name,
            "torch_version": torch.__version__,
        },
        "assets": {
            "fonts": available_fonts,
        },
        "stats": {
            "total": total_jobs,
            "active": active_jobs,
            "awaiting_review": awaiting_review,
            "completed": completed_jobs,
            "failed": failed_jobs,
        }
    }


async def notify_state_change(job_ids: list[str] | str | None = None, project_ids: list[str] | str | None = None):
    try:
        # ponytail: prevent quadratic write amplification by only saving explicitly updated entities
        if job_ids:
            jids = [job_ids] if isinstance(job_ids, str) else job_ids
            for jid in jids:
                if jid in jobs_db:
                    repository.save_job(jobs_db[jid])
        if project_ids:
            pids = [project_ids] if isinstance(project_ids, str) else project_ids
            for pid in pids:
                if pid in projects_db:
                    repository.save_project(projects_db[pid])

        # Ensure page_order is present defensively before publishing
        for proj in projects_db.values():
            if "page_order" not in proj:
                proj["page_order"] = list(proj["job_ids"])

        jobs = await list_jobs()
        await event_manager.publish("jobs", jobs)
        health = await get_system_health()
        await event_manager.publish("health", health)
        projects = list(projects_db.values())[::-1]
        await event_manager.publish("projects", projects)
    except Exception as e:
        print(f"Error in notify_state_change: {e}")


@app.on_event("startup")
async def startup_event():
    hydrate_repository_state()
    _drain_pending_asset_deletions()

    async def periodic_health_broadcast():
        while True:
            try:
                await asyncio.sleep(15)
                health = await get_system_health()
                await event_manager.publish("health", health)
            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"Error in periodic health broadcast: {e}")
                await asyncio.sleep(5)
                
    asyncio.create_task(periodic_health_broadcast())


@app.get("/api/stream/events")
async def stream_events():
    queue = event_manager.subscribe()
    
    async def event_generator():
        try:
            # Push initial state immediately on connect
            initial_jobs = await list_jobs()
            initial_health = await get_system_health()
            
            # Ensure page_order is present defensively
            for proj in projects_db.values():
                if "page_order" not in proj:
                    proj["page_order"] = list(proj["job_ids"])
                    
            initial_projects = list(projects_db.values())[::-1]
            yield f"event: jobs\ndata: {json.dumps(initial_jobs, ensure_ascii=False)}\n\n"
            yield f"event: health\ndata: {json.dumps(initial_health, ensure_ascii=False)}\n\n"
            yield f"event: projects\ndata: {json.dumps(initial_projects, ensure_ascii=False)}\n\n"
            
            while True:
                payload = await queue.get()
                event_type = payload["event"]
                event_data = payload["data"]
                yield f"event: {event_type}\ndata: {json.dumps(event_data, ensure_ascii=False)}\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            event_manager.unsubscribe(queue)
            
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)


