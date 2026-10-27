"""Populate the local demo account with one believable year of app data."""

from __future__ import annotations

import os
import uuid
from calendar import monthrange
from datetime import datetime, timezone

os.environ.setdefault("DATABASE_URL", "sqlite:///./local_test.db")

from app.db.session import SessionLocal  # noqa: E402
from app.models import (  # noqa: E402
    Budget,
    Purchase,
    Receipt,
    ReceiptLineItem,
    ReceiptSplit,
    SavedView,
    Settlement,
    SplitGroup,
    SplitMember,
    SplitShare,
    TabbyActivity,
    TabbyMemory,
    TabbyRule,
    User,
)

EMAIL = "demo+local@cotab.center"
MARKER = "demo-year-v1"
NS = uuid.UUID("6b3616d8-3065-49ac-a389-3e8b388f42b2")


def uid(name: str) -> str:
    return str(uuid.uuid5(NS, name))


def months_back(count: int) -> list[tuple[int, int]]:
    now = datetime.now(timezone.utc)
    out = []
    year, month = now.year, now.month
    for offset in range(count - 1, -1, -1):
        index = year * 12 + month - 1 - offset
        out.append((index // 12, index % 12 + 1))
    return out


def main() -> None:
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == EMAIL).one()
        if db.query(Receipt).filter(Receipt.user_id == user.id, Receipt.note == MARKER).first():
            print("Demo year already exists; nothing added.")
            return

        user.full_name = "Alex Morgan"
        user.timezone = "America/Los_Angeles"
        user.pay_handles = '{"venmo":"alex-morgan","cashapp":"$alexmorgan"}'
        user.avatar_look = "classic"
        user.avatar_mood = "happy"
        user.avatar_bg = "mood"
        user.tabby_reacts = True

        receipt_rows: list[Receipt] = []
        patterns = [
            ("Whole Foods", "groceries", 92.34, "Organic groceries", "photo"),
            ("Trader Joe's", "groceries", 48.65, "Weekly groceries", "photo"),
            ("Blue Bottle Coffee", "drinks", 6.25, "Oat milk latte", "tap"),
            ("Sweetgreen", "dining", 18.90, "Lunch bowl", "email"),
            ("Lyft", "transport", 22.40, "Ride", "email"),
            ("PG&E", "utilities", 82.10, "Electricity bill", "pdf"),
            ("Target", "shopping", 54.80, "Household supplies", "photo"),
            ("Parkview Apartments", "rent", 1450.00, "Monthly rent", "manual"),
        ]
        for month_index, (year, month) in enumerate(months_back(12)):
            for row_index, (merchant, category, base, item, source) in enumerate(patterns):
                day = min(3 + row_index * 3, monthrange(year, month)[1])
                purchased = datetime(year, month, day, 18, 15, tzinfo=timezone.utc)
                variation = ((month_index * 7 + row_index * 3) % 9 - 4) * 0.73
                total = round(max(2, base + variation), 2)
                purchase_id = uid(f"purchase-{year}-{month}-{row_index}")
                receipt_id = uid(f"receipt-{year}-{month}-{row_index}")
                purchase = Purchase(
                    id=purchase_id,
                    user_id=user.id,
                    merchant=merchant,
                    total=total,
                    category=category,
                    purchased_at=purchased,
                    source=source,
                    created_at=purchased,
                    updated_at=purchased,
                )
                receipt = Receipt(
                    id=receipt_id,
                    user_id=user.id,
                    purchase_id=purchase_id,
                    merchant=merchant,
                    merchant_raw=merchant.upper(),
                    purchased_at=purchased,
                    total=total,
                    subtotal=round(total / 1.0875, 2),
                    tax=round(total - total / 1.0875, 2),
                    category=category,
                    status="reviewed",
                    source=source,
                    note=MARKER,
                    confidence=0.97,
                    extraction_method="ocr" if source in {"photo", "pdf"} else "gemini",
                    created_at=purchased,
                    updated_at=purchased,
                )
                db.add_all([purchase, receipt])
                db.add(
                    ReceiptLineItem(
                        id=uid(f"item-{year}-{month}-{row_index}"),
                        receipt_id=receipt_id,
                        user_id=user.id,
                        description=item,
                        item_name=item,
                        quantity=1,
                        unit_price=round(total / 1.0875, 2),
                        total_price=round(total / 1.0875, 2),
                        created_at=purchased,
                        updated_at=purchased,
                    )
                )
                receipt_rows.append(receipt)

        # Extra current-month moments make Home, Activity and budget states interesting.
        now = datetime.now(timezone.utc)
        extras = [
            ("Nopa", "dining", 126.48, "Dinner for three", "photo", 4),
            ("Total Wine", "bars", 68.72, "Wine and beer", "manual", 7),
            ("AMC Theatres", "entertainment", 41.98, "Movie tickets", "email", 10),
            ("Costco", "groceries", 187.36, "Household stock-up", "photo", 13),
            ("Walgreens", "health", 28.44, "Pharmacy", "tap", 16),
        ]
        for index, (merchant, category, total, item, source, day) in enumerate(extras):
            purchased = datetime(now.year, now.month, min(day, now.day), 19, tzinfo=timezone.utc)
            purchase_id, receipt_id = uid(f"extra-p-{index}"), uid(f"extra-r-{index}")
            db.add(
                Purchase(id=purchase_id, user_id=user.id, merchant=merchant, total=total,
                         category=category, purchased_at=purchased, source=source,
                         created_at=purchased, updated_at=purchased)
            )
            receipt = Receipt(
                id=receipt_id, user_id=user.id, purchase_id=purchase_id, merchant=merchant,
                merchant_raw=merchant.upper(), purchased_at=purchased, total=total,
                subtotal=round(total / 1.0875, 2), tax=round(total - total / 1.0875, 2),
                category=category, status="reviewed", source=source, note=MARKER,
                confidence=0.96, created_at=purchased, updated_at=purchased,
            )
            db.add(receipt)
            db.add(ReceiptLineItem(id=uid(f"extra-i-{index}"), receipt_id=receipt_id,
                                   user_id=user.id, description=item, item_name=item,
                                   quantity=1, unit_price=receipt.subtotal,
                                   total_price=receipt.subtotal, created_at=purchased,
                                   updated_at=purchased))
            receipt_rows.append(receipt)

        for level, target, amount in [
            ("total", "", 2400),
            ("category", "groceries", 500),
            ("category", "dining", 220),
            ("category", "drinks", 45),
            ("category", "bars", 60),
        ]:
            db.add(Budget(id=uid(f"budget-{level}-{target}"), user_id=user.id,
                          level=level, target=target, period="monthly", amount=amount))

        groups = [
            ("Roommates", ["Alex", "Maya", "Ben"]),
            ("You & Priya", ["Alex", "Priya"]),
            ("Weekend Crew", ["Alex", "Jordan", "Sam"]),
        ]
        group_members: dict[str, list[SplitMember]] = {}
        for group_index, (name, names) in enumerate(groups):
            group = SplitGroup(id=uid(f"group-{group_index}"), owner_id=user.id,
                               name=name, share_code=uid(f"share-{group_index}"),
                               kind="group" if len(names) > 2 else "direct")
            db.add(group)
            members = []
            for member_index, person in enumerate(names):
                member = SplitMember(
                    id=uid(f"member-{group_index}-{member_index}"), group_id=group.id,
                    name=person, user_id=user.id if member_index == 0 else None,
                    email=None if member_index == 0 else f"{person.lower()}@example.com",
                    pay_handles=None if member_index == 0 else '{"venmo":"demo-friend"}',
                )
                db.add(member)
                members.append(member)
            group_members[group.id] = members

        db.flush()
        split_receipts = receipt_rows[-5:] + receipt_rows[-18:-12]
        for index, receipt in enumerate(split_receipts):
            group_id = uid(f"group-{index % 3}")
            members = group_members[group_id]
            payer = members[0] if index != 3 else members[1]
            split = ReceiptSplit(id=uid(f"split-{index}"), group_id=group_id,
                                 receipt_id=receipt.id, paid_by_member_id=payer.id,
                                 mode="even", tax_mode="pro_rata",
                                 created_at=receipt.purchased_at,
                                 updated_at=receipt.purchased_at)
            db.add(split)
            share = round(receipt.total / len(members), 2)
            for member in members:
                if member.id != payer.id:
                    db.add(SplitShare(id=uid(f"share-row-{index}-{member.id}"),
                                      split_id=split.id, member_id=member.id,
                                      amount=share, settled=index in {1, 5},
                                      created_at=receipt.purchased_at,
                                      updated_at=receipt.purchased_at))

        roommate_members = group_members[uid("group-0")]
        db.add(Settlement(id=uid("settlement-roommate"), group_id=uid("group-0"),
                          from_member_id=roommate_members[1].id,
                          to_member_id=roommate_members[0].id, amount=45,
                          currency="USD", method="venmo", recorded_by=user.id,
                          created_at=now, updated_at=now))

        db.add_all([
            SavedView(id=uid("view-coffee"), user_id=user.id, name="Coffee runs",
                      filters='{"category":"drinks"}'),
            SavedView(id=uid("view-shared"), user_id=user.id, name="Shared this month",
                      filters='{"scope":"shared","period":"month"}'),
            TabbyRule(id=uid("rule-lyft"), user_id=user.id,
                      summary="Put every Lyft receipt in Transport.", store="Lyft",
                      action="categorize", params='{"category":"transport"}',
                      run_count=11, last_run_at=now),
            TabbyRule(id=uid("rule-costco"), user_id=user.id,
                      summary="Split Costco with Roommates.", store="Costco",
                      action="split", params='{"group":"Roommates"}',
                      run_count=3, last_run_at=now),
            TabbyMemory(id=uid("memory-maya"), user_id=user.id, kind="person",
                        text="Maya is my roommate."),
            TabbyMemory(id=uid("memory-coffee"), user_id=user.id, kind="habit",
                        text="Coffee purchases belong in Drinks."),
            TabbyActivity(id=uid("activity-budget"), user_id=user.id,
                          run_id=uid("activity-run-1"), action="set_budget",
                          summary="Set the monthly dining budget to $220.",
                          open_path="/app/budgets", source="chat", created_at=now,
                          updated_at=now),
            TabbyActivity(id=uid("activity-rule"), user_id=user.id,
                          run_id=uid("activity-run-2"), action="create_rule",
                          summary="Lyft receipts now go to Transport.",
                          open_path="/app/tabby?tab=rules", source="chat",
                          created_at=now, updated_at=now),
        ])

        db.commit()
        count = db.query(Receipt).filter(Receipt.user_id == user.id, Receipt.deleted_at.is_(None)).count()
        print(f"Seeded {count} receipts, 5 budgets, 3 tabs and Tabby history for {EMAIL}.")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
