"""OCR + rule-based receipt extraction (Phase 2).

Pipeline shape: Gemini is the *fallback*, not the foundation.
`extract_receipt_from_image` runs OCR + deterministic rules first. If the
combined confidence clears the threshold we return the rule result with
`extraction_method="ocr"` and never call Gemini. Otherwise we defer to the LLM.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Optional, Tuple

# Receipt-mean line patterns. Whole-word, case-insensitive.
_TOTAL_RE = re.compile(
    r"\b(GRAND\s+TOTAL|TOTAL\s+DUE|AMOUNT\s+DUE|BALANCE\s+DUE|TOTAL|AMOUNT)\b", re.I
)
_SUBTOTAL_RE = re.compile(
    r"\b(SUB\s?TOTAL|SUB-TOTAL|MERCHANDISE\s+TOTAL|ITEMS\s+TOTAL)\b", re.I
)
_TAX_RE = re.compile(r"\b(SALES\s+TAX|TAX|GST|VAT|HST)\b", re.I)

_PRICE_RE = re.compile(r"(\$?\s?\d{1,6}[.,]\d{2})\b")
_DATE_RES = [
    re.compile(r"\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b"),  # 12/25/2025 or 25/12/25
    re.compile(r"\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b"),  # 2025-12-25
    re.compile(
        r"\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+(\d{1,2}),?\s+(20\d{2})\b",
        re.I,
    ),
    re.compile(
        r"\b(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+(20\d{2})\b",
        re.I,
    ),
]
_MONTHS = {
    "JAN": 1,
    "FEB": 2,
    "MAR": 3,
    "APR": 4,
    "MAY": 5,
    "JUN": 6,
    "JUL": 7,
    "AUG": 8,
    "SEP": 9,
    "OCT": 10,
    "NOV": 11,
    "DEC": 12,
}


@dataclass
class OcrLine:
    text: str
    conf: float
    box: List[List[float]]

    @property
    def y(self) -> float:
        return min(p[1] for p in self.box)

    @property
    def x0(self) -> float:
        return min(p[0] for p in self.box)

    @property
    def x1(self) -> float:
        return max(p[0] for p in self.box)


@dataclass
class RuleExtraction:
    merchant: str = ""
    merchant_conf: float = 0.0
    date: Optional[str] = None
    date_conf: float = 0.0
    total: float = 0.0
    total_conf: float = 0.0
    subtotal: float = 0.0
    tax: float = 0.0
    currency: str = "USD"
    category: str = "other"
    line_items: List[dict] = field(default_factory=list)
    lines: List[OcrLine] = field(default_factory=list)


def _price_after_label(
    lines: List[OcrLine], label_re: re.Pattern
) -> Tuple[float, float]:
    """Find a labelled money line; return (value, confidence).

    Confidence blends the token confidence with a format weight (label present at
    all -> high) so the threshold gate sees a meaningful signal.
    """
    for ln in lines:
        if label_re.search(ln.text):
            m = _PRICE_RE.search(ln.text)
            if m:
                return num_from(m.group(1)), min(1.0, ln.conf + 0.15)
    return 0.0, 0.0


def num_from(tok: str) -> float:
    tok = tok.replace("$", "").replace(",", "").strip()
    try:
        return float(tok)
    except ValueError:
        return 0.0


def _fallback_total(lines: List[OcrLine]) -> Tuple[float, float]:
    """No explicit TOTAL line: take the largest money amount near the bottom."""
    best = 0.0
    best_conf = 0.0
    if not lines:
        return 0.0, 0.0
    max_y = max(ln.y for ln in lines)
    for ln in lines:
        if ln.y < max_y * 0.6:
            continue  # bottom region only
        for m in _PRICE_RE.finditer(ln.text):
            v = num_from(m.group(1))
            if v > best:
                best, best_conf = v, ln.conf
    return best, best_conf * 0.7  # heuristic -> lower confidence


def _merchant(lines: List[OcrLine], known: Optional[str] = None) -> Tuple[str, float]:
    if known:
        return known, 0.95
    if not lines:
        return "", 0.0
    # Topmost, highest-conf non-symbol line is the merchant header.
    header = sorted(lines, key=lambda l: (l.y, -l.conf))
    for ln in header[:4]:
        txt = ln.text.strip()
        if not txt or _PRICE_RE.fullmatch(txt.strip()):
            continue
        if _DATE_RES[0].search(txt):
            continue
        letters = sum(c.isalpha() for c in txt)
        if letters >= 2:
            conf = min(1.0, ln.conf + 0.1)
            return txt.title(), round(conf, 3)
    return header[0].text.strip().title(), round(header[0].conf, 3)


def _parse_date(text: str) -> Tuple[Optional[str], float]:
    for ln_re in _DATE_RES:
        m = ln_re.search(text)
        if m:
            try:
                if ln_re is _DATE_RES[0]:
                    a, b, c = int(m.group(1)), int(m.group(2)), int(m.group(3))
                    year = c if c > 100 else 2000 + c
                    month, day = (a, b) if a <= 12 else (b, a)
                elif ln_re is _DATE_RES[1]:
                    year, month, day = int(m.group(1)), int(m.group(2)), int(m.group(3))
                elif ln_re is _DATE_RES[2]:
                    month, day, year = (
                        _MONTHS[m.group(1)[:3].upper()],
                        int(m.group(2)),
                        int(m.group(3)),
                    )
                else:
                    day, month, year = (
                        int(m.group(1)),
                        _MONTHS[m.group(2)[:3].upper()],
                        int(m.group(3)),
                    )
                return datetime(year, month, day).date().isoformat(), 0.85
            except (ValueError, KeyError):
                continue
    return None, 0.0


def extract_with_rules(
    lines: List[OcrLine], known_merchant: Optional[str] = None
) -> RuleExtraction:
    ex = RuleExtraction(lines=lines)
    ex.merchant, ex.merchant_conf = _merchant(lines, known_merchant)
    # date: scan header region first (top third)
    top = [
        l
        for l in lines
        if lines and l.y <= (max((q.y for q in lines), default=0) * 0.35)
    ]
    for ln in top or lines:
        d, c = _parse_date(ln.text)
        if d:
            ex.date, ex.date_conf = d, c
            break
    if not ex.date:
        for ln in lines:
            d, c = _parse_date(ln.text)
            if d:
                ex.date, ex.date_conf = d, c * 0.8
                break
    ex.total, ex.total_conf = _price_after_label(lines, _TOTAL_RE)
    if not ex.total:
        ex.total, ex.total_conf = _fallback_total(lines)
    ex.subtotal, _ = _price_after_label(lines, _SUBTOTAL_RE)
    ex.tax, _ = _price_after_label(lines, _TAX_RE)
    if any("$" in (l.text) for l in lines):
        ex.currency = "USD"
    ex.line_items = extract_line_items(
        lines, exclude=(_TOTAL_RE, _SUBTOTAL_RE, _TAX_RE)
    )
    return ex


def extract_line_items(lines: List[OcrLine], exclude=()) -> List[dict]:
    """Price-at-end heuristic: a line whose right side is a money amount and whose
    left side is alphabetic, excluding total/subtotal/tax/footer lines."""
    items = []
    for ln in lines:
        t = ln.text.strip()
        if any(rx.search(t) for rx in exclude):
            continue
        if any(
            k in t.upper()
            for k in ("VISA", "MASTERCARD", "AMEX", "CASH", "CHANGE", "THANK")
        ):
            continue
        m = _PRICE_RE.search(t)
        if not m:
            continue
        desc = t[: m.start()].strip()
        if len(desc) < 2 or not any(c.isalpha() for c in desc):
            continue
        items.append(
            {
                "description": desc,
                "quantity": 1,
                "unit_price": num_from(m.group(1)),
                "total_price": num_from(m.group(1)),
            }
        )
    return items
