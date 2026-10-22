"""Price memory: what you paid for each thing, and when that changes.

Every receipt line gets an `item_key` that identifies the same product the
next time it shows up:

* the code printed on the line (a barcode number, or a store's own item
  number like Costco's 1778788) when there is one: "c:1778788";
* otherwise the line's text, tidied up: "d:org ataulfo".

Comparisons are only ever made between lines with the same key at the same
store (Level 1). That needs no pack size: the same Costco item number is the
same product every time. Sizes are parsed when the receipt prints them
("40PK", "18CT", "2 LB") so cross-store comparisons can come later without
guessing.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from statistics import median
from typing import Any, Dict, Iterable, List, Optional, Tuple

from sqlalchemy.orm import Session

from app.models import Receipt, ReceiptLineItem

# --- reading a line -------------------------------------------------------

_CODE = re.compile(r"^\d{4,14}$")
_UNITS = {
    "ct": "ct",
    "count": "ct",
    "pk": "ct",
    "pack": "ct",
    "pc": "ct",
    "pcs": "ct",
    "pac": "ct",
    "dz": "dz",
    "doz": "dz",
    "oz": "oz",
    "floz": "oz",
    "lb": "lb",
    "lbs": "lb",
    "g": "g",
    "kg": "kg",
    "ml": "ml",
    "l": "l",
    "ltr": "l",
    "gal": "gal",
}
_UNIT_WORDS = "|".join(sorted(_UNITS, key=len, reverse=True))
# "40PK", "18 CT", "1.5LB", "32 FL OZ", "1 DZ"
_SIZE_AFTER = re.compile(rf"(\d+(?:\.\d+)?)\s*(fl\s*oz|{_UNIT_WORDS})\b", re.I)
# "PAC152", "PK 40" (Costco-style: the count after the word)
_SIZE_BEFORE = re.compile(r"\b(?:[a-z]*?)(pac|pk|ct)\s?(\d{2,4})\b", re.I)


def clean_code(value: Any) -> Optional[str]:
    """A product code as printed on the line, digits only, or None.

    Anything that isn't 4–14 digits is dropped: that keeps out member numbers
    and card digits that a reader might mistake for a code."""
    if value is None:
        return None
    digits = re.sub(r"\D", "", str(value))
    return digits if _CODE.match(digits) else None


def parse_size(*texts: Optional[str]) -> Tuple[Optional[float], Optional[str]]:
    """Pack size or weight from the first text that states one.

    Returns (quantity, unit) with unit one of ct, oz, lb, g, kg, ml, l, gal.
    A dozen counts as 12 ct."""
    for text in texts:
        if not text:
            continue
        found = _SIZE_AFTER.search(text)
        if found:
            qty = float(found.group(1))
            unit = _UNITS.get(re.sub(r"\s", "", found.group(2).lower()), "oz")
            if unit == "dz":
                return qty * 12, "ct"
            if qty > 0:
                return qty, unit
        found = _SIZE_BEFORE.search(text)
        if found:
            return float(found.group(2)), "ct"
    return None, None


def normalize(text: str) -> str:
    """Lowercase letters and digits, single spaces: '***KSWTR40PK' -> 'kswtr40pk'."""
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", (text or "").lower())).strip()


def item_key(code: Optional[str], description: str) -> Optional[str]:
    if code:
        return f"c:{code}"
    words = normalize(description)
    return f"d:{words}"[:160] if words else None


def store_key(merchant: Optional[str]) -> str:
    """'Costco Wholesale #1694' and 'COSTCO' are the same store for prices."""
    words = normalize(merchant or "")
    words = re.sub(r"\b(store|wholesale|supercenter|inc|llc|the|no)\b", " ", words)
    words = re.sub(r"\b\d+\b", " ", words)
    return re.sub(r"\s+", "", words)


def line_fields(
    description: str,
    item_code: Any = None,
    item_name: Optional[str] = None,
    size: Optional[str] = None,
) -> Dict[str, Any]:
    """Columns to store with a receipt line, beyond what was printed."""
    code = clean_code(item_code)
    qty, unit = parse_size(size, description, item_name)
    name = (item_name or "").strip()[:255] or None
    return {
        "item_code": code,
        "item_name": name,
        "size_qty": qty,
        "size_unit": unit,
        "item_key": item_key(code, description or name or ""),
    }


def make_line(receipt_id: str, user_id: str, li: Any) -> ReceiptLineItem:
    """A ReceiptLineItem from an extracted or corrected line."""
    return ReceiptLineItem(
        receipt_id=receipt_id,
        user_id=user_id,
        description=li.description,
        quantity=li.quantity,
        unit_price=li.unit_price,
        total_price=li.total_price,
        **line_fields(
            li.description,
            getattr(li, "item_code", None),
            getattr(li, "item_name", None),
            getattr(li, "size", None),
        ),
    )


# --- comparing ------------------------------------------------------------


def _aware(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _when(receipt: Receipt) -> datetime:
    return (
        _aware(receipt.purchased_at)
        or _aware(receipt.created_at)
        or datetime.now(timezone.utc)
    )


def _bought(lines: Iterable[ReceiptLineItem]) -> Dict[str, Dict[str, Any]]:
    """One entry per item on a receipt: what one of it cost after discounts.

    Repeated lines (three cases of water) are added up; a negative line that
    names an item's code ("/1778788 1.00-") comes off that item's price."""
    items: Dict[str, Dict[str, Any]] = {}
    discounts: Dict[str, float] = {}
    order: List[str] = []
    for line in lines:
        total = float(line.total_price or 0)
        if total < 0:
            code = clean_code(line.item_code) or clean_code(
                re.sub(r"[^\d ]", " ", line.description or "").strip().split(" ")[0]
                if line.description
                else None
            )
            if code:
                discounts[f"c:{code}"] = discounts.get(f"c:{code}", 0) + total
            continue
        if not line.item_key or total == 0:
            continue
        qty = float(line.quantity or 1) or 1
        entry = items.get(line.item_key)
        if not entry:
            entry = {
                "key": line.item_key,
                "line_ids": [],
                "lines": 0,
                "quantity": 0.0,
                "spent": 0.0,
                "name": line.item_name or line.description,
                "description": line.description,
                "code": line.item_code,
                "size_qty": line.size_qty,
                "size_unit": line.size_unit,
            }
            items[line.item_key] = entry
            order.append(line.item_key)
        entry["line_ids"].append(line.id)
        entry["lines"] += 1
        entry["quantity"] += qty
        entry["spent"] += total
    for key, off in discounts.items():
        if key in items:
            items[key]["spent"] += off
            items[key]["discounted"] = True
    for entry in items.values():
        entry["price"] = round(entry["spent"] / entry["quantity"], 2)
    return {key: items[key] for key in order}


def _history(
    db: Session, receipt: Receipt, keys: List[str]
) -> Dict[str, List[Dict[str, Any]]]:
    """Earlier purchases of these items at this store, oldest first."""
    if not keys:
        return {}
    store = store_key(receipt.merchant)
    here = _when(receipt)
    rows = (
        db.query(ReceiptLineItem, Receipt)
        .join(Receipt, Receipt.id == ReceiptLineItem.receipt_id)
        .filter(
            ReceiptLineItem.user_id == receipt.user_id,
            Receipt.user_id == receipt.user_id,
            ReceiptLineItem.deleted_at.is_(None),
            Receipt.deleted_at.is_(None),
            Receipt.id != receipt.id,
            Receipt.status.in_(["extracted", "reviewed"]),
            ReceiptLineItem.item_key.in_(keys),
        )
        .all()
    )
    by_receipt: Dict[str, Tuple[Receipt, List[ReceiptLineItem]]] = {}
    for line, other in rows:
        if store_key(other.merchant) != store or _when(other) > here:
            continue
        by_receipt.setdefault(other.id, (other, []))[1].append(line)
    # Discount lines carry no item key, so fetch them for these receipts too.
    if by_receipt:
        extra = (
            db.query(ReceiptLineItem)
            .filter(
                ReceiptLineItem.receipt_id.in_(list(by_receipt)),
                ReceiptLineItem.deleted_at.is_(None),
                ReceiptLineItem.total_price < 0,
            )
            .all()
        )
        for line in extra:
            by_receipt[line.receipt_id][1].append(line)
    history: Dict[str, List[Dict[str, Any]]] = {}
    for other, lines in by_receipt.values():
        for key, entry in _bought(lines).items():
            if key not in keys:
                continue
            history.setdefault(key, []).append(
                {
                    "receipt_id": other.id,
                    "date": _when(other).date().isoformat(),
                    "price": entry["price"],
                    "quantity": entry["quantity"],
                    "lines": entry["lines"],
                }
            )
    for points in history.values():
        points.sort(key=lambda p: p["date"])
    return history


def _money(value: float, currency: str) -> str:
    sign = "-" if value < 0 else ""
    symbol = "$" if currency in ("USD", "CAD", "AUD") else f"{currency} "
    return f"{sign}{symbol}{abs(value):,.2f}"


def _short_date(iso: str) -> str:
    day = datetime.fromisoformat(iso)
    return f"{day:%b} {day.day}"


# Worth a word only past both thresholds: never fuss over a few cents.
CHANGE_PCT = 0.03
CHANGE_MIN = 0.10
CHECK_PCT = 0.15
CHECK_MIN = 0.50


def _verdict(entry: Dict[str, Any], points: List[Dict[str, Any]]) -> Dict[str, Any]:
    price = entry["price"]
    if not points:
        return {"status": "first"}
    prices = [p["price"] for p in points]
    last = points[-1]
    usual = round(median(prices), 2)
    out: Dict[str, Any] = {
        "last_price": last["price"],
        "last_date": last["date"],
        "usual_price": usual,
        "lowest_price": min(prices),
        "times": len(points),
        "change": round(price - last["price"], 2),
    }
    over_usual = price - usual
    if (
        len(points) >= 2
        and over_usual >= CHECK_MIN
        and over_usual >= usual * CHECK_PCT
        and not entry.get("discounted")
    ):
        out["status"] = "check"
    elif abs(out["change"]) < max(CHANGE_MIN, last["price"] * CHANGE_PCT):
        out["status"] = "same"
    else:
        out["status"] = "up" if out["change"] > 0 else "down"
    # More of it than you ever bought before. Only a note, never an alarm:
    # a receipt can't tell a deliberate extra case of water from a double scan.
    most = max(p["quantity"] for p in points)
    if len(points) >= 2 and entry["quantity"] > most:
        out["more_than_usual"] = True
        out["usual_quantity"] = most
    return out


def _headline(items: List[Dict[str, Any]], currency: str) -> Dict[str, str]:
    """Tabby's one sentence about this receipt, and his face while saying it."""
    seen = [i for i in items if i["status"] != "first"]
    check = [i for i in items if i["status"] == "check"]
    if check:
        top = max(check, key=lambda i: i["price"] - i["usual_price"])
        return {
            "mood": "bill-shock",
            "text": f"{top['name']} usually rings up {_money(top['usual_price'], currency)} "
            f"here. Today it's {_money(top['price'], currency)}. Worth checking the shelf price.",
        }
    ups = [i for i in items if i["status"] == "up"]
    downs = [i for i in items if i["status"] == "down"]
    if ups:
        top = max(ups, key=lambda i: i["change"])
        more = (
            f" {len(ups) - 1} other thing{'s' if len(ups) > 2 else ''} went up too."
            if len(ups) > 1
            else ""
        )
        return {
            "mood": "hmm",
            "text": f"{top['name']} went up {_money(top['change'], currency)} since "
            f"{_short_date(top['last_date'])}: {_money(top['last_price'], currency)} then, "
            f"{_money(top['price'], currency)} now.{more}",
        }
    if downs:
        top = min(downs, key=lambda i: i["change"])
        return {
            "mood": "cool",
            "text": f"Nice. {top['name']} was {_money(-top['change'], currency)} cheaper "
            f"than on {_short_date(top['last_date'])}.",
        }
    if seen:
        return {
            "mood": "cool",
            "text": f"Same prices as last time on {len(seen)} "
            f"item{'s' if len(seen) != 1 else ''}. Nothing to worry about.",
        }
    if items:
        return {
            "mood": "hi",
            "text": "First time I've seen these here. I'll remember the prices for next time.",
        }
    return {"mood": "hi", "text": ""}


