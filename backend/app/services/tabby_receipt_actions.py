"""Receipts Tabby can change: fix details, fix an item, move to a category,
delete, and mark as checked. Plus one lookup: receipts that need checking."""

from __future__ import annotations

from datetime import date, datetime, time, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.models import Receipt, ReceiptLineItem, ReceiptSplit, SplitGroup
from app.services import split_service, tabby_agent
from app.services.categories import CANONICAL_CATEGORIES, _normalize_category
from app.services.purchase_service import sync_from_receipt
from app.services.tabby_agent import Action, ask, err, ok


def _money(value: Optional[float], currency: str = "USD") -> str:
    value = value or 0
    return f"${value:,.2f}" if currency == "USD" else f"{value:,.2f} {currency}"


def label(receipt: Receipt) -> str:
    when = receipt.purchased_at
    day = f"{when:%b} {when.day}" if when else "no date"
    return f"{receipt.merchant or 'Receipt'}, {day} ({_money(receipt.total, receipt.currency or 'USD')})"


def _receipt(db: Session, user_id: str, receipt_id: Optional[str]) -> Optional[Receipt]:
    if not receipt_id:
        return None
    return (
        db.query(Receipt)
        .filter(
            Receipt.id == receipt_id,
            Receipt.user_id == user_id,
            Receipt.deleted_at.is_(None),
        )
        .first()
    )


def _not_found() -> Dict[str, Any]:
    return err("That receipt wasn't found. Use find_purchases to get the right one.")


def _number(value: Any) -> Optional[float]:
    if value in (None, ""):
        return None
    try:
        return round(float(str(value).replace("$", "").replace(",", "")), 2)
    except ValueError:
        return float("nan")


