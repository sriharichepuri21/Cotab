"""Fixing a split once it's saved: a corrected total, a redo, a removal; and
hearing when a friend marks a payment."""

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.db.session import get_db
from app.main import app
from app.models import ReceiptLineItem
from app.services import notify, scan_service
from tests.test_direct_splits import _receipt
from tests.test_notifications import API, _account, _lake_trip, _uid


@pytest.fixture()
def client(db_session):
    app.dependency_overrides[get_db] = lambda: db_session
    yield TestClient(app)
    app.dependency_overrides.clear()


def _trip_with_split(client, db, total=77.0):
    ada = _account(client, "ada@x.com", "Ada", "212-555-0100")
    ben = _account(client, "ben@x.com", "Ben", "415-555-0199")
    tab = _lake_trip(client, ada, {"name": "Ben", "phone": "415-555-0199"})
    receipt = _receipt(db, _uid(db, "ada@x.com"), total)
    client.post(
        f"{API}/splits/groups/{tab['id']}/splits",
        headers=ada,
        json={"receipt_id": receipt.id, "paid_by": "Ada", "mode": "even"},
    )
    notify.emailed.clear()
    return ada, ben, tab, receipt


def _summary(client, headers, tab):
    return client.get(
        f"{API}/splits/groups/{tab['id']}/summary", headers=headers
    ).json()


def test_correcting_the_total_redoes_the_shares_and_tells_friends(client, db_session):
    ada, ben, tab, receipt = _trip_with_split(client, db_session)
    out = client.post(
        f"{API}/receipts/{receipt.id}/review", headers=ada, json={"total": 17}
    )
    assert out.status_code == 200, out.text

    (split,) = _summary(client, ben, tab)["splits"]
    assert split["total"] == 17 and split["shares"] == [
        {"member": "Ben", "amount": 8.5, "settled": False}
    ]
    assert split["mine"] is False and _summary(client, ada, tab)["splits"][0]["mine"]
    (mail,) = notify.emailed
    assert mail["subject"] == "Ada changed Costco on Lake trip"
    assert mail["text"].startswith("$17.00 in all. Your share: $8.50.")


def _itemized(client, db):
    """Ada's milk ($10) and Ben's eggs ($20) on Lake trip, with the database
    refusing to drop items a split points at, as Postgres does."""
    db.execute(text("PRAGMA foreign_keys=ON"))
    ada = _account(client, "ada@x.com", "Ada", "212-555-0100")
    tab = _lake_trip(client, ada, {"name": "Ben"})
    receipt = _receipt(db, _uid(db, "ada@x.com"), 30.0)
    line = dict(receipt_id=receipt.id, user_id=receipt.user_id, quantity=1)
    milk = ReceiptLineItem(description="Milk", total_price=10, **line)
    eggs = ReceiptLineItem(description="Eggs", total_price=20, **line)
    db.add_all([milk, eggs])
    db.commit()
    client.post(
        f"{API}/splits/groups/{tab['id']}/splits",
        headers=ada,
        json={
            "receipt_id": receipt.id,
            "paid_by": "Ada",
            "mode": "itemized",
            "assignments": {"Ada": [milk.id], "Ben": [eggs.id]},
        },
    )
    return ada, tab, receipt, milk, eggs


def _line(item, price):
    return {
        "id": item.id,
        "description": item.description,
        "quantity": 1,
        "unit_price": price,
        "total_price": price,
    }


def _bens_share(client, ada, tab):
    return _summary(client, ada, tab)["splits"][0]["shares"][0]["amount"]


def test_an_itemized_split_follows_a_corrected_total(client, db_session):
    ada, tab, receipt, *_ = _itemized(client, db_session)
    # A $3 tip left off: everyone's part of it goes up in proportion.
    client.post(f"{API}/receipts/{receipt.id}/review", headers=ada, json={"total": 33})
    assert _bens_share(client, ada, tab) == 22.0


def test_fixing_an_item_keeps_who_had_it(client, db_session):
    ada, tab, receipt, milk, eggs = _itemized(client, db_session)
    out = client.post(
        f"{API}/receipts/{receipt.id}/review",
        headers=ada,
        json={"total": 36, "line_items": [_line(milk, 10), _line(eggs, 26)]},
    )
    assert out.status_code == 200, out.text
    assert _bens_share(client, ada, tab) == 26.0
    # Edit split starts from these picks.
    split = _summary(client, ada, tab)["splits"][0]
    assert split["items"] == {"Ada": [milk.id], "Ben": [eggs.id]}

    # Eggs taken off the receipt: Ben owes nothing for it any more.
    out = client.post(
        f"{API}/receipts/{receipt.id}/review",
        headers=ada,
        json={"total": 10, "line_items": [_line(milk, 10)]},
    )
    assert out.status_code == 200, out.text
    assert _bens_share(client, ada, tab) == 0


def test_an_edit_sent_without_line_ids_still_keeps_who_had_what(client, db_session):
    """Older copies of the app send lines without their ids."""
    ada, tab, receipt, milk, eggs = _itemized(client, db_session)
    lines = [_line(milk, 10), _line(eggs, 26)]
    for line in lines:
        del line["id"]
    out = client.post(
        f"{API}/receipts/{receipt.id}/review",
        headers=ada,
        json={"total": 36, "line_items": lines},
    )
    assert out.status_code == 200, out.text
    assert _bens_share(client, ada, tab) == 26.0


