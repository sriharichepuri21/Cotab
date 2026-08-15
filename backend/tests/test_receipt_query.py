"""Filtering and search over the receipts list.

Runs on SQLite, which is the LIKE branch of the dialect split. The Postgres
full-text branch is structurally identical (same predicate shape, same OR/EXISTS
composition) but is genuinely not exercised here — see the note on
test_search_dialect_branch_is_selected_by_bind.
"""

from datetime import date, datetime, timedelta, timezone

import pytest

from app.models import Receipt, ReceiptLineItem
from app.services import receipt_query as RQ


def _mk(db, user_id, merchant, total, category="other", days_ago=0, status="extracted"):
    r = Receipt(
        user_id=user_id,
        merchant=merchant,
        total=total,
        subtotal=total,
        currency="USD",
        category=category,
        status=status,
        purchased_at=datetime.now(timezone.utc) - timedelta(days=days_ago),
    )
    db.add(r)
    db.commit()
    db.refresh(r)
    return r


def _item(db, receipt, user_id, description, price=1.0):
    db.add(
        ReceiptLineItem(
            receipt_id=receipt.id,
            user_id=user_id,
            description=description,
            quantity=1,
            unit_price=price,
            total_price=price,
        )
    )
    db.commit()


@pytest.fixture()
def seeded(db_session, user):
    a = _mk(db_session, user.id, "Costco", 120.0, "groceries", days_ago=2)
    b = _mk(db_session, user.id, "Blue Bottle", 8.0, "dining", days_ago=10)
    c = _mk(
        db_session, user.id, "Shell", 52.0, "transport", days_ago=40, status="reviewed"
    )
    _item(db_session, a, user.id, "Paper Towels 12pk")
    _item(db_session, a, user.id, "Organic Eggs")
    _item(db_session, b, user.id, "Latte")
    return {"costco": a, "bluebottle": b, "shell": c}


def _ids(rows):
    return {r.id for r in rows}


# --- no filters -------------------------------------------------------------


def test_no_filters_returns_everything_newest_first(db_session, user, seeded):
    rows = RQ.search_receipts(db_session, user.id)
    assert len(rows) == 3
    assert rows[0].id == seeded["costco"].id  # 2 days ago is newest


def test_soft_deleted_excluded(db_session, user, seeded):
    seeded["shell"].deleted_at = datetime.now(timezone.utc)
    db_session.commit()
    assert len(RQ.search_receipts(db_session, user.id)) == 2


def test_other_users_receipts_never_returned(db_session, user, other_user, seeded):
    _mk(db_session, other_user.id, "Theirs", 999.0)
    rows = RQ.search_receipts(db_session, user.id)
    assert all(r.user_id == user.id for r in rows)
    assert len(rows) == 3


# --- individual filters -----------------------------------------------------


def test_filter_by_category(db_session, user, seeded):
    rows = RQ.search_receipts(db_session, user.id, category="dining")
    assert _ids(rows) == {seeded["bluebottle"].id}


def test_filter_by_merchant_is_substring_and_case_insensitive(db_session, user, seeded):
    rows = RQ.search_receipts(db_session, user.id, merchant="bottle")
    assert _ids(rows) == {seeded["bluebottle"].id}


def test_filter_by_status(db_session, user, seeded):
    rows = RQ.search_receipts(db_session, user.id, status="reviewed")
    assert _ids(rows) == {seeded["shell"].id}


def test_filter_by_amount_range(db_session, user, seeded):
    rows = RQ.search_receipts(db_session, user.id, min_amount=10, max_amount=100)
    assert _ids(rows) == {seeded["shell"].id}


def test_filter_by_date_range(db_session, user, seeded):
    today = datetime.now(timezone.utc).date()
    rows = RQ.search_receipts(
        db_session, user.id, start_date=today - timedelta(days=15), end_date=today
    )
    assert _ids(rows) == {seeded["costco"].id, seeded["bluebottle"].id}


