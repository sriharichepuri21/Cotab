"""Spending is your share: what a purchase cost you once it's split."""

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.db.session import get_db
from app.main import app
from app.models import Receipt, ReceiptLineItem
from app.services import budget_service, my_share, quick_answers
from tests.test_notifications import API, _account, _uid


@pytest.fixture()
def client(db_session):
    app.dependency_overrides[get_db] = lambda: db_session
    yield TestClient(app)
    app.dependency_overrides.clear()


def _bought(db, owner_id, total, items=(), merchant="Costco", category="groceries"):
    receipt = Receipt(
        user_id=owner_id,
        merchant=merchant,
        category=category,
        total=total,
        subtotal=total,
        status="reviewed",
        purchased_at=datetime.now(timezone.utc),
    )
    db.add(receipt)
    db.flush()
    for name, price in items:
        db.add(
            ReceiptLineItem(
                receipt_id=receipt.id,
                user_id=owner_id,
                description=name,
                quantity=1,
                total_price=price,
            )
        )
    db.commit()
    return receipt


@pytest.fixture()
def trip(client, db_session):
    """Ada, Ben and Cara on Lake trip; Ben and Cara use Cotab too."""
    ada = _account(client, "ada@x.com", "Ada", "212-555-0100")
    ben = _account(client, "ben@x.com", "Ben", "415-555-0199")
    cara = _account(client, "cara@x.com", "Cara", "646-555-0177")
    tab = client.post(
        f"{API}/splits/groups",
        headers=ada,
        json={
            "name": "Lake trip",
            "my_name": "Ada",
            "members": [
                {"name": "Ben", "phone": "415-555-0199"},
                {"name": "Cara", "phone": "646-555-0177"},
            ],
        },
    ).json()
    people = {"ada": ada, "ben": ben, "cara": cara}
    ids = {name: _uid(db_session, f"{name}@x.com") for name in people}
    return tab, people, ids


def _split(client, headers, tab, receipt, paid_by, **how):
    out = client.post(
        f"{API}/splits/groups/{tab['id']}/splits",
        headers=headers,
        json={"receipt_id": receipt.id, "paid_by": paid_by, "mode": "even", **how},
    )
    assert out.status_code == 200, out.text
    return out.json()


def _spent(client, headers):
    return client.get(f"{API}/analytics/summary", headers=headers).json()["this_month"][
        "total_spent"
    ]


def test_a_dinner_you_paid_and_split_three_ways_counts_your_third(
    client, db_session, trip
):
    tab, people, ids = trip
    dinner = _bought(db_session, ids["ada"], 60, category="dining")
    _split(client, people["ada"], tab, dinner, "Ada")
    assert _spent(client, people["ada"]) == 20.0
    # Ben and Cara spent their share too, on Ada's receipt.
    assert _spent(client, people["ben"]) == 20.0
    assert _spent(client, people["cara"]) == 20.0


def test_an_expense_a_friend_paid_counts_your_share(client, db_session, trip):
    tab, people, ids = trip
    gas = _bought(db_session, ids["ben"], 40, merchant="Shell", category="transport")
    client.post(  # Ben's receipt, split with just Ada on their friend tab
        f"{API}/splits/direct",
        headers=people["ben"],
        json={"my_name": "Ben", "members": [{"name": "Ada", "phone": "212-555-0100"}]},
    )
    friend_tab = next(
        g
        for g in client.get(f"{API}/splits/groups", headers=people["ben"]).json()
        if g["kind"] == "direct"
    )
    _split(client, people["ben"], friend_tab, gas, "Ben")
    assert _spent(client, people["ada"]) == 20.0
    assert _spent(client, people["ben"]) == 20.0
    categories = client.get(f"{API}/analytics/summary", headers=people["ada"]).json()[
        "categories"
    ]
    assert categories[0]["name"] == "transport" and categories[0]["amount"] == 20.0


