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
# A currency-shaped money token. Supports US ($1,234.56), UK/German decimals
# ("79,44", £6.50), and Australian thousands-dot ("$2.020.90"). The decimal
# separator is whichever of '.' or ',' appears LAST; the rest are thousands
# separators and are ignored. Two-digit fraction is the anchor for a money value.
_PRICE_RE = re.compile(
    r"^[A-Z€£₹$]*\s*\d{1,3}(?:[.,\u00a0]\d{3})*[.,]\d{2}\s*[A-Z]?$", re.I
)


def num_from(tok: str) -> float:
    """Parse a money token into a float, tolerant of '.' OR ',' decimals and
    '.' OR ',' thousands separators.

    Rule: strip currency letters/symbols, keep digits + separators; the LAST of
    '.' or ',' that is followed by exactly 1–2 digits is the decimal separator;
    every other separator is a thousands separator and is dropped.

    num_from("$2.020.90")  -> 2020.90   (AUD thousands + decimal)
    num_from("Total 79,44" *) -> 79.44   (UK comma-decimal)
        (* the caller strips leading label text; this function only sees the token)
    num_from("$1,234.56")    -> 1234.56  (US thousands + decimal)
    """
    s = re.sub(r"[^0-9.,]", "", tok)
    if not s:
        return 0.0
    # find the last separator followed by 1–4 digits — that's the decimal point
    last_sep = max(s.rfind("."), s.rfind(","))
    if last_sep == -1:
        digits = s  # integer
        try:
            return float(digits)
        except ValueError:
            return 0.0
    int_part = re.sub(r"[.,]", "", s[:last_sep])
    frac_part = s[last_sep + 1 :]
    # Only treat as a decimal split if the fractional part has 1–2 digits,
    # otherwise the last separator is a thousands separator (e.g. "1.000").
    if 1 <= len(frac_part) <= 2 and frac_part.isdigit():
        s_norm = int_part + "." + frac_part
    else:
        s_norm = int_part + frac_part  # all digits; last sep was thousands
    try:
        return float(s_norm)
    except ValueError:
        return 0.0


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


def _clean_description(desc: str) -> str:
    """Strip leading SKU/barcode digits, remove OCR artifacts, collapse spaces."""
    desc = re.sub(r"^\d{5,}", "", desc).strip()  # leading SKU like 1778788
    desc = re.sub(r"[*_~]+", " ", desc)  # artifact characters that sneak in
    desc = re.sub(r"\s{2,}", " ", desc).strip()
    return desc


def line_items_from_row(row: Row) -> Optional[dict]:
    """A row with alphabetic text on the left and a currency amount on the right.

    Price token may have a trailing tax-flag letter (e.g. "3.99 A" or "8.49 T")
    which shows up as a separate token after the number, not inside it — the
    regex `_PRICE_RE` accepts the optional trailing letter already.
    """
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
    description = _clean_description(" ".join(desc_tokens))
    if not description or not any(c.isalpha() for c in description):
        return None
    unit_price = round(total_price / qty, 4) if qty else total_price
    return {
        "description": description,
        "quantity": qty,
        "unit_price": unit_price,
        "total_price": total_price,
    }


def _dedupe_items(items: List[dict]) -> List[dict]:
    """Merge accidental duplicates produced by RapidOCR's two-pass detection."""
    seen = set()
    out = []
    for li in items:
        key = (li["description"].lower(), li["total_price"])
        if key in seen:
            continue
        seen.add(key)
        out.append(li)
    return out


# ---------------------------------------------------------------------------
# Step 5 — merchant (header, largest font, looks like a name)
# ---------------------------------------------------------------------------
# Rows that look like an address or administrative line must not win:
_ADDRESS_NOISE = re.compile(
    r"(\d{3,}|\bSt(?:reet)?\b|\bRd\b|\bRoad\b|\bAve(?:nue)?\b|\bBlvd\b|\bTel\b|"
    r"\bPhone\b|\bVAT\b|\bABN\b|\bGST\b|\bShop\b|\bUnit\b|\bDr(?:ive)?\b|\bLane\b)",
    re.I,
)


