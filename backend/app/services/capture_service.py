"""Purchases that arrive without a receipt, starting with Apple Pay taps.

An iPhone Shortcuts automation ("When I tap a Wallet card") sends the store
and amount the moment someone pays. There is no photo and nothing for the AI
to read, so a tap costs nothing and lands on the tab instantly. If the paper
or emailed receipt turns up later, `find_tap_match` lets the upload fill this
same purchase in with its items instead of adding a second one.
"""

from __future__ import annotations

import hashlib
import re
import secrets
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import List, Optional, Tuple

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import CaptureKey, Receipt

KEY_PREFIX = "ctb_"
MAX_KEYS = 5
# The same tap reported twice (Shortcuts can fire twice on a slow network)
# arrives within seconds; a real second purchase of the same thing is rarer.
DOUBLE_FIRE_WINDOW = timedelta(minutes=2)
# How far apart a tap and its receipt's printed date can be and still match.
MATCH_WINDOW = timedelta(days=2)

# --- keys ------------------------------------------------------------------------


def _hash(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def create_key(
    db: Session, user_id: str, name: str = "iPhone"
) -> Tuple[CaptureKey, str]:
    """Make a key. The plain key is returned once and never stored."""
    plain = KEY_PREFIX + secrets.token_urlsafe(24)
    row = CaptureKey(
        user_id=user_id,
        name=(name or "iPhone").strip()[:64] or "iPhone",
        key_hash=_hash(plain),
        prefix=plain[: len(KEY_PREFIX) + 4],
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row, plain


def active_keys(db: Session, user_id: str):
    return (
        db.query(CaptureKey)
        .filter(CaptureKey.user_id == user_id, CaptureKey.deleted_at.is_(None))
        .order_by(CaptureKey.created_at.desc())
        .all()
    )


def key_owner(db: Session, plain: str) -> Optional[CaptureKey]:
    """The live key matching `plain`, or None for anything unknown or revoked."""
    if not plain or not plain.startswith(KEY_PREFIX):
        return None
    return (
        db.query(CaptureKey)
        .filter(CaptureKey.key_hash == _hash(plain), CaptureKey.deleted_at.is_(None))
        .first()
    )


# --- reading what the phone sends ------------------------------------------------

_SYMBOLS = {
    "$": "USD",
    "US$": "USD",
    "€": "EUR",
    "£": "GBP",
    "₹": "INR",
    "¥": "JPY",
    "CA$": "CAD",
    "C$": "CAD",
    "A$": "AUD",
    "AU$": "AUD",
}
_CODE = re.compile(r"\b([A-Z]{3})\b")
# Only real currency codes count, so "18.64 TRIP" isn't read as currency TRI.
CURRENCY_CODES = {
    "USD",
    "EUR",
    "GBP",
    "INR",
    "CAD",
    "AUD",
    "NZD",
    "JPY",
    "CNY",
    "HKD",
    "SGD",
    "CHF",
    "SEK",
    "NOK",
    "DKK",
    "PLN",
    "CZK",
    "MXN",
    "BRL",
    "ZAR",
    "AED",
    "SAR",
    "KRW",
    "THB",
    "MYR",
    "IDR",
    "PHP",
    "VND",
    "TRY",
    "ILS",
    "NGN",
    "KES",
    "PKR",
    "BDT",
    "LKR",
    "NPR",
    "EGP",
    "ARS",
    "CLP",
    "COP",
    "PEN",
    "TWD",
    "HUF",
    "RON",
}


def parse_amount(raw: object) -> Tuple[Optional[float], Optional[str]]:
    """Read an amount the way Wallet hands it over.

    Accepts numbers and strings such as "$5.75", "5,75 €", "USD 12.00",
    "1,234.56" and "1.234,56". Returns (amount, currency or None); the amount
    is None when nothing sensible is there.
    """
    if isinstance(raw, bool):
        return None, None
    if isinstance(raw, (int, float)):
        return (float(raw), None) if raw == raw else (None, None)  # NaN check
    text = str(raw or "").strip()
    if not text:
        return None, None

    currency = None
    for symbol in sorted(_SYMBOLS, key=len, reverse=True):
        if symbol in text:
            currency = _SYMBOLS[symbol]
            break
    code = _CODE.search(text.upper())
    if code and code.group(1) in CURRENCY_CODES:
        currency = code.group(1)  # an explicit code ("EUR 12.00") beats a symbol

    digits = re.sub(r"[^\d.,\-]", "", text)
    if not re.search(r"\d", digits):
        return None, currency
    # Decide which of . and , is the decimal mark: whichever comes last, if it
    # is followed by exactly two digits (or one, as in "5,5").
    last_dot, last_comma = digits.rfind("."), digits.rfind(",")
    mark = max(last_dot, last_comma)
    if mark != -1 and 1 <= len(digits) - mark - 1 <= 2:
        whole = re.sub(r"[.,]", "", digits[:mark])
        number = f"{whole}.{digits[mark + 1:]}"
    else:
        number = re.sub(r"[.,]", "", digits)
    try:
        return float(Decimal(number)), currency
    except InvalidOperation:
        return None, currency


_WORDS = {
    "groceries": (
        "instacart",
        "market",
        "grocery",
        "safeway",
        "trader joe",
        "whole foods",
        "kroger",
        "aldi",
        "costco",
        "walmart",
        "sprouts",
        "publix",
        "wegmans",
        "lidl",
    ),
    "dining": (
        "starbucks",
        "coffee",
        "cafe",
        "café",
        "restaurant",
        "pizza",
        "burger",
        "chipotle",
        "mcdonald",
        "taco",
        "sushi",
        "bar",
        "grill",
        "kitchen",
        "bakery",
        "doordash",
        "uber eats",
        "dunkin",
        "peet",
    ),
    "transport": (
        "shell",
        "chevron",
        "exxon",
        "bp ",
        "uber",
        "lyft",
        "parking",
        "transit",
        "metro",
        "fuel",
        "gas",
    ),
    "health": ("pharmacy", "cvs", "walgreens", "rite aid", "clinic", "dental"),
    "entertainment": (
        "cinema",
        "theatre",
        "theater",
        "amc",
        "netflix",
        "spotify",
        "steam",
    ),
    "shopping": (
        "target",
        "amazon",
        "best buy",
        "ikea",
        "apple store",
        "nike",
        "zara",
        "h&m",
    ),
    "travel": (
        "airline",
        "airways",
        "hotel",
        "airbnb",
        "marriott",
        "hilton",
        "delta",
        "united",
        "southwest",
    ),
    "utilities": (
        "electric",
        "water",
        "comcast",
        "verizon",
        "at&t",
        "t-mobile",
        "pg&e",
    ),
}


def clean_merchant(raw: str) -> str:
    """'SAFEWAY #1234' -> 'Safeway'. Store numbers and card noise go."""
    name = re.sub(
        r"\s*(#|store\s*#?|no\.?)\s*\d+.*$", "", (raw or "").strip(), flags=re.I
    )
    # Trailing store or terminal numbers without a "#": "Shell Oil 5733".
    name = re.sub(r"(\s+\d{3,})+\s*$", "", name)
    name = re.sub(r"\s{2,}", " ", name).strip(" -*")
    if name.isupper() and len(name) > 3:
        name = name.title()
    return name[:255] or "Apple Pay purchase"


def guess_category(db: Session, user_id: str, merchant: str) -> str:
    """The category this person used last time at this store, else a guess."""
    previous = (
        db.query(Receipt.category)
        .filter(
            Receipt.user_id == user_id,
            Receipt.deleted_at.is_(None),
            func.lower(Receipt.merchant) == merchant.lower(),
            Receipt.category.isnot(None),
        )
        .order_by(Receipt.created_at.desc())
        .first()
    )
    if previous and previous[0]:
        return previous[0]
    lowered = f" {merchant.lower()} "
    for category, words in _WORDS.items():
        if any(w in lowered for w in words):
            return category
    return "other"


def home_currency(db: Session, user_id: str) -> str:
    row = (
        db.query(Receipt.currency)
        .filter(Receipt.user_id == user_id, Receipt.deleted_at.is_(None))
        .order_by(Receipt.created_at.desc())
        .first()
    )
    return (row[0] if row and row[0] else "USD").upper()


def recent_same_tap(
    db: Session, user_id: str, merchant: str, total: float, now: datetime
) -> Optional[Receipt]:
    return (
        db.query(Receipt)
        .filter(
            Receipt.user_id == user_id,
            Receipt.source == "tap",
            Receipt.deleted_at.is_(None),
            func.lower(Receipt.merchant) == merchant.lower(),
            Receipt.total == total,
            Receipt.created_at >= now - DOUBLE_FIRE_WINDOW,
        )
        .first()
    )


# --- matching a later receipt to its tap -------------------------------------------


def _norm(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())


def same_store(a: str, b: str) -> bool:
    """'Safeway' and 'SAFEWAY #1234' / 'Safeway Inc.' are the same store."""
    na, nb = _norm(clean_merchant(a)), _norm(clean_merchant(b))
    if not na or not nb:
        return False
    if na == nb or (min(len(na), len(nb)) >= 4 and (na in nb or nb in na)):
        return True
    # Short names like "CVS" or "BP": only when one name starts with the other.
    if min(len(na), len(nb)) >= 2 and (na.startswith(nb) or nb.startswith(na)):
        return True
    first_a = re.split(r"\W+", (a or "").lower().strip())[0]
    first_b = re.split(r"\W+", (b or "").lower().strip())[0]
    return len(first_a) >= 4 and first_a == first_b


def _same_order(
    candidates: List[Receipt], merchant: str, when: Optional[datetime]
) -> Optional[Receipt]:
    """The newest candidate from the same store within two days of `when`."""
    anchor = when or datetime.now(timezone.utc)
    if anchor.tzinfo is None:
        anchor = anchor.replace(tzinfo=timezone.utc)
    for receipt in candidates:
        at = receipt.purchased_at
        if at is not None and at.tzinfo is None:
            at = at.replace(tzinfo=timezone.utc)
        if (
            at
            and abs(at - anchor) <= MATCH_WINDOW
            and same_store(receipt.merchant, merchant)
        ):
            return receipt
    return None


def find_tap_match(
    db: Session,
    user_id: str,
    merchant: str,
    total: float,
    when: Optional[datetime],
) -> Optional[Receipt]:
    """An Apple Pay tap still waiting for its receipt: same store, same total
    to the cent, within two days."""
    if not total or total <= 0:
        return None
    candidates = (
        db.query(Receipt)
        .filter(
            Receipt.user_id == user_id,
            Receipt.source == "tap",
            Receipt.deleted_at.is_(None),
            (Receipt.image_key.is_(None)) | (Receipt.image_key == ""),
            func.abs(Receipt.total - total) < 0.005,
        )
        .order_by(Receipt.purchased_at.desc())
        .all()
    )
    return _same_order(candidates, merchant, when)


def find_scanned_match(
    db: Session,
    user_id: str,
    merchant: str,
    total: float,
    when: Optional[datetime],
) -> Optional[Receipt]:
    """A photo, PDF or screenshot of the same order (same store, same total to
    the cent, within two days), so its emailed copy doesn't count twice."""
    if not total or total <= 0:
        return None
    candidates = (
        db.query(Receipt)
        .filter(
            Receipt.user_id == user_id,
            Receipt.source.in_(("photo", "pdf", "screenshot")),
            Receipt.status.in_(("extracted", "reviewed")),
            Receipt.deleted_at.is_(None),
            func.abs(Receipt.total - total) < 0.005,
        )
        .order_by(Receipt.purchased_at.desc())
        .all()
    )
    return _same_order(candidates, merchant, when)
