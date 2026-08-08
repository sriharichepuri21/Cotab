"""Tests for chat_tools — 5-10 assertions per tool.

Uses an in-memory SQLite session and seeds a small fixture set of receipts,
budgets, and (for split) one group. Never touches Gemini — these tests
exercise the tool functions only, which is the deterministic part.
"""

from datetime import datetime, timedelta, timezone
from typing import Tuple

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.db.session import Base
from app.models import Budget, Receipt, ReceiptLineItem, SplitGroup, SplitMember, User
from app.services import chat_tools
from app.services.categories import _normalize_category


@pytest.fixture()
def db_session() -> Session:
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)
    db = TestingSession()
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def user(db_session: Session) -> User:
    u = User(email="t@example.com", hashed_password="x")
    db_session.add(u)
    db_session.commit()
    db_session.refresh(u)
    return u


def _mk_receipt(
    db: Session,
    user_id: str,
    merchant: str,
    total: float,
    category: str,
    days_ago: int = 0,
    status: str = "extracted",
) -> Receipt:
    r = Receipt(
        user_id=user_id,
        merchant=merchant,
        total=total,
        subtotal=total,
        tax=0.0,
        currency="USD",
        category=category,
        status=status,
        purchased_at=datetime.now(timezone.utc) - timedelta(days=days_ago),
    )
    db.add(r)
    db.commit()
    db.refresh(r)
    return r


# ---------------------------------------------------------------------------
# _normalize_category
# ---------------------------------------------------------------------------


def test_normalize_direct_hit():
    assert _normalize_category("groceries") == "groceries"
    assert _normalize_category("DINING") == "dining"


def test_normalize_alias_hits():
    assert _normalize_category("food") == "dining"
    assert _normalize_category("whole foods") == "groceries"
    assert _normalize_category("uber") == "transport"
    assert _normalize_category("starbucks") == "dining"


def test_normalize_substring():
    assert _normalize_category("did I buy at whole foods market?") == "groceries"
    assert _normalize_category("uber eats order") == "dining"  # longer match wins


def test_normalize_unknown():
    assert _normalize_category("xyzzy") is None
    assert _normalize_category("") is None
    assert _normalize_category(None) is None


# ---------------------------------------------------------------------------
# get_spend_summary
# ---------------------------------------------------------------------------


def test_spend_summary_empty(db_session, user):
    out = chat_tools.get_spend_summary(db_session, user.id)
    assert out["status"] == "empty"
    assert "no receipts" in out["hint"].lower()


def test_spend_summary_aggregates(db_session, user):
    _mk_receipt(db_session, user.id, "Trader Joe's", 50.0, "groceries", days_ago=1)
    _mk_receipt(db_session, user.id, "Chipotle",        25.0, "dining",    days_ago=2)
    _mk_receipt(db_session, user.id, "Safeway",         30.0, "groceries", days_ago=3)

    out = chat_tools.get_spend_summary(db_session, user.id)
    assert out["status"] == "ok"
    assert out["data"]["total_spent"] == 105.0
    assert out["data"]["receipt_count"] == 3
    assert out["data"]["category_filter"] is None
    top = {c["category"]: c["amount"] for c in out["data"]["top_categories"]}
    assert top["groceries"] == 80.0
    assert top["dining"] == 25.0


def test_spend_summary_category_filter(db_session, user):
    _mk_receipt(db_session, user.id, "Trader Joe's", 50.0, "groceries")
    _mk_receipt(db_session, user.id, "Chipotle",     25.0, "dining")

    out = chat_tools.get_spend_summary(db_session, user.id, category="food")
    # Alias "food" must normalize to "dining"
    assert out["status"] == "ok"
    assert out["data"]["category_filter"] == "dining"
    assert out["data"]["total_spent"] == 25.0


def test_spend_summary_bad_category(db_session, user):
    _mk_receipt(db_session, user.id, "Trader Joe's", 50.0, "groceries")
    out = chat_tools.get_spend_summary(db_session, user.id, category="xyzzy")
    assert out["status"] == "error"
    assert "xyzzy" in out["hint"]


def test_spend_summary_excludes_failed(db_session, user):
    _mk_receipt(db_session, user.id, "Bad", 99.0, "other", status="failed")
    out = chat_tools.get_spend_summary(db_session, user.id)
    assert out["status"] == "empty"


def test_spend_summary_user_isolation(db_session, user):
    other = User(email="other@example.com", hashed_password="x")
    db_session.add(other)
    db_session.commit()
    _mk_receipt(db_session, other.id, "Other's store", 500.0, "groceries")
    out = chat_tools.get_spend_summary(db_session, user.id)
    # Must NOT see the other user's receipt
    assert out["status"] == "empty"


