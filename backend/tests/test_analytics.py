"""Tests for analytics_service — the aggregations behind the dashboard.

In-memory SQLite, no network. Every assertion checks a specific number rather
than "returns something", because the whole point of this module is that the
dashboard and the chat assistant agree on the arithmetic.
"""

from datetime import datetime, timedelta, timezone

import pytest

from app.models import Budget, Receipt
from app.services import analytics_service as A
from app.services import chat_tools


def _mk(db, user_id, merchant, total, category, days_ago=0, status="extracted"):
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


def _this_month(db, user):
    """Seed receipts guaranteed to land inside the current calendar month."""
    today = datetime.now(timezone.utc).date()
    # day-of-month - 1 keeps every receipt on/after the 1st, whatever today is
    offset = today.day - 1
    _mk(db, user.id, "Costco", 100.0, "groceries", days_ago=offset)
    _mk(db, user.id, "Costco", 50.0, "groceries", days_ago=offset)
    _mk(db, user.id, "Blue Bottle", 20.0, "dining", days_ago=offset)


# --- counted statuses -------------------------------------------------------


def test_only_extracted_and_reviewed_count(db_session, user):
    today = datetime.now(timezone.utc).date()
    off = today.day - 1
    _mk(db_session, user.id, "A", 10.0, "groceries", days_ago=off, status="extracted")
    _mk(db_session, user.id, "B", 20.0, "groceries", days_ago=off, status="reviewed")
    _mk(db_session, user.id, "C", 999.0, "groceries", days_ago=off, status="failed")
    _mk(db_session, user.id, "D", 999.0, "groceries", days_ago=off, status="uploaded")
    start, end = A.month_bounds()
    assert A.totals_for_period(db_session, user.id, start, end)["total_spent"] == 30.0


def test_soft_deleted_receipts_are_excluded(db_session, user):
    today = datetime.now(timezone.utc).date()
    r = _mk(db_session, user.id, "A", 10.0, "groceries", days_ago=today.day - 1)
    start, end = A.month_bounds()
    assert A.totals_for_period(db_session, user.id, start, end)["total_spent"] == 10.0
    r.deleted_at = datetime.now(timezone.utc)
    db_session.commit()
    assert A.totals_for_period(db_session, user.id, start, end)["total_spent"] == 0.0


def test_other_users_spend_is_invisible(db_session, user, other_user):
    today = datetime.now(timezone.utc).date()
    _mk(db_session, other_user.id, "Theirs", 500.0, "groceries", days_ago=today.day - 1)
    _mk(db_session, user.id, "Mine", 7.0, "groceries", days_ago=today.day - 1)
    start, end = A.month_bounds()
    assert A.totals_for_period(db_session, user.id, start, end)["total_spent"] == 7.0


# --- month bounds -----------------------------------------------------------


def test_month_bounds_is_half_open():
    from datetime import date

    start, end = A.month_bounds(date(2026, 1, 15))
    assert start == date(2026, 1, 1)
    assert end == date(2026, 2, 1)  # exclusive, so Jan 31 is included


def test_month_bounds_rolls_over_december():
    from datetime import date

    start, end = A.month_bounds(date(2026, 12, 9))
    assert (start.year, start.month) == (2026, 12)
    assert (end.year, end.month) == (2027, 1)


# --- breakdowns -------------------------------------------------------------


def test_category_breakdown_sorted_by_amount(db_session, user):
    _this_month(db_session, user)
    start, end = A.month_bounds()
    rows = A.category_breakdown(db_session, user.id, start, end)
    assert rows[0]["name"] == "groceries"
    assert rows[0]["amount"] == 150.0
    assert rows[0]["count"] == 2
    assert rows[1]["name"] == "dining"


def test_merchant_breakdown_groups_by_merchant(db_session, user):
    _this_month(db_session, user)
    start, end = A.month_bounds()
    rows = A.merchant_breakdown(db_session, user.id, start, end)
    assert rows[0] == {"name": "Costco", "amount": 150.0, "count": 2}


# --- trend ------------------------------------------------------------------


def test_monthly_trend_returns_requested_span_oldest_first(db_session, user):
    trend = A.monthly_trend(db_session, user.id, months=6)
    assert len(trend) == 6
    assert trend == sorted(trend, key=lambda d: d["month"])
    assert trend[-1]["month"] == datetime.now(timezone.utc).strftime("%Y-%m")


def test_monthly_trend_includes_empty_months_as_zero(db_session, user):
    _this_month(db_session, user)
    trend = A.monthly_trend(db_session, user.id, months=3)
    assert trend[-1]["amount"] == 170.0
    assert all(t["amount"] == 0.0 for t in trend[:-1])  # gaps are not dropped


# --- budgets ----------------------------------------------------------------


def test_budget_health_empty_without_budgets(db_session, user):
    _this_month(db_session, user)
    assert A.budget_health(db_session, user.id) == []


def test_budget_health_reports_usage_and_over_budget(db_session, user):
    _this_month(db_session, user)  # groceries = 150
    db_session.add(
        Budget(
            user_id=user.id,
            level="category",
            target="groceries",
            period="monthly",
            amount=100.0,
        )
    )
    db_session.add(
        Budget(
            user_id=user.id,
            level="category",
            target="dining",
            period="monthly",
            amount=200.0,
        )
    )
    db_session.commit()
    rows = A.budget_health(db_session, user.id)
    worst = rows[0]
    assert worst["category"] == "groceries"  # sorted worst-first
    assert worst["spent"] == 150.0 and worst["limit"] == 100.0
    assert worst["percent_used"] == 150.0
    assert worst["over_budget"] is True
    assert rows[1]["over_budget"] is False
    assert (worst["level"], worst["period"]) == ("category", "monthly")


