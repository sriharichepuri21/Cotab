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
# Typo-tolerant keyword matching (OCR misreads short labels: "Subtptal",
# "Totla", "TAX" vs "TAX1"). Each entry matches a kw up to edit-distance 1.
# ---------------------------------------------------------------------------
def _lev1(a: str, b: str) -> bool:
    """True when `a` and `b` are within one edit (substitution, insert, delete)."""
    if a == b:
        return True
    la, lb = len(a), len(b)
    if abs(la - lb) > 1:
        return False
    if la == lb:
        return sum(c1 != c2 for c1, c2 in zip(a, b)) == 1
    # one-char insert/delete
    if la > lb:
        a, b = b, a
    i = j = 0
    skipped = False
    while i < len(a) and j < len(b):
        if a[i] == b[j]:
            i += 1
            j += 1
        elif not skipped:
            skipped = True
            i += 1
        else:
            return False
    return True


def _levenshtein(a: str, b: str) -> int:
    """Classic DP edit distance (substitution/insert/delete). Used by the
    merchant-scoped title filter where edit-distance 1 is too tight to separate
    'Seattle Bellevue' (noise) from the merchant name."""
    if a == b:
        return 0
    la, lb = len(a), len(b)
    if abs(la - lb) > 2:
        return 3  # early-out: only need to distinguish 0/1/2 from "far"
    prev = list(range(lb + 1))
    for i in range(1, la + 1):
        cur = [i] + [0] * lb
        for j in range(1, lb + 1):
            cur[j] = min(
                prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] != b[j - 1])
            )
        prev = cur
    return prev[lb]


def _has_label(row_text: str, keywords: List[str]) -> bool:
    """Any whitespace-delimited word within edit-distance 1 of a keyword, an exact
    compound-phrase match, or OCR glue like "GSTINCLUDED" where a keyword PREFIXES
    a token (label and trailing word run together on the same cell)."""
    up = row_text.upper()
    for kw in keywords:
        if " " in kw:
            if kw in up:
                return True
            parts = kw.split()
            if len(parts) == 2 and any(
                _lev1(w, parts[0]) and _lev1(v, parts[1])
                for w in up.split()
                for v in up.split()
            ):
                return True
        else:
            for w in up.split():
                if _lev1(w, kw):
                    return True
                # OCR glue: keyword is a prefix of a longer token ("GSTINCLUDED",
                # "TOTALAMOUNT", "SUBTOTALEXCL"). Length diff must be alpha-ish.
                if w.startswith(kw) and w != kw and w[len(kw) :].isalpha():
                    return True
    return False


