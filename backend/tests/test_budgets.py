"""Budget evaluation, levels, periods, and threshold crossing.

Includes the three scenarios named in the Phase 4 spec, written as tests so
they're checked on every run rather than once by hand.
"""

from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.db.session import get_db
from app.main import app
from app.models import Budget, Receipt, ReceiptLineItem
from app.services import budget_service as B


def _today_offset():
    """Days back that still lands inside the current month, week and year."""
    today = datetime.now(timezone.utc).date()
    return min(today.day - 1, today.weekday())


def _mk(
    db, user_id, merchant, total, category="other", days_ago=None, status="extracted"
):
    if days_ago is None:
        days_ago = _today_offset()
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


def _item(db, receipt, user_id, description, price):
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


def _budget(
    db, user_id, level, target, amount, period="monthly", thresholds="80,100,120"
):
    b = Budget(
        user_id=user_id,
        level=level,
        target=target,
        period=period,
        amount=amount,
        alert_thresholds=thresholds,
    )
    db.add(b)
    db.commit()
    db.refresh(b)
    return b


# --- period bounds ----------------------------------------------------------


def test_weekly_period_starts_monday():
    start, end = B.period_bounds("weekly", date(2026, 8, 13))  # a Thursday
    assert start == date(2026, 8, 10) and start.weekday() == 0
    assert end == date(2026, 8, 17)


def test_monthly_period_is_half_open():
    start, end = B.period_bounds("monthly", date(2026, 1, 31))
    assert start == date(2026, 1, 1) and end == date(2026, 2, 1)


def test_yearly_period_spans_the_calendar_year():
    start, end = B.period_bounds("yearly", date(2026, 6, 9))
    assert start == date(2026, 1, 1) and end == date(2027, 1, 1)


def test_unknown_period_falls_back_to_monthly():
    assert B.period_bounds("fortnightly", date(2026, 3, 15)) == B.period_bounds(
        "monthly", date(2026, 3, 15)
    )


# --- thresholds -------------------------------------------------------------


def test_thresholds_parse_and_sort():
    assert B.parse_thresholds("100, 80,120") == [80, 100, 120]


def test_thresholds_ignore_junk_and_fall_back():
    assert B.parse_thresholds("abc,,-5") == list(B.DEFAULT_THRESHOLDS)
    assert B.parse_thresholds(None) == list(B.DEFAULT_THRESHOLDS)


# --- levels -----------------------------------------------------------------


def test_category_budget_counts_only_that_category(db_session, user):
    _mk(db_session, user.id, "Costco", 100.0, "groceries")
    _mk(db_session, user.id, "Blue Bottle", 40.0, "dining")
    b = _budget(db_session, user.id, "category", "groceries", 200.0)
    assert B.evaluate(db_session, user.id, b)["spent"] == 100.0


def test_total_budget_counts_every_category(db_session, user):
    _mk(db_session, user.id, "Costco", 100.0, "groceries")
    _mk(db_session, user.id, "Blue Bottle", 40.0, "dining")
    b = _budget(db_session, user.id, "total", "", 500.0)
    assert B.evaluate(db_session, user.id, b)["spent"] == 140.0


def test_merchant_budget_matches_substring_case_insensitively(db_session, user):
    _mk(db_session, user.id, "Blue Bottle Coffee", 40.0, "dining")
    _mk(db_session, user.id, "Costco", 100.0, "groceries")
    b = _budget(db_session, user.id, "merchant", "blue bottle", 50.0)
    assert B.evaluate(db_session, user.id, b)["spent"] == 40.0


def test_item_budget_counts_line_items_not_whole_receipts(db_session, user):
    """The point of an item budget: a $4 latte on a $90 grocery run costs the
    coffee budget $4, not $90."""
    r = _mk(db_session, user.id, "Costco", 90.0, "groceries")
    _item(db_session, r, user.id, "Coffee Beans 1kg", 4.0)
    _item(db_session, r, user.id, "Paper Towels", 86.0)
    b = _budget(db_session, user.id, "item", "coffee", 50.0)
    assert B.evaluate(db_session, user.id, b)["spent"] == 4.0


def test_failed_and_deleted_receipts_never_count(db_session, user):
    _mk(db_session, user.id, "A", 50.0, "groceries")
    _mk(db_session, user.id, "B", 999.0, "groceries", status="failed")
    gone = _mk(db_session, user.id, "C", 999.0, "groceries")
    gone.deleted_at = datetime.now(timezone.utc)
    db_session.commit()
    b = _budget(db_session, user.id, "category", "groceries", 100.0)
    assert B.evaluate(db_session, user.id, b)["spent"] == 50.0


def test_another_users_spend_never_counts(db_session, user, other_user):
    _mk(db_session, other_user.id, "Costco", 500.0, "groceries")
    _mk(db_session, user.id, "Costco", 20.0, "groceries")
    b = _budget(db_session, user.id, "category", "groceries", 100.0)
    assert B.evaluate(db_session, user.id, b)["spent"] == 20.0