def test_your_receipt_a_friend_paid_counts_your_share(client, db_session, trip):
    """You uploaded it, Ben paid: you owe him your share, and that's your spend."""
    tab, people, ids = trip
    receipt = _bought(db_session, ids["ada"], 30)
    _split(client, people["ada"], tab, receipt, "Ben")
    assert _spent(client, people["ada"]) == 10.0
    assert _spent(client, people["ben"]) == 10.0


def test_settling_up_is_never_spending(client, db_session, trip):
    tab, people, ids = trip
    dinner = _bought(db_session, ids["ada"], 60, category="dining")
    _split(client, people["ada"], tab, dinner, "Ada")
    summary = client.get(
        f"{API}/splits/groups/{tab['id']}/summary", headers=people["ben"]
    ).json()
    row = next(r for r in summary["suggested_settlements"] if r["from"] == "Ben")
    paid = client.post(
        f"{API}/splits/groups/{tab['id']}/settlements",
        headers=people["ben"],
        json={
            "from_member_id": row["from_id"],
            "to_member_id": row["to_id"],
            "amount": row["amount"],
        },
    )
    assert paid.status_code == 200
    assert _spent(client, people["ben"]) == 20.0
    assert _spent(client, people["ada"]) == 20.0


def test_budgets_and_tabby_quick_answers_count_your_share(client, db_session, trip):
    tab, people, ids = trip
    dinner = _bought(db_session, ids["ada"], 60, category="dining")
    _split(client, people["ada"], tab, dinner, "Ada")
    for level, target in (("total", ""), ("category", "dining"), ("merchant", "cost")):
        client.post(
            f"{API}/budgets/",
            headers=people["ada"],
            json={"level": level, "target": target, "period": "monthly", "amount": 100},
        )
    spent = {
        s["level"]: s["spent"]
        for s in budget_service.evaluate_all(db_session, ids["ada"])
    }
    assert spent == {"total": 20.0, "category": 20.0, "merchant": 20.0}
    answer = quick_answers.try_answer(
        db_session, ids["ada"], "how much did i spend this month"
    )
    assert answer is not None and "$20.00" in answer.text


def test_item_budgets_count_your_share_of_shared_items(client, db_session, trip):
    tab, people, ids = trip
    milk, eggs = ("Milk", 10.0), ("Eggs", 20.0)
    # Split by item: Ada and Ben share the milk, Cara has the eggs.
    by_item = _bought(db_session, ids["ada"], 30, items=(milk, eggs))
    lines = {li.description: li.id for li in by_item.line_items}
    _split(
        client,
        people["ada"],
        tab,
        by_item,
        "Ada",
        mode="itemized",
        assignments={
            "Ada": [lines["Milk"]],
            "Ben": [lines["Milk"]],
            "Cara": [lines["Eggs"]],
        },
    )
    # Split evenly three ways: a third of every item each.
    evenly = _bought(db_session, ids["ada"], 30, items=(milk, eggs))
    _split(client, people["ada"], tab, evenly, "Ada")
    # Not split: all of it.
    _bought(db_session, ids["ada"], 10, items=(milk,))

    def milk_spend(name):
        return my_share.item_spend(
            db_session,
            my_share.spending(db_session, ids[name]),
            lambda text: "milk" in text.lower(),
        )

    assert milk_spend("ada") == round(5 + 10 / 3 + 10, 2)
    assert milk_spend("ben") == round(5 + 10 / 3, 2)
    assert milk_spend("cara") == round(10 / 3, 2)


def test_receipts_show_your_share_when_split(client, db_session, trip):
    tab, people, ids = trip
    split = _bought(db_session, ids["ada"], 77.57)
    alone = _bought(db_session, ids["ada"], 12.0, merchant="Blue Bottle")
    _split(client, people["ada"], tab, split, "Ada")
    listed = {
        r["id"]: r["my_share"]
        for r in client.get(f"{API}/receipts/", headers=people["ada"]).json()
    }
    assert listed == {split.id: 25.86, alone.id: None}  # 77.57 = 25.86 + 25.86 + 25.85
    one = client.get(f"{API}/receipts/{split.id}", headers=people["ada"]).json()
    assert one["total"] == 77.57 and one["my_share"] == 25.86
