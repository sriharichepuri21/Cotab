"""Extraction orchestration (Phase 2): Gemini primary, OCR gated behind a flag.

`extract_receipt(image_bytes, mime)` is the single entry the upload/retry
endpoints call. Today it always defers to Gemini: the OCR + rules engine is
shipped but gated OFF (settings.ocr_engine_enabled) because it still needs
row-reconstruction to be trustworthy on real receipts — see ARCHITECTURE.md
"Known limitations". When the flag is enabled and the OCR result clears the
confidence thresholds, OCR handles the extraction and skips the LLM call.

The result always carries `extraction_method` ("ocr" or "gemini") so we can
measure the split once the engine is live. The Gemini dependency is injected so
the pipeline is testable without a network or an API key.
"""

from __future__ import annotations

from typing import Callable

from app.config.settings import get_settings
from app.services import gemini_service, ocr_service
from app.services.gemini_service import LineItem, ReceiptExtraction
from app.services.ocr_packs import detect_pack, extract_with_pack
from app.services.ocr_rules import extract_with_rules

settings = get_settings()

# Gemini extractor signature; injected in tests.
GeminiExtract = Callable[[bytes, str], ReceiptExtraction]


# What we tell people when a scan is refused. Each says what went wrong and
# what to do next; none of them leaves anything on the tab.
REJECTION_MESSAGES = {
    "not_a_receipt": "That doesn't look like a receipt, so nothing was added. "
    "Try again with a photo of the receipt itself.",
    "blurry": "This photo is too blurry to read. Hold the phone steady and try again, "
    "or choose a sharper photo.",
    "too_dark": "This photo is too dark to read. Move somewhere brighter and try again.",
    "glare": "Light is reflecting off the receipt. Tilt it slightly away from the light "
    "and try again.",
    "cut_off": "Part of the receipt is cut off. Fit the whole receipt in the frame, "
    "including the total.",
    "too_far": "The receipt is too small in the photo. Move closer so it fills the frame.",
    "no_total": "We couldn't find a total on this receipt. Try a clearer photo that "
    "shows the whole receipt, or for a long order screenshot, the part with the "
    "order total.",
}
_PROBLEMS = set(REJECTION_MESSAGES)


class ScanRejected(Exception):
    """The image is not a usable receipt. Nothing should be saved."""

    def __init__(self, code: str):
        self.code = code if code in REJECTION_MESSAGES else "no_total"
        self.message = REJECTION_MESSAGES[self.code]
        super().__init__(self.message)


def assess(extraction: ReceiptExtraction) -> None:
    """Raise ScanRejected unless this extraction is a readable receipt.

    Trusts the model's own verdict first, then backs it up with a sanity
    check: a "receipt" with no total and no items is not something we can put
    on anyone's tab, whatever the model claimed.
    """
    problem = (extraction.problem or "").strip().lower()
    if problem in ("", "null", "none"):
        problem = ""
    if not extraction.is_receipt:
        raise ScanRejected("not_a_receipt")
    if extraction.readability == "unreadable":
        raise ScanRejected(problem if problem in _PROBLEMS else "no_total")
    if (extraction.total or 0) <= 0 and not extraction.line_items:
        raise ScanRejected(problem if problem in _PROBLEMS else "no_total")


def extract_receipt(
    image_bytes: bytes,
    mime: str,
    gemini_extract: GeminiExtract = gemini_service.extract_receipt_from_image,
) -> ReceiptExtraction:
    """Gemini by default; OCR + rules only when ocr_engine_enabled is set.

    Raises ScanRejected when the image is not a readable receipt.
    """
    if settings.ocr_engine_enabled:
        try:
            lines = ocr_service.ocr_image(image_bytes)
        except Exception:
            lines = []

        if lines:
            pack = detect_pack(lines)
            rule = extract_with_pack(pack, lines) if pack else extract_with_rules(lines)
            high_conf = (
                rule.total_conf >= settings.ocr_total_threshold
                and rule.merchant_conf >= settings.ocr_merchant_threshold
            )
            if high_conf and rule.total > 0:
                return ReceiptExtraction(
                    merchant=rule.merchant,
                    merchant_raw=rule.merchant,
                    date=rule.date,
                    total=rule.total,
                    subtotal=rule.subtotal,
                    tax=rule.tax,
                    currency=rule.currency,
                    category=rule.category,
                    confidence=min(rule.merchant_conf, rule.total_conf),
                    line_items=[LineItem(**li) for li in rule.line_items],
                    extraction_method="ocr",
                )

    # Default / fallback: Gemini.
    out = gemini_extract(image_bytes, mime)
    out.extraction_method = "gemini"
    assess(out)
    return out


GeminiTextExtract = Callable[[str], ReceiptExtraction]


def extract_receipt_text(
    text: str,
    gemini_extract: GeminiTextExtract = gemini_service.extract_receipt_from_text,
) -> ReceiptExtraction:
    """Read a receipt from email text with the AI. Raises ScanRejected when
    the email isn't a receipt (a newsletter, a shipping update with no total)."""
    out = gemini_extract(text)
    out.extraction_method = "gemini"
    assess(out)
    return out
