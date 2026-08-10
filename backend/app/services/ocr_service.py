"""Thin wrapper around RapidOCR turning receipt image bytes into OcrLine rows.

RapidOCR (ONNX runtime) is pure-pip — no system binary — so it installs on
Render's native-python runtime with zero infra change. The model is lazy-loaded
on first use so app startup stays fast.
"""

from __future__ import annotations

from typing import List, Optional

from app.services.ocr_rules import OcrLine

_engine = None


def _get_engine():
    global _engine
    if _engine is None:
        from rapidocr_onnxruntime import RapidOCR

        _engine = RapidOCR()
    return _engine


def ocr_image(image_bytes: bytes) -> List[OcrLine]:
    """Run OCR; return reading-order lines with confidence + boxes.

    Raises on unreadable input; returns [] on an empty-but-valid image.
    """
    import cv2
    import numpy as np

    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("could not decode image bytes")
    engine = _get_engine()
    result, _elapse = engine(img)
    lines: List[OcrLine] = []
    for item in result or []:
        box, text, conf = item[0], item[1], item[2]
        try:
            conf = float(conf)  # RapidOCR returns confidence as a string
        except (TypeError, ValueError):
            conf = 0.0
        lines.append(OcrLine(text=str(text).strip(), conf=conf, box=box))
    # reading order: top-to-bottom, then left-to-right
    lines.sort(key=lambda l: (round(l.y, 1), l.x0))
    return lines
