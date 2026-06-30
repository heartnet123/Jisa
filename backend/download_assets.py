up
"""
download_assets.py
------------------
Run ONCE before starting the server to pre-download all model weights
into the backend directory.  After this script completes, the server
will load models from local disk and never need an internet connection
during inference.

Usage:
    cd backend
    uv run python download_assets.py
"""

import shutil
from pathlib import Path

BACKEND_DIR = Path(__file__).parent

# ---------------------------------------------------------------------------
# Manga YOLO weights
# ---------------------------------------------------------------------------

MANGA_YOLO_HF_REPO = "keremberke/yolov8n-manga-text-detection"
MANGA_YOLO_LOCAL = BACKEND_DIR / "manga_yolo_best.pt"

# ---------------------------------------------------------------------------
# SAM 2 weights  (downloaded by ultralytics on first use, but we mirror here)
# ---------------------------------------------------------------------------

SAM2_LOCAL = BACKEND_DIR / "sam2_b.pt"


def download_manga_yolo():
    if MANGA_YOLO_LOCAL.exists():
        print(f"[✓] Manga YOLO weights already present: {MANGA_YOLO_LOCAL}")
        return

    print(f"[↓] Downloading manga YOLO weights from HuggingFace …")
    print(f"    repo: {MANGA_YOLO_HF_REPO}")

    try:
        from huggingface_hub import hf_hub_download  # type: ignore

        hf_path = hf_hub_download(repo_id=MANGA_YOLO_HF_REPO, filename="best.pt")
        shutil.copy(hf_path, MANGA_YOLO_LOCAL)
        print(f"[✓] Saved to {MANGA_YOLO_LOCAL}  ({MANGA_YOLO_LOCAL.stat().st_size / 1e6:.1f} MB)")
    except Exception as exc:
        print(f"[✗] Download failed: {exc}")
        print("    Install huggingface_hub:  uv pip install huggingface_hub")
        raise


def check_sam2():
    if SAM2_LOCAL.exists():
        print(f"[✓] SAM 2 weights present: {SAM2_LOCAL}  ({SAM2_LOCAL.stat().st_size / 1e6:.1f} MB)")
    else:
        print("[!] sam2_b.pt not found.  It will be auto-downloaded by ultralytics on first use.")
        print("    To pre-download:  python -c \"from ultralytics import SAM; SAM('sam2_b.pt')\"")


if __name__ == "__main__":
    download_manga_yolo()
    check_sam2()
    print("\n[✓] All assets ready.  You can now start the server.")
