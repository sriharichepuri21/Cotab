"""Expenses added by hand: cash, a bill, anything with no receipt."""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.db.session import get_db
from app.main import app
from tests.test_notifications import API, _account


@pytest.fixture()
def client(db_session):
    app.dependency_overrides[get_db] = lambda: db_session
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture()
def ada(client):
    return _account(client, "ada@x.com", "Ada", "212-555-0100")


def _add(client, headers, **body):
    return client.post(f"{API}/receipts/manual", headers=headers, json=body)


def _spent(client, headers):
    summary = client.get(f"{API}/analytics/summary", headers=headers).json()
    return summary["this_month"]["total_spent"]


def test_an_expense_typed_in_is_a_receipt_like_any_other(client, ada):
    today = datetime.now(timezone.utc).date()
    out = _add(
        client,
        ada,
        description="Dinner at Nopa",
        amount=60,
        date=today.isoformat(),
        store="Nopa",
        note="Ben's birthday",
    )
    assert out.status_code == 201, out.text
    expense = out.json()
    assert expense["merchant"] == "Dinner at Nopa"
    assert expense["merchant_raw"] == "Nopa"
    assert (expense["total"], expense["source"], expense["status"]) == (
        60.0,
        "manual",
        "reviewed",
    )
    assert expense["category"] == "dining"  # guessed from the description
    assert expense["note"] == "Ben's birthday"
    assert expense["purchased_at"].startswith(today.isoformat())
    assert expense["my_share"] is None and expense["line_items"] == []
    # It counts, lists and opens like a scanned receipt.
    assert _spent(client, ada) == 60.0
    listed = client.get(f"{API}/receipts/", headers=ada).json()
    assert [r["id"] for r in listed] == [expense["id"]]
    assert (
        client.get(f"{API}/receipts/{expense['id']}/image", headers=ada).status_code
        == 404
    )


def test_items_set_the_total(client, ada):
    out = _add(
        client,
        ada,
        description="Laptop order",
        amount=999,  # ignored: the items add up to the total
        category="shopping",
        items=[
            {"description": "MacBook Air", "total_price": 999.0},
            {"description": "Sleeve", "total_price": 39.5},
            {"description": "Coupon", "total_price": -20.0},
        ],
    ).json()
    assert out["total"] == 1018.5 and out["category"] == "shopping"
    assert [li["description"] for li in out["line_items"]] == [
        "MacBook Air",
        "Sleeve",
        "Coupon",
    ]


@pytest.mark.parametrize(
    "body, message",
    [
        ({"description": "Gas"}, "Enter an amount"),
        (
            {"description": "Gas", "items": [{"description": "x", "total_price": 0}]},
            "Enter an amount",
        ),
        (
            {"description": "Gas", "amount": 40, "category": "rocket"},
            "Unknown category",
        ),
    ],
)
def test_what_cant_be_saved_says_why(client, ada, body, message):
    out = _add(client, ada, **body)
    assert out.status_code == 422 and out.json()["detail"].startswith(message)


def test_a_date_in_the_future_or_a_blank_description_is_refused(client, ada):
    future = (datetime.now(timezone.utc) + timedelta(days=5)).date().isoformat()
    assert (
        _add(client, ada, description="Gas", amount=40, date=future).status_code == 422
    )
    assert _add(client, ada, description="", amount=40).status_code == 422
    assert _add(client, ada, description="Gas", amount=-5).status_code == 422


def test_it_can_be_edited_split_and_deleted(client, ada):
    expense = _add(client, ada, description="Groceries at Safeway", amount=90).json()
    assert expense["category"] == "groceries"
    edited = client.post(
        f"{API}/receipts/{expense['id']}/review",
        headers=ada,
        json={"total": 75, "note": "cash"},
    ).json()
    assert (edited["total"], edited["note"], edited["source"]) == (
        75.0,
        "cash",
        "manual",
    )
    assert _spent(client, ada) == 75.0

    tab = client.post(
        f"{API}/splits/groups",
        headers=ada,
        json={
            "name": "Flat",
            "my_name": "Ada",
            "members": [{"name": "Ben"}, {"name": "Cara"}],
        },
    ).json()
    split = client.post(
        f"{API}/splits/groups/{tab['id']}/splits",
        headers=ada,
        json={"receipt_id": expense["id"], "paid_by": "Ada", "mode": "even"},
    )
    assert split.status_code == 200, split.text
    assert _spent(client, ada) == 25.0  # your share

    assert (
        client.delete(f"{API}/receipts/{expense['id']}", headers=ada).status_code == 204
    )
    assert _spent(client, ada) == 0
    summary = client.get(f"{API}/splits/groups/{tab['id']}/summary", headers=ada).json()
    assert summary["splits"] == []


def test_the_category_is_suggested_as_you_type(client, ada):
    def guess(text):
        return client.get(
            f"{API}/receipts/guess-category", headers=ada, params={"text": text}
        ).json()["category"]

    assert guess("Dinner at Nopa") == "dining"
    assert guess("Electricity bill") == "utilities"
    assert guess("Birthday gift") == "other"