def test_reading_a_split_receipt_again_keeps_who_had_what(client, db_session):
    """Scanned again (or its emailed copy arrived): new item rows, same picks."""
    ada, tab, receipt, *_ = _itemized(client, db_session)
    notify.emailed.clear()

    def item(name, price):
        return SimpleNamespace(
            description=name, quantity=1, unit_price=price, total_price=price
        )

    reading = SimpleNamespace(
        merchant="Costco",
        merchant_raw="COSTCO",
        total=34.0,
        subtotal=34.0,
        tax=0,
        currency="USD",
        category="groceries",
        confidence=0.9,
        extraction_method="ai",
        date=None,
        # Eggs read as $24 this time, and a bag nobody picked.
        line_items=[item("Milk", 10), item("Eggs", 24), item("Bag", 0)],
    )
    changed = scan_service.apply_extraction(
        db_session, receipt, receipt.user_id, reading
    )
    db_session.commit()
    notify.splits_changed(db_session, receipt, receipt.user_id, changed)

    assert _bens_share(client, ada, tab) == 24.0
    assert db_session.query(ReceiptLineItem).count() == 3
    assert notify.emailed == []  # Ben isn't on Cotab
    assert len(changed) == 1


def test_an_edit_that_changes_no_share_tells_no_one(client, db_session):
    ada, ben, tab, receipt = _trip_with_split(client, db_session)
    client.post(
        f"{API}/receipts/{receipt.id}/review", headers=ada, json={"category": "travel"}
    )
    assert notify.emailed == []


def test_a_redo_replaces_the_split(client, db_session):
    ada, ben, tab, receipt = _trip_with_split(client, db_session)
    url = f"{API}/splits/groups/{tab['id']}/splits"
    again = {"receipt_id": receipt.id, "paid_by": "Ben", "mode": "even"}
    assert client.post(url, headers=ada, json=again).status_code == 409

    out = client.post(url, headers=ada, json={**again, "replace": True})
    assert out.status_code == 200, out.text
    (split,) = _summary(client, ada, tab)["splits"]
    assert split["paid_by"] == "Ben"
    assert notify.emailed[0]["subject"] == "Ada changed Costco on Lake trip"


def test_removing_a_split(client, db_session):
    ada, ben, tab, receipt = _trip_with_split(client, db_session)
    split_id = _summary(client, ada, tab)["splits"][0]["split_id"]
    url = f"{API}/splits/groups/{tab['id']}/splits/{split_id}"

    refused = client.delete(url, headers=ben)
    assert refused.status_code == 403
    out = client.delete(url, headers=ada)
    assert out.status_code == 200, out.text
    assert out.json()["splits"] == [] and out.json()["suggested_settlements"] == []
    (mail,) = notify.emailed
    assert mail["subject"] == "Ada removed Costco from Lake trip"
    assert client.delete(url, headers=ada).status_code == 404


def _pay(client, headers, tab, summary):
    row = summary["suggested_settlements"][0]
    return client.post(
        f"{API}/splits/groups/{tab['id']}/settlements",
        headers=headers,
        json={
            "from_member_id": row["from_id"],
            "to_member_id": row["to_id"],
            "amount": row["amount"],
        },
    )


def test_ben_marking_he_paid_tells_ada(client, db_session):
    ada, ben, tab, _ = _trip_with_split(client, db_session)
    assert _pay(client, ben, tab, _summary(client, ben, tab)).status_code == 200
    (mail,) = notify.emailed
    assert mail["to"] == "ada@x.com"
    assert mail["subject"] == "Ben paid you $38.50"


def test_ada_marking_ben_paid_tells_ben(client, db_session):
    ada, ben, tab, _ = _trip_with_split(client, db_session)
    _pay(client, ada, tab, _summary(client, ada, tab))
    (mail,) = notify.emailed
    assert mail["to"] == "ben@x.com"
    assert mail["subject"] == "Ada marked that you paid them $38.50"


def test_a_retried_payment_is_recorded_once(client, db_session):
    """The same tap arriving twice (a flaky network, a double tap) is one payment."""
    ada, ben, tab, _ = _trip_with_split(client, db_session)
    row = _summary(client, ben, tab)["suggested_settlements"][0]
    body = {
        "from_member_id": row["from_id"],
        "to_member_id": row["to_id"],
        "amount": row["amount"],
        "idempotency_key": "tap-0123456789",
    }
    url = f"{API}/splits/groups/{tab['id']}/settlements"
    first = client.post(url, headers=ben, json=body)
    again = client.post(url, headers=ben, json=body)
    assert first.status_code == again.status_code == 200
    assert len(again.json()["settlements"]) == 1
    assert len(notify.emailed) == 1  # Ada is told once, not twice
    # A new tap (a new key) is a new payment.
    other = client.post(
        url, headers=ben, json={**body, "idempotency_key": "tap-new-0001"}
    )
    assert len(other.json()["settlements"]) == 2