def for_receipt(db: Session, receipt: Receipt) -> Dict[str, Any]:
    """Every item on a receipt next to what you paid for it before, here."""
    lines = [
        line
        for line in (receipt.line_items or [])
        if getattr(line, "deleted_at", None) is None
    ]
    bought = _bought(lines)
    history = _history(db, receipt, list(bought))
    currency = receipt.currency or "USD"
    items = []
    for key, entry in bought.items():
        points = history.get(key, [])
        verdict = _verdict(entry, points)
        items.append(
            {
                "key": key,
                "line_ids": entry["line_ids"],
                "name": entry["name"],
                "code": entry["code"],
                "size_qty": entry["size_qty"],
                "size_unit": entry["size_unit"],
                "quantity": entry["quantity"],
                "lines": entry["lines"],
                "price": entry["price"],
                "discounted": bool(entry.get("discounted")),
                "history": points[-6:],
                **verdict,
            }
        )
    compared = [i for i in items if i["status"] != "first"]
    change = round(sum(i["change"] * i["quantity"] for i in compared), 2)
    return {
        "receipt_id": receipt.id,
        "store": receipt.merchant,
        "currency": currency,
        "compared": len(compared),
        "trip_change": change if compared else None,
        "tabby": _headline(items, currency),
        "items": items,
    }


