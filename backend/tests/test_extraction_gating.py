"""Extraction pipeline gating (Phase 2).

The OCR engine ships but is OFF by default; extraction is Gemini-only until the
flag flips. These tests pin that contract without touching Gemini or OCR models.
"""

from app.config.settings import get_settings
from app.services import extraction_service
from app.services.gemini_service import ReceiptExtraction


def _gemini(image_bytes: bytes, mime: str) -> ReceiptExtraction:
    return ReceiptExtraction(
        merchant="Gemini Mart", total=1.23, extraction_method="gemini"
    )


def test_default_is_gemini_only(monkeypatch):
    """With ocr_engine_enabled off (default), extract never calls OCR, always Gemini."""
    settings = get_settings()
    monkeypatch.setattr(settings, "ocr_engine_enabled", False)

    called = {"ocr": False}

    import app.services.ocr_service as _ocr

    monkeypatch.setattr(
        _ocr, "ocr_image", lambda *_: called.update(ocr=True) or [], raising=True
    )
    out = extraction_service.extract_receipt(
        b"img", "image/webp", gemini_extract=_gemini
    )
    assert out.extraction_method == "gemini"
    assert out.merchant == "Gemini Mart"
    assert called["ocr"] is False


def test_flag_on_still_falls_back_to_gemini_when_low_conf(monkeypatch):
    """Flag on + weak/empty OCR => Gemini fallback (threshold gate not cleared)."""
    settings = get_settings()
    monkeypatch.setattr(settings, "ocr_engine_enabled", True)
    monkeypatch.setattr(settings, "ocr_total_threshold", 0.9)
    monkeypatch.setattr(settings, "ocr_merchant_threshold", 0.95)

    import app.services.ocr_service as _ocr
    from app.services.ocr_rules import OcrLine

    lines = [
        OcrLine(text="some header", conf=0.5, box=[[0, 0], [10, 0], [10, 10], [0, 10]])
    ]
    monkeypatch.setattr(_ocr, "ocr_image", lambda *_: lines)
    out = extraction_service.extract_receipt(
        b"img", "image/webp", gemini_extract=_gemini
    )
    # generic engine on one token won't reach total 0.9 + total>0 -> Gemini.
    assert out.extraction_method == "gemini"


# --- null handling in the extraction schema ---------------------------------
# The prompt tells Gemini to use null for unknown values, and it does. A receipt
# with no printed tax line came back "tax": null and the whole receipt was marked
# failed — a readable receipt lost entirely to one missing field.


def test_null_numeric_fields_fall_back_to_defaults():
    from app.services.gemini_service import ReceiptExtraction

    e = ReceiptExtraction(
        **{
            "merchant": "Quick Mart",
            "total": 10.55,
            "subtotal": 9.75,
            "tax": None,
            "currency": None,
            "category": None,
            "confidence": None,
            "line_items": None,
            "date": None,
        }
    )
    assert e.tax == 0
    assert e.currency == "USD"
    assert e.category == "other"
    assert e.line_items == []


def test_null_date_stays_none_rather_than_becoming_a_default():
    """None is a real answer for date — "no date printed" — not a missing value."""
    from app.services.gemini_service import ReceiptExtraction

    assert ReceiptExtraction(**{"merchant": "X", "date": None}).date is None


def test_null_inside_a_line_item_does_not_fail_the_receipt():
    from app.services.gemini_service import ReceiptExtraction

    e = ReceiptExtraction(
        **{
            "merchant": "X",
            "line_items": [
                {"description": "Juice", "unit_price": None, "total_price": 3.25}
            ],
        }
    )
    assert e.line_items[0].unit_price == 0
    assert e.line_items[0].total_price == 3.25