# --- periods scope the window ----------------------------------------------


def test_yearly_budget_sees_spend_a_month_ago_that_monthly_misses(db_session, user):
    today = datetime.now(timezone.utc).date()
    days_back = today.day + 5  # definitely last month, same year
    if today.month == 1:
        pytest.skip(
            "January: 'last month' is last year, which the yearly window excludes"
        )
    _mk(db_session, user.id, "Costco", 60.0, "groceries", days_ago=days_back)

    monthly = _budget(db_session, user.id, "category", "groceries", 100.0, "monthly")
    yearly = _budget(db_session, user.id, "category", "groceries", 100.0, "yearly")
    assert B.evaluate(db_session, user.id, monthly)["spent"] == 0.0
    assert B.evaluate(db_session, user.id, yearly)["spent"] == 60.0


# --- percentages and thresholds --------------------------------------------


def test_percent_and_remaining(db_session, user):
    _mk(db_session, user.id, "Costco", 30.0, "dining")
    b = _budget(db_session, user.id, "category", "dining", 50.0)
    s = B.evaluate(db_session, user.id, b)
    assert s["percent_used"] == 60.0
    assert s["remaining"] == 20.0
    assert s["over_budget"] is False
    assert s["threshold_reached"] is None  # 60% is below the 80 threshold


def test_over_budget_reports_highest_threshold_reached(db_session, user):
    _mk(db_session, user.id, "Costco", 55.0, "dining")
    b = _budget(db_session, user.id, "category", "dining", 50.0)  # 110%
    s = B.evaluate(db_session, user.id, b)
    assert s["over_budget"] is True
    assert s["threshold_reached"] == 100  # 110% clears 80 and 100, not 120


def test_zero_limit_does_not_divide_by_zero(db_session, user):
    _mk(db_session, user.id, "Costco", 10.0, "dining")
    b = _budget(db_session, user.id, "category", "dining", 0.0)
    s = B.evaluate(db_session, user.id, b)
    assert s["percent_used"] == 0.0 and s["over_budget"] is False


# --- crossing detection -----------------------------------------------------


def test_only_newly_crossed_thresholds_are_reported(db_session, user):
    """Uploading into an already-blown budget must stay quiet, or users learn to
    ignore the alerts."""
    _budget(db_session, user.id, "category", "dining", 50.0)
    _mk(db_session, user.id, "Cafe", 60.0, "dining")  # already 120%

    before = B.evaluate_all(db_session, user.id)
    _mk(db_session, user.id, "Cafe", 5.0, "dining")  # now 130%, same threshold band
    assert B.check_after_upload(db_session, user.id, before) == []


def test_crossing_a_threshold_is_reported_once(db_session, user):
    b = _budget(db_session, user.id, "category", "dining", 50.0)
    _mk(db_session, user.id, "Cafe", 30.0, "dining")  # 60%, under threshold

    before = B.evaluate_all(db_session, user.id)
    _mk(db_session, user.id, "Cafe", 15.0, "dining")  # 90% -> crosses 80
    crossed = B.check_after_upload(db_session, user.id, before)
    assert len(crossed) == 1
    assert crossed[0]["budget_id"] == b.id
    assert crossed[0]["threshold_reached"] == 80


# --- the spec's scenarios ---------------------------------------------------


def test_spec_coffee_budget_progress_then_overage(db_session, user):
    """$50 coffee budget; $30 receipt -> 60%; another $25 -> overage."""
    b = _budget(db_session, user.id, "category", "dining", 50.0)

    _mk(db_session, user.id, "Coffee Shop", 30.0, "dining")
    assert B.evaluate(db_session, user.id, b)["percent_used"] == 60.0

    before = B.evaluate_all(db_session, user.id)
    _mk(db_session, user.id, "Coffee Shop", 25.0, "dining")
    state = B.evaluate(db_session, user.id, b)
    assert state["spent"] == 55.0
    assert state["over_budget"] is True
    crossed = B.check_after_upload(db_session, user.id, before)
    assert crossed and crossed[0]["threshold_reached"] == 100


def test_spec_monthly_total_tracks_across_categories(db_session, user):
    b = _budget(db_session, user.id, "total", "", 200.0)
    _mk(db_session, user.id, "Costco", 80.0, "groceries")
    _mk(db_session, user.id, "Shell", 40.0, "transport")
    _mk(db_session, user.id, "Cafe", 30.0, "dining")
    assert B.evaluate(db_session, user.id, b)["spent"] == 150.0