def test_budget_health_says_which_budget_is_the_overall_one(db_session, user):
    """The home card shows the monthly total, not whichever budget is fullest."""
    _this_month(db_session, user)  # groceries = 150
    for level, target, period, amount in (
        ("item", "Paneer", "yearly", 100.0),
        ("total", None, "monthly", 500.0),
    ):
        db_session.add(
            Budget(
                user_id=user.id,
                level=level,
                target=target,
                period=period,
                amount=amount,
            )
        )
    db_session.commit()
    rows = A.budget_health(db_session, user.id)
    overall = [r for r in rows if r["level"] == "total" and r["period"] == "monthly"]
    assert [r["limit"] for r in overall] == [500.0]
    assert overall[0]["category"] == "Monthly total"


# --- pending review ---------------------------------------------------------


def test_pending_review_counts_only_extracted(db_session, user):
    _mk(db_session, user.id, "A", 1.0, "other", status="extracted")
    _mk(db_session, user.id, "B", 1.0, "other", status="reviewed")
    _mk(db_session, user.id, "C", 1.0, "other", status="failed")
    assert A.pending_review_count(db_session, user.id) == 1


# --- summary shape ----------------------------------------------------------


def test_dashboard_summary_shape(db_session, user):
    _this_month(db_session, user)
    s = A.dashboard_summary(db_session, user.id, trend_months=3)
    assert s["this_month"]["total_spent"] == 170.0
    assert s["this_month"]["receipt_count"] == 3
    assert s["top_category"]["name"] == "groceries"
    assert s["top_merchant"]["name"] == "Costco"
    assert len(s["monthly_trend"]) == 3
    assert s["pending_review"] == 3
    assert s["budget_health"] == []


def test_dashboard_summary_on_empty_account(db_session, user):
    """A brand-new account must not crash or invent numbers."""
    s = A.dashboard_summary(db_session, user.id)
    assert s["this_month"]["total_spent"] == 0.0
    assert s["top_category"] is None
    assert s["top_merchant"] is None
    assert s["pending_review"] == 0


# --- the reason this module exists ------------------------------------------


def test_dashboard_and_chat_agree_on_the_same_total(db_session, user):
    """Both surfaces answer "what did I spend" — they must not diverge."""
    _this_month(db_session, user)
    start, end = A.month_bounds()
    dash = A.totals_for_period(db_session, user.id, start, end)["total_spent"]
    chat = chat_tools.get_spend_summary(
        db_session,
        user.id,
        start_date=start.isoformat(),
        end_date=(end - timedelta(days=1)).isoformat(),
    )
    assert chat["status"] == "ok"
    assert chat["data"]["total_spent"] == dash


def test_chat_summary_also_ignores_failed_receipts(db_session, user):
    """Regression guard for the shared query: status filtering must survive."""
    today = datetime.now(timezone.utc).date()
    off = today.day - 1
    _mk(db_session, user.id, "A", 10.0, "groceries", days_ago=off)
    _mk(db_session, user.id, "B", 999.0, "groceries", days_ago=off, status="failed")
    start, end = A.month_bounds()
    res = chat_tools.get_spend_summary(
        db_session,
        user.id,
        start_date=start.isoformat(),
        end_date=(end - timedelta(days=1)).isoformat(),
    )
    assert res["data"]["total_spent"] == 10.0


# --- HTTP endpoint ----------------------------------------------------------


@pytest.fixture()
def client(db_session):
    from fastapi.testclient import TestClient

    from app.db.session import get_db
    from app.main import app

    app.dependency_overrides[get_db] = lambda: db_session
    # Not `with TestClient(app)`: the lifespan calls ensure_bucket_exists() and
    # spends ~13s waiting on an unreachable LocalStack.
    yield TestClient(app)
    app.dependency_overrides.clear()


def _auth(client):
    r = client.post(
        "/api/v1/auth/register",
        json={"email": "dash@example.com", "password": "Pw12345!", "full_name": "Dash"},
    )
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_summary_endpoint_requires_auth(client):
    assert client.get("/api/v1/analytics/summary").status_code == 401


def test_summary_endpoint_returns_dashboard_payload(client, db_session):
    headers = _auth(client)
    from app.models import User

    u = db_session.query(User).filter(User.email == "dash@example.com").one()
    _this_month(db_session, u)

    r = client.get("/api/v1/analytics/summary?trend_months=3", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert body["this_month"]["total_spent"] == 170.0
    assert body["top_category"]["name"] == "groceries"
    assert len(body["monthly_trend"]) == 3


def test_summary_endpoint_rejects_absurd_trend_span(client):
    headers = _auth(client)
    assert (
        client.get(
            "/api/v1/analytics/summary?trend_months=999", headers=headers
        ).status_code
        == 422
    )


def test_a_monthly_budget_tabby_sets_is_the_one_home_shows(db_session, user):
    """'Set my monthly budget to $600': Tabby's step, then the home card's data."""
    from app.services import tabby_agent

    def tabby_sets(amount):
        plan = tabby_agent.Plan()
        args = {"level": "total", "amount": amount}
        prepared = tabby_agent.prepare("add_budget", db_session, user.id, args, plan)
        assert prepared["status"] == "added_to_plan", prepared
        assert tabby_agent.run(db_session, user.id, plan.steps)["status"] == "ok"

    def home_card():
        return [
            row["limit"]
            for row in A.budget_health(db_session, user.id)
            if row["level"] == "total" and row["period"] == "monthly"
        ]

    tabby_sets(500)
    assert home_card() == [500.0]
    tabby_sets(600)  # changes it, doesn't add a second one
    assert home_card() == [600.0]