def test_end_date_is_inclusive(db_session, user):
    """Picking "the 5th" must include the 5th, not silently drop it."""
    today = datetime.now(timezone.utc).date()
    r = _mk(db_session, user.id, "SameDay", 5.0, days_ago=0)
    rows = RQ.search_receipts(db_session, user.id, start_date=today, end_date=today)
    assert _ids(rows) == {r.id}


# --- search -----------------------------------------------------------------


def test_search_matches_merchant(db_session, user, seeded):
    rows = RQ.search_receipts(db_session, user.id, q="costco")
    assert _ids(rows) == {seeded["costco"].id}


def test_search_matches_line_item_description(db_session, user, seeded):
    """The headline requirement: "did I buy paper towels" must work even though
    no merchant is called that."""
    rows = RQ.search_receipts(db_session, user.id, q="paper towels")
    assert _ids(rows) == {seeded["costco"].id}


def test_search_returns_each_receipt_once_despite_multiple_item_hits(
    db_session, user, seeded
):
    """EXISTS, not JOIN — a receipt with two matching items is still one row."""
    _item(db_session, seeded["costco"], user.id, "Paper Plates")
    rows = RQ.search_receipts(db_session, user.id, q="paper")
    assert len(rows) == 1


def test_search_with_no_match_returns_empty(db_session, user, seeded):
    assert RQ.search_receipts(db_session, user.id, q="zzzznotathing") == []


def test_blank_search_is_ignored_not_treated_as_no_match(db_session, user, seeded):
    assert len(RQ.search_receipts(db_session, user.id, q="   ")) == 3


# --- combining --------------------------------------------------------------


def test_filters_combine_as_and(db_session, user, seeded):
    rows = RQ.search_receipts(
        db_session, user.id, category="groceries", min_amount=100, q="eggs"
    )
    assert _ids(rows) == {seeded["costco"].id}


def test_combination_that_matches_nothing_returns_empty(db_session, user, seeded):
    rows = RQ.search_receipts(db_session, user.id, category="dining", min_amount=1000)
    assert rows == []


# --- sorting and paging -----------------------------------------------------


def test_sort_by_amount_ascending(db_session, user, seeded):
    rows = RQ.search_receipts(db_session, user.id, sort="amount", order="asc")
    assert [r.total for r in rows] == [8.0, 52.0, 120.0]


def test_unknown_sort_key_falls_back_to_date(db_session, user, seeded):
    rows = RQ.search_receipts(db_session, user.id, sort="nonsense")
    assert rows[0].id == seeded["costco"].id


def test_receipts_without_a_date_sort_last_not_first(db_session, user, seeded):
    undated = _mk(db_session, user.id, "Undated", 1.0)
    undated.purchased_at = None
    db_session.commit()
    rows = RQ.search_receipts(db_session, user.id, sort="date", order="desc")
    assert rows[-1].id == undated.id


def test_limit_and_offset_page_through(db_session, user, seeded):
    first = RQ.search_receipts(db_session, user.id, limit=2)
    second = RQ.search_receipts(db_session, user.id, limit=2, offset=2)
    assert len(first) == 2 and len(second) == 1
    assert not (_ids(first) & _ids(second))


def test_limit_is_clamped(db_session, user, seeded):
    assert len(RQ.search_receipts(db_session, user.id, limit=10_000)) == 3


# --- facets -----------------------------------------------------------------


def test_facets_list_only_this_users_values(db_session, user, other_user, seeded):
    _mk(db_session, other_user.id, "SecretShop", 1.0, "travel")
    f = RQ.filter_facets(db_session, user.id)
    assert f["categories"] == ["dining", "groceries", "transport"]
    assert "SecretShop" not in f["merchants"]
    assert set(f["statuses"]) == {"extracted", "reviewed"}


# --- dialect split ----------------------------------------------------------


def test_search_dialect_branch_is_selected_by_bind(db_session):
    """These tests run on SQLite, so only the LIKE branch is executed here.

    Asserting the detection explicitly makes the coverage gap visible: if this
    ever reports postgresql, the assertions above are testing a different code
    path than the one they were written for.
    """
    assert RQ._is_postgres(db_session) is False