def test_spec_multiple_levels_do_not_conflict(db_session, user):
    """Four budgets over the same receipt each count their own slice."""
    r = _mk(db_session, user.id, "Blue Bottle Coffee", 40.0, "dining")
    _item(db_session, r, user.id, "Latte", 12.0)

    total = _budget(db_session, user.id, "total", "", 500.0)
    cat = _budget(db_session, user.id, "category", "dining", 100.0)
    merch = _budget(db_session, user.id, "merchant", "Blue Bottle", 60.0)
    item = _budget(db_session, user.id, "item", "latte", 20.0)

    assert B.evaluate(db_session, user.id, total)["spent"] == 40.0
    assert B.evaluate(db_session, user.id, cat)["spent"] == 40.0
    assert B.evaluate(db_session, user.id, merch)["spent"] == 40.0
    assert B.evaluate(db_session, user.id, item)["spent"] == 12.0  # item only


# --- HTTP -------------------------------------------------------------------


@pytest.fixture()
def client(db_session):
    app.dependency_overrides[get_db] = lambda: db_session
    yield TestClient(app)
    app.dependency_overrides.clear()


def _auth(client, email="bud@example.com"):
    r = client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "Pw12345!", "full_name": "B"},
    )
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_budgets_require_auth(client):
    assert client.get("/api/v1/budgets/").status_code == 401


def test_budget_collection_route_works_without_trailing_slash(client):
    assert client.get("/api/v1/budgets", follow_redirects=False).status_code == 401


def test_create_and_list_budget(client):
    h = _auth(client)
    r = client.post(
        "/api/v1/budgets/",
        json={
            "level": "category",
            "target": "dining",
            "period": "monthly",
            "amount": 50,
        },
        headers=h,
    )
    assert r.status_code == 201
    rows = client.get("/api/v1/budgets/", headers=h).json()
    assert len(rows) == 1
    assert rows[0]["limit"] == 50.0 and rows[0]["percent_used"] == 0.0


def test_category_budget_accepts_an_alias(client):
    h = _auth(client, "alias@example.com")
    r = client.post(
        "/api/v1/budgets/",
        json={"level": "category", "target": "food", "amount": 50},
        headers=h,
    )
    assert r.status_code == 201
    assert r.json()["target"] == "dining"  # normalized


def test_unknown_category_is_rejected_at_creation(client):
    """A target that can never match must fail loudly now, not silently later."""
    h = _auth(client, "badcat@example.com")
    r = client.post(
        "/api/v1/budgets/",
        json={"level": "category", "target": "zzz", "amount": 50},
        headers=h,
    )
    assert r.status_code == 422


def test_non_total_budget_requires_a_target(client):
    h = _auth(client, "notarget@example.com")
    r = client.post(
        "/api/v1/budgets/",
        json={"level": "merchant", "target": "", "amount": 50},
        headers=h,
    )
    assert r.status_code == 422


def test_total_budget_ignores_any_target_sent(client):
    h = _auth(client, "tot@example.com")
    r = client.post(
        "/api/v1/budgets/",
        json={"level": "total", "target": "nonsense", "amount": 500},
        headers=h,
    )
    assert r.status_code == 201 and r.json()["target"] == ""


def test_negative_amount_rejected(client):
    h = _auth(client, "neg@example.com")
    r = client.post(
        "/api/v1/budgets/",
        json={"level": "total", "amount": -5},
        headers=h,
    )
    assert r.status_code == 422


def test_same_scope_upserts_rather_than_duplicating(client):
    h = _auth(client, "up@example.com")
    body = {"level": "category", "target": "dining", "period": "monthly", "amount": 50}
    client.post("/api/v1/budgets/", json=body, headers=h)
    client.post("/api/v1/budgets/", json={**body, "amount": 75}, headers=h)
    rows = client.get("/api/v1/budgets/", headers=h).json()
    assert len(rows) == 1 and rows[0]["limit"] == 75.0


def test_same_target_different_period_is_a_separate_budget(client):
    h = _auth(client, "per@example.com")
    base = {"level": "category", "target": "dining", "amount": 50}
    client.post("/api/v1/budgets/", json={**base, "period": "monthly"}, headers=h)
    client.post("/api/v1/budgets/", json={**base, "period": "weekly"}, headers=h)
    assert len(client.get("/api/v1/budgets/", headers=h).json()) == 2


def test_delete_budget(client):
    h = _auth(client, "del@example.com")
    bid = client.post(
        "/api/v1/budgets/", json={"level": "total", "amount": 100}, headers=h
    ).json()["id"]
    assert client.delete(f"/api/v1/budgets/{bid}", headers=h).status_code == 204
    assert client.get("/api/v1/budgets/", headers=h).json() == []


def test_cannot_touch_another_users_budget(client):
    h1 = _auth(client, "own@example.com")
    h2 = _auth(client, "other@example.com")
    bid = client.post(
        "/api/v1/budgets/", json={"level": "total", "amount": 100}, headers=h1
    ).json()["id"]
    assert client.get("/api/v1/budgets/", headers=h2).json() == []
    assert client.delete(f"/api/v1/budgets/{bid}", headers=h2).status_code == 404
    assert len(client.get("/api/v1/budgets/", headers=h1).json()) == 1