# ---------------------------------------------------------------------------
# get_budget_status
# ---------------------------------------------------------------------------


def test_budget_status_no_budget(db_session, user):
    out = chat_tools.get_budget_status(db_session, user.id, category="groceries")
    assert out["status"] == "empty"
    assert "no budget" in out["hint"].lower()


def test_budget_status_over_under(db_session, user):
    db_session.add(Budget(user_id=user.id, category="groceries", monthly_limit=100.0))
    _mk_receipt(db_session, user.id, "Grocer", 60.0, "groceries")
    db_session.commit()

    out = chat_tools.get_budget_status(db_session, user.id, category="food", month=None)
    # "food" is the dining alias — should NOT match groceries budget
    assert out["status"] == "empty"

    out = chat_tools.get_budget_status(db_session, user.id, category="groceries")
    assert out["status"] == "ok"
    assert out["data"]["budget_limit"] == 100.0
    assert out["data"]["spent"] == 60.0
    assert out["data"]["percent_used"] == 60.0
    assert out["data"]["over_budget"] is False


def test_budget_status_over_budget_true(db_session, user):
    db_session.add(Budget(user_id=user.id, category="dining", monthly_limit=20.0))
    _mk_receipt(db_session, user.id, "Fancy place", 50.0, "dining")
    db_session.commit()

    out = chat_tools.get_budget_status(db_session, user.id, category="food")
    assert out["status"] == "ok"
    assert out["data"]["over_budget"] is True
    assert out["data"]["spent"] == 50.0


def test_budget_status_bad_category(db_session, user):
    out = chat_tools.get_budget_status(db_session, user.id, category="xyzzy")
    assert out["status"] == "error"


# ---------------------------------------------------------------------------
# list_receipts
# ---------------------------------------------------------------------------


def test_list_receipts_empty(db_session, user):
    out = chat_tools.list_receipts(db_session, user.id)
    assert out["status"] == "empty"


def test_list_receipts_returns_recent_first(db_session, user):
    _mk_receipt(db_session, user.id, "Old", 10.0, "other", days_ago=10)
    _mk_receipt(db_session, user.id, "New", 20.0, "other", days_ago=0)
    out = chat_tools.list_receipts(db_session, user.id, limit=5)
    assert out["status"] == "ok"
    assert out["data"]["count"] == 2
    assert out["data"]["receipts"][0]["merchant"] == "New"
    assert out["data"]["receipts"][1]["merchant"] == "Old"


def test_list_receipts_merchant_filter(db_session, user):
    _mk_receipt(db_session, user.id, "Trader Joe's", 30.0, "groceries")
    _mk_receipt(db_session, user.id, "Safeway",      40.0, "groceries")
    out = chat_tools.list_receipts(db_session, user.id, merchant="trader")
    assert out["data"]["count"] == 1
    assert out["data"]["receipts"][0]["merchant"] == "Trader Joe's"


def test_list_receipts_limit_clamped(db_session, user):
    for i in range(60):
        _mk_receipt(db_session, user.id, f"M{i}", 1.0, "other")
    out = chat_tools.list_receipts(db_session, user.id, limit=999)
    # Capped at 50
    assert out["data"]["count"] == 50


# ---------------------------------------------------------------------------
# find_receipts
# ---------------------------------------------------------------------------


def test_find_receipts_by_merchant(db_session, user):
    _mk_receipt(db_session, user.id, "Trader Joe's", 30.0, "groceries")
    out = chat_tools.find_receipts(db_session, user.id, "trader")
    assert out["status"] == "ok"
    assert out["data"]["count"] == 1


def test_find_receipts_by_line_item(db_session, user):
    r = _mk_receipt(db_session, user.id, "Generic store", 12.0, "groceries")
    db_session.add(
        ReceiptLineItem(
            receipt_id=r.id,
            user_id=user.id,
            description="Organic quinoa",
            quantity=1,
            unit_price=12.0,
            total_price=12.0,
        )
    )
    db_session.commit()
    out = chat_tools.find_receipts(db_session, user.id, "quinoa")
    assert out["status"] == "ok"
    assert out["data"]["count"] == 1
    assert out["data"]["receipts"][0]["id"] == r.id


def test_find_receipts_empty_term(db_session, user):
    out = chat_tools.find_receipts(db_session, user.id, "")
    assert out["status"] == "error"


def test_find_receipts_no_match(db_session, user):
    _mk_receipt(db_session, user.id, "Some place", 5.0, "other")
    out = chat_tools.find_receipts(db_session, user.id, "nope-not-there")
    assert out["status"] == "empty"


