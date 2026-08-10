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


def extract_receipt(
    image_bytes: bytes,
    mime: str,
    gemini_extract: GeminiExtract = gemini_service.extract_receipt_from_image,
) -> ReceiptExtraction:
    """Gemini by default; OCR + rules only when ocr_engine_enabled is set."""
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
    return out