_TOTAL_KEYWORDS = ["GRAND TOTAL", "TOTAL DUE", "AMOUNT DUE", "BALANCE DUE", "TOTAL"]
_SUBTOTAL_KEYWORDS = ["SUBTOTAL", "SUB-TOTAL", "MERCHANDISE TOTAL", "ITEMS TOTAL"]
_TAX_KEYWORDS = ["SALES TAX", "TAX", "GST", "VAT", "HST"]

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
# Payment tender rows duplicate the total ("DEBIT TEND 90.32", "SHOPPING CARD
# TEND 35.05"). They must not be read as line items. Checked after money labels.
_TEND_RE = re.compile(r"\b(TEND|TENDER|DEBIT\s*TEND|EFTPOS)\b", re.I)
# A currency amount with a single trailing tax-flag letter and nothing else
# ("14.97 X", "12.94N") — an orphan price row, not a footer.
_PRICE_ONLY_RE = re.compile(
    r"^[A-Z€£₹$]*\s*\d{1,3}(?:[., ]\d{3})*[.,]\d{2}\s*[A-Z]?$", re.I
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


def _sloppy_amount(tok: str) -> float:
    """Parse a money token that may carry exactly ONE OCR-mangled character in an
    otherwise clean decimal shape ("81F02" for "81.02"). The mangle must sit where
    a decimal separator belongs: <digits><one non-digit><2 digits>. Returns 0.0 when
    the token is clean (handled by num_from) or too ambiguous to trust."""
    s = tok.strip()
    if _PRICE_RE.match(s):
        return num_from(s)
    m = re.match(r"^[A-Z€£₹$]*\s*(\d+)[^0-9](\d{2})\s*[A-Z]?$", s, re.I)
    if not m:
        return 0.0
    return float(m.group(1) + "." + m.group(2))


# Upper bound for inferring tax arithmetically. Sales tax/GST/VAT tops out near
# 27% worldwide (Hungary); 30% leaves headroom while still rejecting a gap that
# is really a tip, a deposit or a second item.
_MAX_PLAUSIBLE_TAX_RATE = 0.30


def _sum_matches_line_items(
    subtotal: float, tax: float, total: float, n_items: int
) -> bool:
    """Arithmetic self-check: does subtotal + tax ≈ total? Used to prefer the
    consistent TOTAL over a higher 'AMOUNT DUE' row on multi-currency slips."""
    if n_items == 0 or subtotal == 0.0 or total == 0.0:
        return False
    return abs((subtotal + tax) - total) <= max(0.02, round(total * 0.005, 2) + 0.01)


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

    # Money rows first — always win over line-item, even when they carry a price.
    # Labels match exactly via regex OR tolerantly via edit-distance-1 (_has_label)
    # so an OCR misread ('Subtptal' for 'SUBTOTAL', 'T0TAL' for 'TOTAL') still lands.
    if _SUBTOTAL_LABEL_RE.search(text) or _has_label(text, _SUBTOTAL_KEYWORDS):
        return "subtotal-line"
    if _TAX_LABEL_RE.search(text) or _has_label(text, _TAX_KEYWORDS):
        return "tax-line"
    if _TOTAL_LABEL_RE.search(text) or _has_label(text, _TOTAL_KEYWORDS):
        return "total-line"
    # A payment-tender row ("DEBITTEND 90.32", "VISA 35.05") duplicates the total
    # but is NOT a merchandise line item. Check AFTER the money labels so a real
    # "TOTAL ..." row still wins (some receipts print "TOTAL TEND").
    if _TEND_RE.search(text):
        return "payment"
    if _FOOTER_RE.search(text):
        return "footer"
    if in_header and not has_price:
        return "header"
    if has_price and has_alpha:
        return "line-item"
    # A lone currency amount with no alphabetic text ("14.97 X", "12.94N") is an
    # orphan price — most often the price of a multi-line item whose name row was
    # dropped by the OCR pass. classify it so step 4 can try to reattach a name.
    if has_price and not has_alpha:
        return "price-only"
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
# A 12–14 digit run = UPC/EAN/GTIN (barcode), present on Kmart-style rows and
# Walmart's "088851018239 24" format. It must not count as quantity or a price.
_BARCODE_RE = re.compile(r"^\d{12,14}$")
# A money token that contains TWO prices in one string ("$1.997.00") — capture
# the trailing amount (the SUMMARY/FINAL price) rather than corrupting the pair.
_DOUBLE_PRICE_RE = re.compile(r"^(.*?)(\d+[.,]\d{2})?$")


def _price_text(tok: str) -> str:
    """Return the normalized money token from an OCR token.

    Handles the glued-price case ("$1.997.00") by keeping the amount after the
    LAST separator — that's the final price the register printed.
    """
    m = _DOUBLE_PRICE_RE.match(tok.strip())
    if not m:
        return tok
    head, tail = m.groups()
    if tail:  # glued double-price: take the trailing amount
        return tail
    return tok


def _qty_matches_price(qty: float, price: float, unit: float) -> bool:
    """True when qty is a whole positive number whose product with `unit` ≈ price.
    Used to guard the ambiguous shape '85 x .52' (Kmart): only split it when the
    multiplication is internally consistent, else keep the whole number as price."""
    if qty < 1 or qty != int(qty) or qty > 999:
        return False
    return abs(qty * unit - price) <= max(0.02, price * 0.02)


def _join_split_decimal(row: Row) -> Optional[Tuple[Token, float]]:
    """Rejoin an amount whose decimal point OCR turned into a token break.

    "SUBYOTAL | 84 | 16" is one amount (84.16) rendered as two adjacent digit
    tokens. Adjacency is the whole safeguard: a real quantity column is separated
    by whitespace, so we require the gap to be under one character width. Without
    that, "3 x 4.99" style rows would be welded into nonsense.
    """
    digits = [t for t in row.tokens if t.text.strip().isdigit()]
    if len(digits) < 2:
        return None
    digits.sort(key=lambda t: t.x1)
    for left, right in zip(digits, digits[1:]):
        rtext = right.text.strip()
        ltext = left.text.strip()
        if len(rtext) != 2 or not (1 <= len(ltext) <= 4):
            continue  # cents are exactly 2 digits; dollars stay realistic
        char_w = (right.x2 - right.x1) / max(len(rtext), 1)
        if (right.x1 - left.x2) > char_w * 0.8:
            continue  # too far apart to be one number
        value = float(f"{ltext}.{rtext}")
        if value > 0:
            return right, value
    return None


def extract_price(row: Row) -> Tuple[Optional[Token], float]:
    """Locate the currency amount in a row. Order: clean rightmost money token;
    then split a glued two-amount token ("... 24 94" -> 24.94); then recover one
    corrupted decimal point in the item-tail shape <desc><12-14 digit barcode><2-3
    digit cents> produced when the OCR pass drops the '.' and the trailing letter
    ("COM3PCSET 088851018239 44" -> 9.44). Returns (token, value) or (None, 0.0)."""
    price_tokens = [
        t for t in row.tokens if _is_price(t.text) and not _BARCODE_RE.match(t.text)
    ]
    if price_tokens:
        rightmost = max(price_tokens, key=lambda t: t.x2)
        # Special case: "2.511b 11b/1.44 3.61N" — two money tokens; the second is
        # qty @ unit, the real line total is rightmost. qty-col detection is the
        # caller's job; here we still return the rightmost clean amount.
        v = num_from(_price_text(rightmost.text))
        if v != 0.0:
            return rightmost, v

    # Glued two-amount single token ("24 94") spanning the row: the last money
    # fragment is the column value. Recover by splitting on the space.
    for t in sorted(row.tokens, key=lambda t: t.x2, reverse=True):
        m = _GLUED_PAIR_RE.match(t.text.strip())
        if m:
            val = float(m.group(2))
            if val != 0.0:
                return t, val

    # Split-decimal recovery: the decimal point was not just lost but *broke the
    # token in two* — "SUBYOTAL" "84" "16", where "84" and "16" sit flush against
    # each other in the amount column. Distinct from _GLUED_PAIR_RE, which is one
    # token containing a space. Requires physical adjacency so two genuinely
    # separate columns (qty and price) are never welded together.
    joined = _join_split_decimal(row)
    if joined is not None:
        return joined

    # Corrupt-decimal recovery: single token shaped <desc...><12-14 digits><2-3
    # digit tail>. The tail is the price with its '.' or ',' dropped by OCR.
    for t in sorted(row.tokens, key=lambda t: t.x2, reverse=True):
        txt = t.text.strip()
        if _is_price(txt) or _BARCODE_RE.match(txt):
            continue
        for tail_len in (2, 3):
            if len(txt) < tail_len + 1:
                continue
            head, tail = txt[:-tail_len], txt[-tail_len:]
            if not tail.isdigit() or not any(c.isalpha() for c in head):
                continue
            if re.search(r"\d{12,14}$", head) or re.search(r"\d{5,}$", head):
                cents = int(tail)
                if tail_len == 3 and not tail.startswith("00"):
                    continue  # "997" alone is not a cents tail; needs the shape
                value = cents / 100.0 if tail_len == 2 else cents / 100.0
                if value > 0:
                    return t, value
    return None, 0.0


# "24 94" — two money fragments OCR glued into one token (space kept, '.' lost).
_GLUED_PAIR_RE = re.compile(r"^(\d+)\s+(\d{2})$")
# Right-trailing quantity column "85 x .52 4.25": qty@unit on the left, total right.
_QTY_AT_UNIT_RE = re.compile(
    r"(\d{1,3})\s*[x×@]\s*[A-Z€£₹$]?(\d+[.,]\d{2})\s+([A-Z€£₹$]*\d+[.,]\d{2})", re.I
)


def _clean_description(desc: str) -> str:
    """Strip leading SKU/barcode digits, remove OCR artifacts, collapse spaces."""
    desc = re.sub(r"^\d{5,}", "", desc).strip()  # leading SKU like 1778788
    desc = re.sub(r"[*_~]+", " ", desc)  # artifact characters that sneak in
    desc = re.sub(r"\s{2,}", " ", desc).strip()
    return desc


def _item_from_tokens(
    desc_tokens: List[str],
    total_price: float,
    left_qty: float,
    unit_price: Optional[float],
) -> Optional[dict]:
    """Assemble one line item. `left_qty` is a multiplier/token found in the qty
    column; `unit_price` is the per-unit amount when the row carried it ('24 94'
    or 'qty @ unit'). Falls back to qty=1 when geometry gave nothing."""
    description = _clean_description(" ".join(desc_tokens))
    if not description or not any(c.isalpha() for c in description):
        return None
    qty = left_qty if left_qty and left_qty > 0 else 1.0
    if unit_price is None:
        unit_price = round(total_price / qty, 4) if qty else total_price
    return {
        "description": description,
        "quantity": qty,
        "unit_price": unit_price,
        "total_price": total_price,
    }


def line_items_from_row(row: Row) -> Optional[dict]:
    """A row with alphabetic text on the left and a currency amount on the right.

    Guards from real-corpus failures:
    - Barcode tokens (12–14 digit UPC/GTIN) are not a quantity or price.
    - A glued two-price token ("$1.997.00") keeps the trailing (final) amount.
    - Right-side "24 94" split recovers the line total (24.94).
    - "qty @ unit ... total" puts qty from a left column and unit from the middle.
    - Corrupt-decimal single-token tail ("...BARCODE 44" -> 9.44) is recovered.
    """
    # qty @ unit ... total — strongest signal, present on Kmart/UK layouts.
    joined = row.text
    qm = _QTY_AT_UNIT_RE.search(joined)
    if qm:
        q, unit, tot = qm.group(1), qm.group(2), qm.group(3)
        qty = float(q)
        unit_price = num_from(unit)
        total_price = num_from(tot)
        if _qty_matches_price(qty, total_price, unit_price):
            desc_text = joined[: qm.start()].strip()
            return _item_from_tokens(
                re.split(r"\s{1,}", desc_text), total_price, qty, unit_price
            )

    price_tok, total_price = extract_price(row)
    if price_tok is None or total_price == 0.0:
        return None

    # Walk left-to-right; the rightmost money token is the price. Everything
    # before it is description or a leading quantity multiplier.
    qty = 1.0
    desc_tokens: List[str] = []
    for t in row.tokens:
        if t is price_tok:
            continue
        if _BARCODE_RE.match(t.text):
            continue  # barcode never lands in description or quantity
        if _MID_QTY_RE.match(t.text) and qty == 1.0 and not desc_tokens:
            qty = float(t.text)  # leading multiplier "2 COFFEE 8.00"
            continue
        # An embedded "weight @ price" fragment ("2.511b 11b/1.44") is metadata,
        # not the line total; drop it from the description.
        if "l" in t.text.lower() and "/" in t.text:  # "11b/1.44"
            continue
        desc_tokens.append(t.text)

    # If the row still carried a per-unit fragment ("24 94"), prefer the left
    # fragment as unit_price when it divides the total into a whole qty.
    desc = _clean_description(" ".join(desc_tokens))
    if not desc:
        return None
    return _item_from_tokens([desc], total_price, qty, None)


def _norm_desc(description: str) -> str:
    """Normalize for cross-row dedup: lowercase, drop leading SKU digits and
    trailing artifacts so '1778788***KSWTR40PK' and 'KSWTR40PK' compare equal."""
    return _clean_description(description).lower().strip()


def merge_multi_line_items(rows: List[Row], item_flags: List[bool]) -> List[dict]:
    """Assemble logical line items from raw rows.

    Three-row physically-fragmented layouts (Walmart#1: name row / weight row /
    price row) are joined upward; RapidOCR ghost duplicates (Costco: same row read
    twice, 30px apart, gaps reset on any intervening OCR dropout) are collapsed.
    Distant duplicates — a customer buying the same SKU twice — must survive.
    """
    out: List[Tuple[dict, int]] = []  # (item, raw_row_index)
    last_price_key: Optional[Tuple[str, float]] = None
    last_raw_idx = -1
    for i, (row, is_item) in enumerate(zip(rows, item_flags)):
        if not is_item:
            last_price_key = None
            continue
        li = line_items_from_row(row)
        if li is None:
            continue
        key = (_norm_desc(li["description"]), round(li["total_price"], 2))
        # Ghost merge: same logical row re-read within a 1 blank-row gap.
        if last_price_key == key and (i - last_raw_idx) <= 3:
            last_raw_idx = i
            continue  # drop the duplicate
        out.append((li, i))
        last_price_key = key
        last_raw_idx = i
    return [li for li, _ in out]


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
_ISO_CODES = ("AUD", "NZD", "CAD", "GBP", "EUR", "INR", "USD")

# "$" is deliberately absent: AU, NZ, CA, SG and US all print it, so on its own it
# carries no information. Treating it as USD is what made every foreign receipt in
# the corpus read as USD.
_UNAMBIGUOUS_SYMBOLS = {"£": "GBP", "€": "EUR", "₹": "INR"}

# Tax-regime / registration markers. These identify the country even when OCR
# drops the symbol entirely — "£" is frequently read as "E", "f" or nothing at
# all, which is exactly how the GBP receipt in the corpus lost its currency.
# GST is intentionally NOT used alone: AU, NZ, IN, CA and SG all levy one.
# No trailing \b: OCR glues tokens together ("ABN73004700485",
# "KmartAustraliaLtd"), so a closing word boundary never matches.
_ABN_RE = re.compile(r"\bABN\s*:?\s*\d|AUSTRALIA", re.I)  # ABN is uniquely Australian
_NZ_RE = re.compile(r"\bNZBN\b|NEW\s*ZEALAND", re.I)
# Same glue problem ("VATNo:987654321"), so no trailing \b. The lookahead keeps
# it from swallowing longer words that merely start with those letters.
_VAT_RE = re.compile(r"\bVAT(?![A-Za-z]{3,})", re.I)
_UK_RE = re.compile(r"\bU\.?K\.?\b|\bLONDON\b|\bENGLAND\b|\bBRITAIN\b", re.I)


def _detect_currency(lines: List[OcrLine]) -> str:
    """Resolve the currency from the whole document, most-specific signal first.

    Ordered rather than counted: an explicit "AUD" outranks a dozen "$" glyphs,
    and counting let the ambiguous "$" outvote the real signal.
    """
    blob = " ".join(ln.text for ln in lines)
    up = blob.upper()

    # 1. An explicit ISO code is unambiguous by construction.
    for iso in _ISO_CODES:
        if re.search(rf"\b{iso}\b", up):
            return iso

    # 2. Symbols that map to exactly one currency.
    for sym, code in _UNAMBIGUOUS_SYMBOLS.items():
        if sym in blob:
            return code

    # 3. Country markers, for receipts whose symbol is "$" or was lost by OCR.
    if _ABN_RE.search(up):
        return "AUD"
    if _NZ_RE.search(up):
        return "NZD"
    if _VAT_RE.search(up):
        # VAT is European; the UK is the only common non-euro member of that set.
        return "GBP" if _UK_RE.search(up) else "EUR"

    # 4. A bare "$" with no regional signal — US is the safe default.
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

    # ---- line items ------------------------------------------------------
    # 1) find the contiguous block of merchandise rows (from just under the
    #    header to the first subtotal/total/tax/payment row). Inside that block
    #    an "unknown" row that extract_price() can read a trailing amount from
    #    is a line item even when classify_row() called it unknown — this is the
    #    corrupt-decimal case ("...BARCODE 44" with the '.' lost) that Walmart#2
    #    is built from. Noise rows (SKU-only, balance-history, store numbers)
    #    never carry a parseable trailing amount, so they are excluded by
    #    construction.
    n = len(rows)
    block_end = n
    for i, c in enumerate(classes):
        if c in ("subtotal-line", "tax-line", "total-line", "payment", "footer"):
            block_end = i
            break
    block_start = 0
    for i, c in enumerate(classes[:block_end]):
        if c in ("header", "unknown") and not any(
            _is_price(t.text) for t in rows[i].tokens
        ):
            block_start = i + 1  # walk down past the header/no-price preamble

    def _is_item_candidate(i: int) -> bool:
        if i >= block_end:
            return False
        if classes[i] == "line-item":
            return True
        if classes[i] in ("unknown", "price-only") and block_start <= i < block_end:
            ptok, val = extract_price(rows[i])
            return ptok is not None and val != 0.0
        return False

    item_flags = [_is_item_candidate(i) for i in range(block_end)] + [False] * (
        n - block_end
    )
    ex.line_items = merge_multi_line_items(rows[:block_end], item_flags[:block_end])

    # ---- money fields ------------------------------------------------------
    # Use extract_price (not the strict _rightmost_price_value) so a mangled
    # amount on a labeled row ("TOTAL 81F02") still yields a value.
    def _row_value(idx: int) -> Tuple[float, float]:
        ptok, val = extract_price(rows[idx])
        if val == 0.0:
            return 0.0, 0.0
        conf = min((t.conf for t in rows[idx].tokens), default=0.0)
        return val, conf

    sub_i = [i for i, c in enumerate(classes) if c == "subtotal-line"]
    total_i = [i for i, c in enumerate(classes) if c == "total-line"]

    si = sub_i[-1] if sub_i else None  # last subtotal (closest to the money block)
    if si is not None:
        v, _c = _rightmost_price_value(rows[si])  # strict first on money rows
        if not v:
            # Strict found nothing: fall back to recovery, which rejoins an amount
            # OCR split at the decimal ("SUBYOTAL | 84 | 16"). Only ever runs when
            # the strict read produced zero, so it can't override a clean value.
            v, _c = _row_value(si)
        ex.subtotal = v or 0.0

    # tax: prefer the cleanest per-sale "TAX/GST/VAT + money" row.
    tax_candidates = _tax_value(list(zip(rows, classes)))
    if tax_candidates:
        ex.tax = tax_candidates[0][1] or 0.0
    # Arithmetic fallback: when the labeled tax row's amount was OCR-mangled
    # ("TAX1 8250% 16" -> no money) but subtotal and a consistent total exist,
    # tax = total - subtotal. Only when we have a trustworthy total already.
    # (Set after total below; placeholder here keeps ordering clear.)

    ex.currency = _detect_currency(lines)

    # TOTAL: prefer the labeled TOTAL row whose value is consistent with
    # subtotal+tax (kills "AMOUNT DUE <foreign-currency>" rows on Courtyard);
    # otherwise fall back to the LAST labeled total, then to a bare payment echo
    # amount ("$81.02" / "90.32 TOTAL PURCHASE") when the labeled total's amount
    # was OCR-mangled to zero. Reads use strict money-shape first; the manged-
    # decimal recovery (_sloppy_amount) is only a fallback for zeros.
    def _total_row_value(idx: int) -> Tuple[float, float]:
        v, c = _rightmost_price_value(rows[idx])  # strict
        if (not v) and total_i:
            # the amount token was mangled ('81F02'); retry the rightmost token
            # with one-corrupted-decimal tolerance.
            rightmost = max(rows[idx].tokens, key=lambda t: t.x2)
            sv = _sloppy_amount(rightmost.text)
            if sv:
                v = sv
        return (v or 0.0), (c or 0.0)

    chosen_total = 0.0
    chosen_conf = 0.0
    if total_i:
        consistent = None
        for idx in total_i:  # ascending; keep the LAST consistent one
            v, c = _total_row_value(idx)
            if v and _sum_matches_line_items(
                ex.subtotal, ex.tax, v, len(ex.line_items)
            ):
                consistent = (v, c)
        if consistent is not None:
            chosen_total, chosen_conf = consistent
        else:
            v, c = _total_row_value(total_i[-1])
            chosen_total, chosen_conf = v, c
    if (not chosen_total) and total_i:
        # labeled total's own amount was mangled to 0: find a standalone bare
        # amount elsewhere (payment echo block) that equals subtotal+tax.
        target = ex.subtotal + ex.tax
        for r, c in zip(rows, classes):
            if c in ("header",):
                continue
            ptok, val = extract_price(r)
            if val and abs(val - target) <= max(0.02, target * 0.01):
                chosen_total, chosen_conf = val, 0.55
                break
    ex.total = chosen_total
    ex.total_conf = max(chosen_conf, 0.8) if chosen_total and total_i else chosen_conf

    # Arithmetic fallback for a tax row whose amount OCR destroyed beyond
    # recovery ("TAX1 8250% 16" — the leading "6." was never detected at all).
    # Derive tax = total - subtotal, but only when it is genuinely inferable:
    #   * a labeled tax row existed, so the receipt does charge tax
    #   * subtotal and total were both read cleanly
    #   * the result lands in a plausible tax band
    # The band is what keeps this honest — on a receipt with tips, discounts or
    # deposits the difference is not tax, and a wrong number is worse than a
    # visible zero.
    if ex.tax == 0.0 and ex.subtotal > 0 and ex.total > ex.subtotal:
        if any(c == "tax-line" for c in classes):
            derived = round(ex.total - ex.subtotal, 2)
            if 0 < derived <= ex.subtotal * _MAX_PLAUSIBLE_TAX_RATE:
                ex.tax = derived

    ex.currency = _detect_currency(lines)
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
