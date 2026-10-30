"""Insights for a past month: the same figures as the summary, for that month."""

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.db.session import get_db
from app.main import app
from app.models import Receipt
from tests.test_my_share import _split, trip  # noqa: F401  (fixture)
from tests.test_notifications import API


@pytest.fixture()
def client(db_session):
    app.dependency_overrides[get_db] = lambda: db_session
    yield TestClient(app)
    app.dependency_overrides.clear()


def _bought(db, owner, total, when, category="dining", merchant="Nopa"):
    r = Receipt(
        user_id=owner,
        merchant=merchant,
        category=category,
        total=total,
        subtotal=total,
        status="reviewed",
        purchased_at=when,
    )
    db.add(r)
    db.commit()
    return r


def test_a_past_month_counts_your_share(client, db_session, trip):  # noqa: F811
    tab, people, ids = trip
    september = datetime(2026, 9, 12, tzinfo=timezone.utc)
    dinner = _bought(db_session, ids["ada"], 60, september)
    _split(client, people["ada"], tab, dinner, "Ada")
    _bought(db_session, ids["ada"], 10, september, "groceries", "Safeway")
    _bought(db_session, ids["ada"], 99, datetime(2026, 8, 30, tzinfo=timezone.utc))

    out = client.get(f"{API}/analytics/month?month=2026-09", headers=people["ada"])
    assert out.status_code == 200, out.text
    body = out.json()
    assert body["totals"]["total_spent"] == 30.0
    assert body["totals"]["start_date"] == "2026-09-01"
    assert body["totals"]["end_date"] == "2026-09-30"
    assert {c["name"]: c["amount"] for c in body["categories"]} == {
        "dining": 20.0,
        "groceries": 10.0,
    }
    # Ben's month has his share of Ada's dinner, not hers.
    ben = client.get(
        f"{API}/analytics/month?month=2026-09", headers=people["ben"]
    ).json()
    assert ben["totals"]["total_spent"] == 20.0

    # The category drill-down uses the exact same share-aware source. Ben can
    # see the purchase that explains his total without gaining edit access.
    detail = client.get(
        f"{API}/analytics/month/receipts?month=2026-09&category=dining",
        headers=people["ben"],
    )
    assert detail.status_code == 200, detail.text
    assert [
        (row["merchant"], row["my_share"], row["owned"]) for row in detail.json()
    ] == [("Nopa", 20.0, False)]

    mine = client.get(
        f"{API}/analytics/month/receipts?month=2026-09&category=dining",
        headers=people["ada"],
    ).json()
    assert mine[0]["owned"] is True and mine[0]["my_share"] == 20.0


def test_the_whole_month_can_be_listed_for_the_calendar(
    client, db_session, trip  # noqa: F811
):
    tab, people, ids = trip
    september = datetime(2026, 9, 12, tzinfo=timezone.utc)
    _split(
        client,
        people["ada"],
        tab,
        _bought(db_session, ids["ada"], 60, september),
        "Ada",
    )
    _bought(db_session, ids["ben"], 10, september, "groceries", "Safeway")
    rows = client.get(
        f"{API}/analytics/month/receipts?month=2026-09", headers=people["ben"]
    ).json()
    assert sorted((r["merchant"], r["my_share"], r["owned"]) for r in rows) == [
        ("Nopa", 20.0, False),
        ("Safeway", 10.0, True),
    ]


@pytest.mark.parametrize("bad", ["2026-13", "2026-9", "sept", "2026-00"])
def test_a_month_has_to_be_a_month(client, trip, bad):  # noqa: F811
    _, people, _ = trip
    out = client.get(f"{API}/analytics/month?month={bad}", headers=people["ada"])
    assert out.status_code == 422


def test_it_needs_you_signed_in(client):
    assert client.get(f"{API}/analytics/month?month=2026-09").status_code == 401
    assert (
        client.get(
            "/api/v1/analytics/month/receipts?month=2026-09&category=dining"
        ).status_code
        == 401
    )
