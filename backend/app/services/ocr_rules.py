"""OCR + rule-based receipt extraction (Phase 2).

Real OCR (RapidOCR) does not return receipt lines; it returns many small tokens
with bounding boxes — a "SUBTOTAL" label and its "$24.99" amount arrive as
*separate* tokens on the same visual row. The engine's job is to reconstruct
those rows and pair labels with the right-side values within each row.

Pipeline:
  1. normalize each OCR token to a Token (text, bbox, conf)
  2. group tokens into visual rows by vertical midpoint proximity
  3. classify each row (header / subtotal / tax / total / line-item / footer / unknown)
  4. for money rows, take the *rightmost currency-shaped token in the row* as the
     value — never assume label and value share a token
  5. line items follow the same row logic (description left, price right)

This module stays gated off in production (settings.ocr_engine_enabled). The
public contract (OcrLine, RuleExtraction, extract_with_rules, extract_line_items,
num_from) is stable so callers (extraction_service, ocr_packs) are unchanged.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Optional, Tuple

# ---------------------------------------------------------------------------
# Patterns
# ---------------------------------------------------------------------------
_TOTAL_LABEL_RE = re.compile(
    r"\b(GRAND\s+TOTAL|TOTAL\s+DUE|AMOUNT\s+DUE|BALANCE\s+DUE|TOTAL)\b", re.I
)
_SUBTOTAL_LABEL_RE = re.compile(
    r"\b(SUB\s?TOTAL|SUB-TOTAL|MERCHANDISE\s+TOTAL|ITEMS\s+TOTAL)\b", re.I
)
_TAX_LABEL_RE = re.compile(r"\b(SALES\s+TAX|TAX|GST|VAT|HST)\b", re.I)
_FOOTER_RE = re.compile(
    r"\b(THANK|RETURN|EXCHANGE|POLICY|VISA|MASTERCARD|AMEX|DISCOVER|CASH|CHANGE|"
    r"CARD|APPROVED|AUTH|BALANCE|WELCOME|COME\s+AGAIN)\b",
    re.I,
)
# A currency-shaped money token: optional symbol, thousands separators, 2 decimals.
_PRICE_RE = re.compile(r"^[$€£₹]?\s?\d{1,7}(?:[.,]\d{3})*[.,]\d{2}$")
_NUM_RE = re.compile(r"^[$€£₹]?\s?\d+(?:[.,]\d+)?$")
_DATE_RES = [
    re.compile(r"\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b"),
    re.compile(r"\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b"),
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
_CURRENCY_SYMBOLS = {"$": "USD", "€": "EUR", "£": "GBP", "₹": "INR"}


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------
@dataclass
class OcrLine:
    """Single OCR token as produced by ocr_service (legacy 4-corner box)."""

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
class Token:
    text: str
    x1: float
    y1: float
    x2: float
    y2: float
    conf: float

    @property
    def ymid(self) -> float:
        return (self.y1 + self.y2) / 2.0

    @property
    def height(self) -> float:
        return self.y2 - self.y1


@dataclass
class Row:
    tokens: List[Token]

    @property
    def ymid(self) -> float:
        return sum(t.ymid for t in self.tokens) / len(self.tokens)

    @property
    def text(self) -> str:
        return " ".join(t.text for t in self.tokens)

    @property
    def mean_height(self) -> float:
        return sum(t.height for t in self.tokens) / len(self.tokens)


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


# ---------------------------------------------------------------------------
# Step 1 — normalization + row grouping
# ---------------------------------------------------------------------------
def to_token(line: OcrLine) -> Token:
    xs = [p[0] for p in line.box]
    ys = [p[1] for p in line.box]
    return Token(
        text=line.text.strip(),
        x1=min(xs),
        y1=min(ys),
        x2=max(xs),
        y2=max(ys),
        conf=float(line.conf),
    )


def group_rows(lines: List[OcrLine]) -> List[Row]:
    """Group OCR tokens into visual rows by vertical-midpoint proximity.

    Two tokens share a row when their y_mid differ by less than half the median
    token height. Rows come out top-to-bottom; tokens within a row left-to-right.
    """
    toks = [to_token(l) for l in lines if (l.text or "").strip()]
    if not toks:
        return []
    heights = sorted(t.height for t in toks)
    median_h = heights[len(heights) // 2] or 1.0
    thresh = median_h * 0.5

    toks.sort(key=lambda t: (t.ymid, t.x1))
    rows: List[Row] = []
    for tok in toks:
        if rows and abs(tok.ymid - rows[-1].ymid) <= thresh:
            rows[-1].tokens.append(tok)
        else:
            rows.append(Row(tokens=[tok]))
    for row in rows:
        row.tokens.sort(key=lambda t: t.x1)
    rows.sort(key=lambda r: r.ymid)
    return rows


def num_from(tok: str) -> float:
    tok = re.sub(r"[$€£₹\s]", "", tok).replace(",", "")
    try:
        return float(tok)
    except ValueError:
        return 0.0


def _is_price(tok: str) -> bool:
    return bool(_PRICE_RE.match(tok.strip()))


# ---------------------------------------------------------------------------
# Step 2 — row classification
# ---------------------------------------------------------------------------
_HEADER_FRACTION = 0.15


def classify_row(row: Row, y_min: float, y_max: float) -> str:
    text = row.text
    has_price = any(_is_price(t.text) for t in row.tokens)
    has_alpha = any(any(c.isalpha() for c in t.text) for t in row.tokens)
    in_header = (row.ymid - y_min) <= (y_max - y_min) * _HEADER_FRACTION

    if _SUBTOTAL_LABEL_RE.search(text):
        return "subtotal-line"
    if _TAX_LABEL_RE.search(text):
        return "tax-line"
    if _TOTAL_LABEL_RE.search(text):
        return "total-line"
    if _FOOTER_RE.search(text):
        return "footer"
    if in_header and not has_price:
        return "header"
    if has_price and has_alpha:
        return "line-item"
    if not has_price and not has_alpha:
        return "footer"
    return "unknown"


# ---------------------------------------------------------------------------
# Step 3 — label→rightmost-price pairing (the actual fix)
# ---------------------------------------------------------------------------
def _rightmost_price_value(row: Row) -> Tuple[Optional[float], float]:
    numeric = [t for t in row.tokens if _is_price(t.text)]
    if not numeric:
        return None, 0.0
    tok = max(numeric, key=lambda t: t.x2)
    return num_from(tok.text), min((t.conf for t in row.tokens), default=0.0)


# ---------------------------------------------------------------------------
# Step 4 — line items
# ---------------------------------------------------------------------------
_MID_QTY_RE = re.compile(r"^[1-9]\d?$")  # 1–99


def line_items_from_row(row: Row) -> Optional[dict]:
    """A row with alphabetic text on the left and a currency amount on the right."""
    price_tokens = [t for t in row.tokens if _is_price(t.text)]
    if not price_tokens:
        return None
    rightmost_price = max(price_tokens, key=lambda t: t.x2)
    total_price = num_from(rightmost_price.text)
    if total_price == 0.0:
        return None

    left = [t for t in row.tokens if t is not rightmost_price]
    qty = 1.0
    desc_tokens = []
    for t in left:
        if _MID_QTY_RE.match(t.text) and qty == 1.0:
            qty = float(t.text)
            continue
        desc_tokens.append(t.text)
    description = " ".join(desc_tokens).strip()
    if not description or not any(c.isalpha() for c in description):
        return None
    unit_price = round(total_price / qty, 4) if qty else total_price
    return {
        "description": description,
        "quantity": qty,
        "unit_price": unit_price,
        "total_price": total_price,
    }


# ---------------------------------------------------------------------------
# Step 5 — merchant (header, largest font)
# ---------------------------------------------------------------------------
def _merchant(rows: List[Row], classifications: List[str]) -> Tuple[str, float]:
    header_rows = [r for r, c in zip(rows, classifications) if c == "header"]
    if not header_rows:
        return "", 0.0
    all_heights = [r.mean_height for r in rows] or [1.0]
    median_all = sorted(all_heights)[len(all_heights) // 2] or 1.0
    best = max(header_rows, key=lambda r: r.mean_height)
    oversize = best.mean_height / median_all if median_all else 1.0
    conf = round(min(1.0, 0.5 + (oversize - 1.0)), 3) if median_all else 0.6
    return best.text.title(), conf


# ---------------------------------------------------------------------------
# Step 6 — currency
# ---------------------------------------------------------------------------
def _detect_currency(lines: List[OcrLine]) -> str:
    from collections import Counter

    counts = Counter()
    for ln in lines:
        for sym, code in _CURRENCY_SYMBOLS.items():
            counts[code] += ln.text.count(sym)
    if counts:
        return counts.most_common(1)[0][0]
    return "USD"


# ---------------------------------------------------------------------------
# Public entry — kept stable for extraction_service / ocr_packs / tests
# ---------------------------------------------------------------------------
def extract_with_rules(
    lines: List[OcrLine], known_merchant: Optional[str] = None
) -> RuleExtraction:
    ex = RuleExtraction(lines=lines)
    if not lines:
        return ex

    rows = group_rows(lines)
    if not rows:
        return ex
    y_min = min(r.ymid for r in rows)
    y_max = max(r.ymid for r in rows)
    classes = [classify_row(r, y_min, y_max) for r in rows]

    # merchant
    if known_merchant:
        ex.merchant, ex.merchant_conf = known_merchant, 0.95
    else:
        ex.merchant, ex.merchant_conf = _merchant(rows, classes)

    # date: scan header rows first, then everything
    for scope in ([r for r, c in zip(rows, classes) if c == "header"], rows):
        hit = False
        for r in scope:
            d, c = _parse_date(r.text)
            if d:
                ex.date, ex.date_conf = d, c
                hit = True
                break
        if hit:
            break

    # money fields: rightmost price within the classified row
    sub_i = [i for i, c in enumerate(classes) if c == "subtotal-line"]
    tax_i = [i for i, c in enumerate(classes) if c == "tax-line"]
    total_i = [i for i, c in enumerate(classes) if c == "total-line"]

    def _pick(indices):
        # prefer the LAST such row near the bottom for totals; FIRST for subtotal
        return indices[-1] if indices else None

    si, ti, toi = _pick(sub_i), _pick(tax_i), _pick(total_i)
    if si is not None:
        v, c = _rightmost_price_value(rows[si])
        ex.subtotal = v or 0.0
    if ti is not None:
        v, c = _rightmost_price_value(rows[ti])
        ex.tax = v or 0.0
    if toi is not None:
        v, c = _rightmost_price_value(rows[toi])
        ex.total = v or 0.0
        ex.total_conf = max(c, 0.8) if v else 0.0

    ex.currency = _detect_currency(lines)

    # line items: classified line-item rows
    items = []
    for r, c in zip(rows, classes):
        if c != "line-item":
            continue
        li = line_items_from_row(r)
        if li:
            items.append(li)
    ex.line_items = items
    return ex


def extract_line_items(lines: List[OcrLine], exclude=()) -> List[dict]:
    """Compatibility helper: line items via the same row-based engine."""
    ex = extract_with_rules(lines)
    return ex.line_items


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