def _iso(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value else None


def _from_iso(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    parsed = datetime.fromisoformat(value)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _category(raw: Any) -> Dict[str, Any]:
    cat = _normalize_category(str(raw or ""))
    if not cat:
        return ask(
            f"'{raw}' isn't a category. Ask which one fits.",
            options=list(CANONICAL_CATEGORIES)[:4],
        )
    return ok(cat)


# --- needs checking (lookup) -------------------------------------------------


def receipts_to_check(db: Session, user_id: str, limit: int = 10) -> Dict[str, Any]:
    """Receipts Cotab read but nobody has checked yet, least sure first, with
    what looks off on each."""
    rows = (
        db.query(Receipt)
        .filter(
            Receipt.user_id == user_id,
            Receipt.deleted_at.is_(None),
            Receipt.status == "extracted",
        )
        .order_by(Receipt.confidence.asc())
        .limit(max(1, min(int(limit or 10), 25)))
        .all()
    )
    failed = (
        db.query(Receipt)
        .filter(
            Receipt.user_id == user_id,
            Receipt.deleted_at.is_(None),
            Receipt.status == "failed",
        )
        .count()
    )
    out = []
    for r in rows:
        lines = [li for li in r.line_items if li.deleted_at is None]
        items_total = round(sum(li.total_price or 0 for li in lines), 2)
        issues = []
        if not r.purchased_at:
            issues.append("no date")
        if not (r.merchant or "").strip():
            issues.append("no store name")
        expected = round((r.subtotal or items_total) + (r.tax or 0), 2)
        if lines and abs(expected - (r.total or 0)) > 0.05:
            issues.append(
                f"items and tax add up to {_money(expected)}, total says {_money(r.total)}"
            )
        if (r.confidence or 0) < 0.7:
            issues.append("hard to read")
        out.append(
            {
                "receipt_id": r.id,
                "label": label(r),
                "category": r.category,
                "issues": issues,
            }
        )
    return ok({"count": len(out), "receipts": out, "failed_scans": failed})


# --- edit_receipt --------------------------------------------------------------

FIELDS = ("merchant", "purchased_at", "total", "tax", "category")


def prepare_edit(db: Session, user_id: str, args: Dict[str, Any], plan) -> Dict:
    receipt = _receipt(db, user_id, args.get("receipt_id"))
    if not receipt:
        return _not_found()
    currency = receipt.currency or "USD"
    changes: Dict[str, Any] = {}
    said: List[str] = []
    store = (args.get("store") or "").strip()
    if store and store != receipt.merchant:
        changes["merchant"] = store[:255]
        said.append(f"store to {store}")
    if args.get("date"):
        try:
            day = date.fromisoformat(str(args["date"])[:10])
        except ValueError:
            return ask("Ask for the date again (like Oct 22).")
        at = receipt.purchased_at.timetz() if receipt.purchased_at else time(12, 0)
        when = datetime.combine(day, at)
        when = when if when.tzinfo else when.replace(tzinfo=timezone.utc)
        changes["purchased_at"] = when.isoformat()
        said.append(f"date to {day:%b} {day.day}")
    for key, word in (("total", "total"), ("tax", "tax")):
        value = _number(args.get(key))
        if value is None:
            continue
        if value != value or value < 0 or (key == "total" and value == 0):
            return ask(f"Ask for the {word} again; '{args.get(key)}' isn't an amount.")
        changes[key] = value
        said.append(f"{word} to {_money(value, currency)}")
    if args.get("category"):
        cat = _category(args["category"])
        if cat["status"] != "ok":
            return cat
        if cat["data"] != receipt.category:
            changes["category"] = cat["data"]
            said.append(f"category to {cat['data']}")
    if not changes:
        return ask("Nothing would change. Ask what they want changed on it.")
    summary = f"Change {label(receipt)}: {', '.join(said)}."
    return ok(
        {"summary": summary, "step": {"receipt_id": receipt.id, "changes": changes}}
    )


def _apply(receipt: Receipt, values: Dict[str, Any]) -> None:
    for key, value in values.items():
        if key not in FIELDS:
            continue
        setattr(receipt, key, _from_iso(value) if key == "purchased_at" else value)


def edit_receipt(
    db: Session, user_id: str, receipt_id: str, changes: Dict[str, Any]
) -> Dict[str, Any]:
    receipt = _receipt(db, user_id, receipt_id)
    if not receipt:
        return err("That receipt is gone.")
    before = {
        key: (
            _iso(getattr(receipt, key))
            if key == "purchased_at"
            else getattr(receipt, key)
        )
        for key in changes
        if key in FIELDS
    }
    _apply(receipt, changes)
    sync_from_receipt(db, receipt)
    db.commit()
    return ok(
        {
            "open": f"/app/receipts/{receipt.id}",
            "undo": {"receipt_id": receipt.id, "before": before},
        }
    )


def undo_edit(db: Session, user_id: str, receipt_id: str, before: Dict) -> Dict:
    receipt = _receipt(db, user_id, receipt_id)
    if not receipt:
        return err("That receipt is gone.")
    _apply(receipt, before)
    sync_from_receipt(db, receipt)
    db.commit()
    return ok({})


# --- edit_item -----------------------------------------------------------------

ITEM_FIELDS = ("item_name", "quantity", "unit_price", "total_price")


def prepare_edit_item(db: Session, user_id: str, args: Dict[str, Any], plan) -> Dict:
    receipt = _receipt(db, user_id, args.get("receipt_id"))
    if not receipt:
        return _not_found()
    line = next(
        (
            li
            for li in receipt.line_items
            if li.id == args.get("line_id") and li.deleted_at is None
        ),
        None,
    )
    if line is None:
        return err("That item isn't on that receipt. Use get_receipt for its line_ids.")
    currency = receipt.currency or "USD"
    old_name = (line.item_name or line.description or "Item").strip()
    changes: Dict[str, Any] = {}
    said = []
    name = (args.get("name") or "").strip()
    if name and name != old_name:
        changes["item_name"] = name[:255]
        said.append(f"name to {name}")
    qty = _number(args.get("quantity"))
    if qty is not None:
        if qty != qty or qty <= 0:
            return ask("Ask how many again.")
        changes["quantity"] = qty
        said.append(f"quantity to {qty:g}")
    price = _number(args.get("price"))
    if price is not None:
        if price != price or price < 0:
            return ask("Ask for the price again.")
        changes["total_price"] = price
        said.append(f"price to {_money(price, currency)}")
    if not changes:
        return ask("Nothing would change. Ask what to change on that item.")
    total = changes.get("total_price", line.total_price or 0)
    count = changes.get("quantity", line.quantity or 1) or 1
    if "total_price" in changes or "quantity" in changes:
        changes["unit_price"] = round(total / count, 2)
    summary = f"Change {old_name} on {label(receipt)}: {', '.join(said)}."
    return ok(
        {
            "summary": summary,
            "step": {"receipt_id": receipt.id, "line_id": line.id, "changes": changes},
        }
    )


def _line(db: Session, user_id: str, line_id: str) -> Optional[ReceiptLineItem]:
    line = db.get(ReceiptLineItem, line_id)
    if line is None or line.user_id != user_id or line.deleted_at is not None:
        return None
    return line


def edit_item(
    db: Session, user_id: str, receipt_id: str, line_id: str, changes: Dict
) -> Dict:
    line = _line(db, user_id, line_id)
    if line is None:
        return err("That item is gone.")
    before = {k: getattr(line, k) for k in changes if k in ITEM_FIELDS}
    for key, value in changes.items():
        if key in ITEM_FIELDS:
            setattr(line, key, value)
    db.commit()
    return ok(
        {
            "open": f"/app/receipts/{receipt_id}",
            "undo": {"receipt_id": receipt_id, "line_id": line_id, "before": before},
        }
    )


def undo_edit_item(
    db: Session, user_id: str, receipt_id: str, line_id: str, before: Dict
) -> Dict:
    line = _line(db, user_id, line_id)
    if line is None:
        return err("That item is gone.")
    for key, value in before.items():
        setattr(line, key, value)
    db.commit()
    return ok({})


# --- recategorize -----------------------------------------------------------------


def _owned_many(db: Session, user_id: str, ids: List[str]) -> List[Receipt]:
    if not ids:
        return []
    return (
        db.query(Receipt)
        .filter(
            Receipt.id.in_([str(i) for i in ids]),
            Receipt.user_id == user_id,
            Receipt.deleted_at.is_(None),
        )
        .all()
    )


def prepare_recategorize(db: Session, user_id: str, args: Dict, plan) -> Dict:
    ids = [i for i in (args.get("receipt_ids") or []) if i]
    if not ids:
        return ask("Ask which purchases to move.")
    receipts = _owned_many(db, user_id, ids)
    if len(receipts) != len(set(ids)):
        return _not_found()
    cat = _category(args.get("category"))
    if cat["status"] != "ok":
        return cat
    moving = [r for r in receipts if r.category != cat["data"]]
    if not moving:
        return ask(f"Those are already in {cat['data']}. Tell the person.")
    what = (
        label(moving[0])
        if len(moving) == 1
        else f"{len(moving)} purchases ({', '.join(label(r) for r in moving[:3])}"
        + (", …)" if len(moving) > 3 else ")")
    )
    return ok(
        {
            "summary": f"Move {what} to {cat['data']}.",
            "step": {"receipt_ids": [r.id for r in moving], "category": cat["data"]},
        }
    )


def recategorize(db: Session, user_id: str, receipt_ids: List[str], category: str):
    receipts = _owned_many(db, user_id, receipt_ids)
    before = {r.id: r.category for r in receipts}
    for r in receipts:
        r.category = category
        sync_from_receipt(db, r)
    db.commit()
    open_path = f"/app/receipts/{receipts[0].id}" if len(receipts) == 1 else "/app/tab"
    return ok({"open": open_path, "undo": {"before": before}})


def undo_recategorize(db: Session, user_id: str, before: Dict[str, str]) -> Dict:
    for r in _owned_many(db, user_id, list(before)):
        r.category = before[r.id]
        sync_from_receipt(db, r)
    db.commit()
    return ok({})


# --- delete_receipt ---------------------------------------------------------------


def _live_splits(db: Session, receipt_id: str) -> List[ReceiptSplit]:
    return (
        db.query(ReceiptSplit)
        .filter(
            ReceiptSplit.receipt_id == receipt_id, ReceiptSplit.deleted_at.is_(None)
        )
        .all()
    )


def prepare_delete(db: Session, user_id: str, args: Dict, plan) -> Dict:
    receipt = _receipt(db, user_id, args.get("receipt_id"))
    if not receipt:
        return _not_found()
    splits = _live_splits(db, receipt.id)
    tabs = [db.get(SplitGroup, s.group_id) for s in splits]
    names = [t.name for t in tabs if t is not None]
    summary = f"Delete {label(receipt)}" + (
        f" and take it off {', '.join(names)}." if names else "."
    )
    return ok({"summary": summary, "step": {"receipt_id": receipt.id}})


def delete_receipt(db: Session, user_id: str, receipt_id: str) -> Dict:
    receipt = _receipt(db, user_id, receipt_id)
    if not receipt:
        return err("That receipt is already gone.")
    split_ids = []
    for split in _live_splits(db, receipt.id):
        split_service.remove_split(db, split)
        split_ids.append(split.id)
    receipt.deleted_at = datetime.now(timezone.utc)
    sync_from_receipt(db, receipt)
    db.commit()
    return ok(
        {"open": "/app/tab", "undo": {"receipt_id": receipt.id, "split_ids": split_ids}}
    )


def undo_delete(
    db: Session, user_id: str, receipt_id: str, split_ids: List[str]
) -> Dict:
    receipt = db.get(Receipt, receipt_id)
    if receipt is None or receipt.user_id != user_id:
        return err("That receipt can't be found.")
    receipt.deleted_at = None
    for split_id in split_ids:
        split = db.get(ReceiptSplit, split_id)
        if split is not None:
            split_service.restore_split(db, split)
    sync_from_receipt(db, receipt)
    db.commit()
    return ok({})


# --- mark_checked --------------------------------------------------------------------


def prepare_checked(db: Session, user_id: str, args: Dict, plan) -> Dict:
    ids = [i for i in (args.get("receipt_ids") or []) if i]
    receipts = [r for r in _owned_many(db, user_id, ids) if r.status == "extracted"]
    if not receipts:
        return ask("Nothing there needs checking. Tell the person.")
    what = (
        label(receipts[0])
        if len(receipts) == 1
        else f"{len(receipts)} receipts ({', '.join(label(r) for r in receipts[:3])}"
        + (", …)" if len(receipts) > 3 else ")")
    )
    return ok(
        {
            "summary": f"Mark {what} as checked.",
            "step": {"receipt_ids": [r.id for r in receipts]},
        }
    )


def mark_checked(db: Session, user_id: str, receipt_ids: List[str]) -> Dict:
    receipts = _owned_many(db, user_id, receipt_ids)
    before = {r.id: r.status for r in receipts}
    for r in receipts:
        r.status = "reviewed"
    db.commit()
    return ok({"open": "/app/tab", "undo": {"before": before}})


def undo_checked(db: Session, user_id: str, before: Dict[str, str]) -> Dict:
    for r in _owned_many(db, user_id, list(before)):
        r.status = before[r.id]
    db.commit()
    return ok({})


tabby_agent.register(
    Action(
        "edit_receipt", prepare_edit, edit_receipt, undo_edit, "Fixing that receipt…"
    ),
    Action(
        "edit_item", prepare_edit_item, edit_item, undo_edit_item, "Fixing that item…"
    ),
    Action(
        "recategorize",
        prepare_recategorize,
        recategorize,
        undo_recategorize,
        "Sorting those purchases…",
    ),
    Action(
        "delete_receipt", prepare_delete, delete_receipt, undo_delete, "Checking that…"
    ),
    Action(
        "mark_checked",
        prepare_checked,
        mark_checked,
        undo_checked,
        "Checking those receipts…",
    ),
)