def watch(db: Session, user_id: str, since: datetime) -> List[Dict[str, Any]]:
    """Items bought at least three times since `since` whose latest price at
    a store is clearly above the first one: the slow creep nobody notices."""
    rows = (
        db.query(ReceiptLineItem, Receipt)
        .join(Receipt, Receipt.id == ReceiptLineItem.receipt_id)
        .filter(
            ReceiptLineItem.user_id == user_id,
            Receipt.user_id == user_id,
            ReceiptLineItem.deleted_at.is_(None),
            Receipt.deleted_at.is_(None),
            Receipt.status.in_(["extracted", "reviewed"]),
            Receipt.purchased_at >= since,
            ReceiptLineItem.item_key.isnot(None),
            ReceiptLineItem.total_price > 0,
        )
        .all()
    )
    series: Dict[Tuple[str, str], List[Tuple[datetime, float, str, str]]] = {}
    for line, receipt in rows:
        qty = float(line.quantity or 1) or 1
        series.setdefault((store_key(receipt.merchant), line.item_key), []).append(
            (
                _when(receipt),
                float(line.total_price) / qty,
                line.item_name or line.description,
                receipt.merchant,
            )
        )
    risen = []
    for (_, key), points in series.items():
        if len({p[0].date() for p in points}) < 3:
            continue
        points.sort(key=lambda p: p[0])
        first, last = points[0][1], points[-1][1]
        if last - first >= max(0.30, first * 0.10):
            risen.append(
                {
                    "key": key,
                    "name": points[-1][2],
                    "store": points[-1][3],
                    "from": round(first, 2),
                    "to": round(last, 2),
                    "since": points[0][0].date().isoformat(),
                }
            )
    risen.sort(key=lambda r: r["to"] - r["from"], reverse=True)
    return risen
