import re


class OcrError(RuntimeError):
    """Raised when OCR fails and the translation job must stop."""


def clean_ocr_error_detail(message: str) -> str:
    detail = re.sub(r"(?:\s*---\s*)?Error during OCR:\s*", " ", message).strip()
    return detail or "OCR service returned repeated failure markers."


def ocr_failure_message(error: Exception | str) -> str:
    detail = clean_ocr_error_detail(str(error))
    return f"OCR failed. Translation stopped before the next stage. Details: {detail}"
