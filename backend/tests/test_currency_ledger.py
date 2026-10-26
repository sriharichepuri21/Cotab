"""A tab with receipts in two currencies: balances, suggested payments,
recorded payments and net balances stay per currency, never added up."""

import pytest
from fastapi.testclient import TestClient

from app.db.session import get_db
from app.main import app
from app.models import Receipt, Settlement
from app.services import split_service

API = "/api/v1/splits"


@pytest.fixture()
def tab(db_session):
    app.dependency_overrides[get_db] = lambda: db_session
    client = TestClient(app)
    token = client.post(
        "/api/v1/auth/register",
        json={"email": "ada@x.com", "password": "pw12345", "full_name": "Ada"},
    ).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    me = client.get("/api/v1/auth/me", headers=headers).json()["id"]
    group = client.post(
        f"{API}/groups",
        headers=headers,
        json={"name": "Trip", "my_name": "Ada", "members": [{"name": "Ben"}]},
    ).json()

    def spend(total, currency):
        receipt = Receipt(
            user_id=me,
            merchant="Shop",
            total=total,
            subtotal=total,
            status="extracted",
            currency=currency,
        )
        db_session.add(receipt)
        db_session.commit()
        out = client.post(
            f"{API}/groups/{group['id']}/splits",
            headers=headers,
            json={"receipt_id": receipt.id, "paid_by": "Ada", "mode": "even"},
        )
        assert out.status_code == 200, out.text

    spend(40, "USD")  # Ben owes $20
    spend(30, "EUR")  # Ben owes €15
    spend(10, "EUR")  # and €5 more
    yield client, headers, group, db_session
    app.dependency_overrides.clear()


def _summary(client, headers, group):
    return client.get(f"{API}/groups/{group['id']}/summary", headers=headers).json()


def test_what_ben_owes_is_one_row_per_currency(tab):
    client, headers, group, _ = tab
    summary = _summary(client, headers, group)
    owed = {
        (r["from"], r["currency"]): r["amount"]
        for r in summary["suggested_settlements"]
    }
    assert owed == {("Ben", "EUR"): 20.0, ("Ben", "USD"): 20.0}
    # The main currency (most receipts) comes first.
    assert summary["currency"] == "EUR"
    assert summary["suggested_settlements"][0]["currency"] == "EUR"
    assert summary["total_spend"] == 40.0
    assert summary["totals"] == [
        {"currency": "EUR", "amount": 40.0},
        {"currency": "USD", "amount": 40.0},
    ]


def test_net_balances_never_add_dollars_and_euros(tab):
    client, headers, _, _ = tab
    rows = client.get(f"{API}/net-balances", headers=headers).json()
    ben = {r["currency"]: r for r in rows if r["person"] == "Ben"}
    assert set(ben) == {"USD", "EUR"}
    assert ben["USD"]["amount"] == 20.0 and ben["EUR"]["amount"] == 20.0
    assert all(r["direction"] == "owes_you" for r in ben.values())


def test_a_payment_settles_only_its_own_currency(tab):
    client, headers, group, _ = tab
    members = {m["name"]: m["id"] for m in _summary(client, headers, group)["members"]}
    out = client.post(
        f"{API}/groups/{group['id']}/settlements",
        headers=headers,
        json={
            "from_member_id": members["Ben"],
            "to_member_id": members["Ada"],
            "amount": 20,
            "currency": "USD",
        },
    )
    assert out.status_code == 200, out.text
    rows = out.json()["suggested_settlements"]
    assert [(r["currency"], r["amount"]) for r in rows] == [("EUR", 20.0)]
    assert out.json()["settlements"][0]["currency"] == "USD"


def test_a_payment_without_a_currency_is_in_the_main_one(tab):
    client, headers, group, db = tab
    members = {m["name"]: m["id"] for m in _summary(client, headers, group)["members"]}
    # Tabby records payments without a currency.
    db.add(
        Settlement(
            group_id=group["id"],
            from_member_id=members["Ben"],
            to_member_id=members["Ada"],
            amount=5,
        )
    )
    db.commit()
    assert db.query(Settlement).one().currency == "EUR"
    left = {
        r["currency"]: r["amount"]
        for r in split_service.simplify_debts(db, group["id"])
    }
    assert left == {"EUR": 15.0, "USD": 20.0}


def test_a_payment_in_a_currency_the_tab_does_not_use_is_refused(tab):
    client, headers, group, _ = tab
    members = {m["name"]: m["id"] for m in _summary(client, headers, group)["members"]}
    out = client.post(
        f"{API}/groups/{group['id']}/settlements",
        headers=headers,
        json={
            "from_member_id": members["Ben"],
            "to_member_id": members["Ada"],
            "amount": 5,
            "currency": "GBP",
        },
    )
    assert out.status_code == 400
    bad = client.post(
        f"{API}/groups/{group['id']}/settlements",
        headers=headers,
        json={
            "from_member_id": members["Ben"],
            "to_member_id": members["Ada"],
            "amount": 5,
            "currency": "euro",
        },
    )
    assert bad.status_code == 422


def test_pay_links_are_built_for_each_rows_currency(tab):
    client, headers, group, _ = tab
    saved = client.put(
        "/api/v1/auth/me/pay-handles",
        headers=headers,
        json={"venmo": "ada-v", "paypal": "adapp"},
    )
    assert saved.status_code == 200, saved.text
    rows = {
        r["currency"]: {link["method"]: link["url"] for link in r["pay_links"]}
        for r in _summary(client, headers, group)["suggested_settlements"]
    }
    # Venmo only moves dollars; PayPal is asked for the row's own currency.
    assert "venmo" in rows["USD"] and "venmo" not in rows["EUR"]
    assert rows["EUR"]["paypal"].endswith("20.00EUR")
    assert rows["USD"]["paypal"].endswith("20.00USD")


def test_cents_never_drift_across_many_small_shares(db_session):
    from app.models import ReceiptSplit, SplitGroup, SplitMember, SplitShare

    group = SplitGroup(name="Coffee", owner_id="u", share_code="c" * 32)
    db_session.add(group)
    db_session.flush()
    ada = SplitMember(group_id=group.id, name="Ada")
    ben = SplitMember(group_id=group.id, name="Ben")
    db_session.add_all([ada, ben])
    db_session.flush()
    for i in range(30):
        receipt = Receipt(user_id="u", merchant="Cafe", total=0.2, currency="USD")
        db_session.add(receipt)
        db_session.flush()
        split = ReceiptSplit(
            group_id=group.id, receipt_id=receipt.id, paid_by_member_id=ada.id
        )
        db_session.add(split)
        db_session.flush()
        db_session.add(SplitShare(split_id=split.id, member_id=ben.id, amount=0.1))
    db_session.commit()
    (row,) = split_service.simplify_debts(db_session, group.id)
    assert row["amount"] == 3.0 and row["currency"] == "USD"