# ---------------------------------------------------------------------------
# create_split
# ---------------------------------------------------------------------------


def test_create_split_even(db_session, user):
    r = _mk_receipt(db_session, user.id, "Whole Foods", 100.0, "groceries")
    out = chat_tools.create_split(
        db_session,
        user.id,
        receipt_id=r.id,
        member_names=["Alex", "Maria"],
    )
    assert out["status"] == "ok"
    data = out["data"]
    assert data["total"] == 100.0
    assert data["member_count"] == 3  # You + Alex + Maria
    assert data["per_person"] == pytest.approx(33.33, abs=0.01)
    assert len(data["owes"]) == 2


def test_create_split_no_receipt(db_session, user):
    out = chat_tools.create_split(
        db_session, user.id, receipt_id="does-not-exist", member_names=["Alex"]
    )
    assert out["status"] == "empty"


def test_create_split_no_members(db_session, user):
    r = _mk_receipt(db_session, user.id, "WF", 50.0, "groceries")
    out = chat_tools.create_split(db_session, user.id, receipt_id=r.id, member_names=[])
    assert out["status"] == "error"


def test_create_split_zero_total(db_session, user):
    r = _mk_receipt(db_session, user.id, "Pending", 0.0, "other")
    out = chat_tools.create_split(
        db_session, user.id, receipt_id=r.id, member_names=["Alex"]
    )
    assert out["status"] == "error"


def test_create_split_user_isolation(db_session, user):
    other = User(email="other@example.com", hashed_password="x")
    db_session.add(other)
    db_session.commit()
    r = _mk_receipt(db_session, other.id, "Other's", 100.0, "other")

    # user tries to split another user's receipt → must NOT succeed
    out = chat_tools.create_split(
        db_session, user.id, receipt_id=r.id, member_names=["Alex"]
    )
    assert out["status"] == "empty"  # "receipt not found for this account"


def test_create_split_itemized_rejected(db_session, user):
    r = _mk_receipt(db_session, user.id, "WF", 50.0, "groceries")
    out = chat_tools.create_split(
        db_session,
        user.id,
        receipt_id=r.id,
        member_names=["Alex"],
        style="itemized",
    )
    assert out["status"] == "error"
    assert "even" in out["hint"].lower()


# ---------------------------------------------------------------------------
# add_budget
# ---------------------------------------------------------------------------


def test_add_budget_creates(db_session, user):
    out = chat_tools.add_budget(db_session, user.id, "groceries", 400.0)
    assert out["status"] == "ok"
    assert out["data"]["created"] is True
    assert out["data"]["monthly_limit"] == 400.0


def test_add_budget_updates(db_session, user):
    chat_tools.add_budget(db_session, user.id, "dining", 200.0)
    out = chat_tools.add_budget(db_session, user.id, "dining", 350.0)
    assert out["data"]["created"] is False
    assert out["data"]["monthly_limit"] == 350.0


def test_add_budget_normalizes_alias(db_session, user):
    out = chat_tools.add_budget(db_session, user.id, "food", 200.0)
    assert out["status"] == "ok"
    assert out["data"]["category"] == "dining"  # alias


def test_add_budget_rejects_bad_input(db_session, user):
    assert chat_tools.add_budget(db_session, user.id, "xyzzy", 100.0)["status"] == "error"
    assert chat_tools.add_budget(db_session, user.id, "dining", -10)["status"] == "error"
    assert chat_tools.add_budget(db_session, user.id, "", 100.0)["status"] == "error"


# ---------------------------------------------------------------------------
# Tool registry sanity
# ---------------------------------------------------------------------------


def test_all_tools_return_envelope(db_session, user):
    """Every tool must return a dict with 'status' key."""
    r = _mk_receipt(db_session, user.id, "WF", 50.0, "groceries")
    results = [
        chat_tools.get_spend_summary(db_session, user.id),
        chat_tools.list_receipts(db_session, user.id),
        chat_tools.find_receipts(db_session, user.id, "wf"),
        chat_tools.add_budget(db_session, user.id, "dining", 100.0),
        chat_tools.get_budget_status(db_session, user.id, "dining"),
        chat_tools.create_split(db_session, user.id, r.id, ["Alex"]),
    ]
    for res in results:
        assert isinstance(res, dict)
        assert "status" in res
        assert res["status"] in ("ok", "empty", "error")


def test_registry_has_six_tools():
    expected = {
        "get_spend_summary",
        "get_budget_status",
        "list_receipts",
        "find_receipts",
        "create_split",
        "add_budget",
    }
    assert set(chat_tools.TOOL_REGISTRY.keys()) == expected