def _merchant(rows: List[Row], classifications: List[str]) -> Tuple[str, float]:
    header_rows = [r for r, c in zip(rows, classifications) if c == "header"]
    if not header_rows:
        return "", 0.0

    def score(r: Row) -> float:
        text = r.text
        if _ADDRESS_NOISE.search(text):
            return 0.0  # looks like an address or phone, not a merchant name
        letters = sum(c.isalpha() for c in text)
        # Bigger font AND alphabetic-leaning => stronger merchant candidate.
        return r.mean_height * (1.0 + letters / max(len(text), 1))

    best = max(header_rows, key=score)
    if score(best) <= 0.0:
        # every header row read like an address — fall back to first non-noise
        # line even if it isn't technically classified header.
        for r in header_rows:
            if not _ADDRESS_NOISE.search(r.text):
                best = r
                break
    median_all = sorted(r.mean_height for r in rows)[len(rows) // 2] or 1.0
    oversize = best.mean_height / median_all if median_all else 1.0
    conf = round(min(1.0, 0.5 + (oversize - 1.0)), 3) if median_all else 0.6
    return best.text.title(), conf


# A tax row that is purely a summary ("TOTAL TAX OF…" / "TAX_A 8.25% TOTAL") is
# not the per-sale tax amount; it's an aggregate line. Real per-sale tax reads
# "TAX 2.14", "GST 183.80", "VAT (20%) 13.24".
_TAX_SUMMARY_RE = re.compile(r"\bTOTAL\s+TAX\b|\b\d+(\.\d+)?%\b|\bTAX\s+OF\b", re.I)


def _tax_value(rows: List[Tuple[Row, str]]) -> List[Tuple[Row, float]]:
    """Rank tax-classified rows; best first the per-sale money row wins.

    Preference order:
      1. bare TAX/GST/VAT label + clean money token
      2. any tax-labelled row that has a numeric value
      3. (last resort) "% TOTAL TAX OF…" summary rows
    """
    best = []
    for i, (row, cls) in enumerate(rows):
        if cls != "tax-line":
            continue
        value, conf = _rightmost_price_value(row)
        if value is None:
            continue
        score = conf
        if _TAX_SUMMARY_RE.search(row.text):
            score -= 0.6  # "TOTAL TAX OF" summary — deprioritize
        else:
            score += 0.3  # clean per-sale label
        best.append((score, i, row, value))
    # sort: score desc, then original index asc (stable, picks the earliest)
    best.sort(key=lambda t: (-t[0], t[1]))
    return [(t[2], t[3]) for t in best]


# ---------------------------------------------------------------------------
# Step 6 — currency
# ---------------------------------------------------------------------------
_CURRENCY_CODES = {"£": "GBP", "£": "GBP", "A$": "AUD", "AU$": "AUD", "AUD": "AUD"}


def _detect_currency(lines: List[OcrLine]) -> str:
    from collections import Counter

    counts = Counter()
    for ln in lines:
        for sym, code in _CURRENCY_SYMBOLS.items():
            counts[code] += ln.text.count(sym)
        # also catch literal ISO codes such as "AUD" or "£" written in text
        for iso in ("GBP", "AUD", "USD", "EUR", "INR"):
            if iso in ln.text.upper():
                counts[iso] += 1
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
    total_i = [i for i, c in enumerate(classes) if c == "total-line"]

    def _pick(indices):
        # prefer the LAST such row near the bottom for totals; FIRST for subtotal
        return indices[-1] if indices else None

    si, toi = _pick(sub_i), _pick(total_i)
    if si is not None:
        v, c = _rightmost_price_value(rows[si])
        ex.subtotal = v or 0.0
    if toi is not None:
        v, c = _rightmost_price_value(rows[toi])
        ex.total = v or 0.0
        ex.total_conf = max(c, 0.8) if v else 0.0

    # tax: prefer the cleanest "TAX/GST/VAT + money" row, not a "% TOTAL TAX" summary
    tax_candidates = _tax_value(list(zip(rows, classes)))
    if tax_candidates:
        ex.tax = tax_candidates[0][1] or 0.0

    ex.currency = _detect_currency(lines)

    # line items: classified line-item rows (sanitised + deduped)
    items = []
    for r, c in zip(rows, classes):
        if c != "line-item":
            continue
        li = line_items_from_row(r)
        if li:
            items.append(li)
    ex.line_items = _dedupe_items(items)
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
