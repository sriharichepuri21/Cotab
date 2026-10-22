"""Pay links, recorded settlements, shared tabs people can join, and split previews."""

import pytest
from fastapi.testclient import TestClient

from app.db.session import get_db
from app.main import app
from app.models import Receipt, ReceiptLineItem, SplitMember
from app.services import pay_links

API = "/api/v1"


# ---------- handles and links ----------


def test_handles_are_cleaned_and_bad_ones_rejected():
    assert pay_links.clean_handles(
        {
            "venmo": "@ada-lovelace",
            "cashapp": "$AdaL",
            "paypal": "https://paypal.me/adal/",
            "zelle": " ",
        }
    ) == {"venmo": "ada-lovelace", "cashapp": "AdaL", "paypal": "adal"}
    with pytest.raises(pay_links.HandleError):
        pay_links.clean_handles({"venmo": "a b"})
    with pytest.raises(pay_links.HandleError):
        pay_links.clean_handles({"zelle": "not a contact"})
    assert pay_links.clean_handles({"zelle": "+1 (415) 555-0142"}) == {
        "zelle": "+1 (415) 555-0142"
    }


def test_links_fill_in_the_amount_and_skip_usd_only_apps_for_other_currencies():
    handles = {
        "venmo": "ada-l",
        "paypal": "adal",
        "cashapp": "AdaL",
        "zelle": "ada@x.com",
    }
    usd = {
        link["method"]: link
        for link in pay_links.links(handles, 12.5, "Cotab: Flat 4B")
    }
    assert (
        usd["venmo"]["url"]
        == "https://venmo.com/ada-l?txn=pay&amount=12.50&note=Cotab%3A+Flat+4B"
    )
    assert usd["paypal"]["url"] == "https://paypal.me/adal/12.50USD"
    assert usd["cashapp"]["url"] == "https://cash.app/$AdaL/12.50"
    assert usd["zelle"] == {
        "method": "zelle",
        "label": "Zelle",
        "url": None,
        "copy": "ada@x.com",
    }
    eur = [link["method"] for link in pay_links.links(handles, 5, "x", "EUR")]
    assert eur == ["paypal", "zelle"]


# ---------- the API flow ----------


@pytest.fixture()
def client(db_session):
    app.dependency_overrides[get_db] = lambda: db_session
    yield TestClient(app)
    app.dependency_overrides.clear()


def _register(client, email, name):
    token = client.post(
        f"{API}/auth/register",
        json={"email": email, "password": "pw12345", "full_name": name},
    ).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    return headers, client.get(f"{API}/auth/me", headers=headers).json()["id"]


def _receipt(db, user_id, total, merchant="Costco", currency="USD"):
    receipt = Receipt(
        user_id=user_id,
        merchant=merchant,
        total=total,
        subtotal=total,
        status="extracted",
        currency=currency,
    )
    db.add(receipt)
    db.commit()
    return receipt


def _tab(client, db, headers, user_id):
    group = client.post(
        f"{API}/splits/groups",
        headers=headers,
        json={
            "name": "Flat 4B",
            "my_name": "Ada",
            "members": [{"name": "Ben", "email": "ben@example.com"}, "Cara"],
        },
    ).json()
    receipt = _receipt(db, user_id, 30)
    assert (
        client.post(
            f"{API}/splits/groups/{group['id']}/splits",
            headers=headers,
            json={"receipt_id": receipt.id, "paid_by": "Ada", "mode": "even"},
        ).status_code
        == 200
    )
    return group


def test_pay_links_point_at_the_person_being_paid(client, db_session):
    ada, ada_id = _register(client, "ada@example.com", "Ada")
    group = _tab(client, db_session, ada, ada_id)

    bad = client.put(
        f"{API}/auth/me/pay-handles", headers=ada, json={"venmo": "no spaces"}
    )
    assert bad.status_code == 400
    saved = client.put(
        f"{API}/auth/me/pay-handles",
        headers=ada,
        json={"venmo": "@ada-l", "zelle": "ada@example.com"},
    )
    assert saved.json() == {"venmo": "ada-l", "zelle": "ada@example.com"}
    assert client.get(f"{API}/auth/me/pay-handles", headers=ada).json() == saved.json()

    summary = client.get(
        f"{API}/splits/groups/{group['id']}/summary", headers=ada
    ).json()
    rows = summary["suggested_settlements"]
    assert {(r["from"], r["to"], r["amount"]) for r in rows} == {
        ("Ben", "Ada", 10.0),
        ("Cara", "Ada", 10.0),
    }
    venmo = next(x for x in rows[0]["pay_links"] if x["method"] == "venmo")
    assert venmo["url"].startswith("https://venmo.com/ada-l?txn=pay&amount=10.00")

    # The public link keeps Venmo but never shows Zelle (an email) or emails.
    public = client.get(f"{API}/splits/share/{group['share_code']}").json()
    assert all(
        link["method"] != "zelle"
        for r in public["suggested_settlements"]
        for link in r["pay_links"]
    )
    assert all("email" not in m for m in public["members"])


def test_friends_without_accounts_can_be_given_handles(client, db_session):
    ada, ada_id = _register(client, "ada@example.com", "Ada")
    group = _tab(client, db_session, ada, ada_id)
    cara = next(m for m in group["members"] if m["name"] == "Cara")
    ok = client.put(
        f"{API}/splits/groups/{group['id']}/members/{cara['id']}/pay-handles",
        headers=ada,
        json={"cashapp": "$cara"},
    )
    assert ok.json() == {"cashapp": "cara"}
    summary = client.get(
        f"{API}/splits/groups/{group['id']}/summary", headers=ada
    ).json()
    assert next(m for m in summary["members"] if m["name"] == "Cara")[
        "pay_methods"
    ] == ["cashapp"]


def test_settling_up_pays_down_the_debt_and_can_be_undone(client, db_session):
    ada, ada_id = _register(client, "ada@example.com", "Ada")
    group = _tab(client, db_session, ada, ada_id)
    ids = {m["name"]: m["id"] for m in group["members"]}

    after = client.post(
        f"{API}/splits/groups/{group['id']}/settlements",
        headers=ada,
        json={
            "from_member_id": ids["Ben"],
            "to_member_id": ids["Ada"],
            "amount": 10,
            "method": "venmo",
        },
    ).json()
    assert [(r["from"], r["amount"]) for r in after["suggested_settlements"]] == [
        ("Cara", 10.0)
    ]
    assert after["settlements"][0]["method"] == "venmo"
    net = {
        r["person"]: r
        for r in client.get(f"{API}/splits/net-balances", headers=ada).json()
    }
    assert net["Ben"]["direction"] == "settled" and net["Cara"]["amount"] == 10

    undone = client.delete(
        f"{API}/splits/groups/{group['id']}/settlements/{after['settlements'][0]['id']}",
        headers=ada,
    ).json()
    assert len(undone["suggested_settlements"]) == 2 and undone["settlements"] == []

    for body in (
        {"from_member_id": ids["Ben"], "to_member_id": ids["Ben"], "amount": 5},
        {"from_member_id": ids["Ben"], "to_member_id": ids["Ada"], "amount": 0},
        {"from_member_id": "nobody", "to_member_id": ids["Ada"], "amount": 5},
    ):
        assert (
            client.post(
                f"{API}/splits/groups/{group['id']}/settlements", headers=ada, json=body
            ).status_code
            == 400
        )


def test_friends_join_a_shared_tab_and_add_their_own_receipts(client, db_session):
    ada, ada_id = _register(client, "ada@example.com", "Ada")
    group = _tab(client, db_session, ada, ada_id)
    ids = {m["name"]: m["id"] for m in group["members"]}
    ben, ben_id = _register(client, "ben@example.com", "Ben B")
    stranger, _ = _register(client, "eve@example.com", "Eve")

    # Before joining, Ben can't see the tab.
    assert (
        client.get(
            f"{API}/splits/groups/{group['id']}/summary", headers=ben
        ).status_code
        == 404
    )

    joined = client.post(
        f"{API}/splits/join/{group['share_code']}",
        headers=ben,
        json={"member_id": ids["Ben"]},
    )
    assert joined.json() == {"group_id": group["id"], "member_id": ids["Ben"]}
    # Joining twice is harmless; taking someone else's place is not allowed.
    assert (
        client.post(
            f"{API}/splits/join/{group['share_code']}", headers=ben, json={}
        ).json()["member_id"]
        == ids["Ben"]
    )
    taken = client.post(
        f"{API}/splits/join/{group['share_code']}",
        headers=stranger,
        json={"member_id": ids["Ben"]},
    )
    assert taken.status_code == 409

    tabs = client.get(f"{API}/splits/groups", headers=ben).json()
    assert [(t["name"], t["is_owner"]) for t in tabs] == [("Flat 4B", False)]
    summary = client.get(
        f"{API}/splits/groups/{group['id']}/summary", headers=ben
    ).json()
    assert summary["me"] == ids["Ben"] and summary["is_owner"] is False
    assert all(
        m["email"] is None for m in summary["members"]
    )  # only the owner sees emails

    # Ben adds his own $9 receipt; the tab nets everything to the fewest payments.
    mine = _receipt(db_session, ben_id, 9, merchant="Pizza")
    added = client.post(
        f"{API}/splits/groups/{group['id']}/splits",
        headers=ben,
        json={"receipt_id": mine.id, "paid_by": "Ben", "mode": "even"},
    )
    assert added.status_code == 200
    rows = client.get(f"{API}/splits/groups/{group['id']}/summary", headers=ben).json()[
        "suggested_settlements"
    ]
    # Ada +20 from the $30, Ben +6 from his $9: Ada is owed 17, Ben owes 4, Cara 13.
    assert sorted((r["from"], r["to"], r["amount"]) for r in rows) == [
        ("Ben", "Ada", 4.0),
        ("Cara", "Ada", 13.0),
    ]

    # Ada's balances include Ben's receipt too.
    net = {
        r["person"]: r["net"]
        for r in client.get(f"{API}/splits/net-balances", headers=ada).json()
    }
    assert net["Ben"] == 7.0

    # Ben can't add Ada's receipt; Ada can't be impersonated by a stranger.
    adas = _receipt(db_session, ada_id, 20)
    assert (
        client.post(
            f"{API}/splits/groups/{group['id']}/splits",
            headers=ben,
            json={"receipt_id": adas.id, "paid_by": "Ben", "mode": "even"},
        ).status_code
        == 404
    )

    # Joining as someone new picks an unused name.
    new = client.post(
        f"{API}/splits/join/{group['share_code']}", headers=stranger, json={}
    ).json()
    member = db_session.get(SplitMember, new["member_id"])
    assert member.name == "Eve" and member.user_id is not None


def test_joined_people_use_their_own_handles(client, db_session):
    ada, ada_id = _register(client, "ada@example.com", "Ada")
    group = _tab(client, db_session, ada, ada_id)
    ids = {m["name"]: m["id"] for m in group["members"]}
    ben, _ = _register(client, "ben@example.com", "Ben")
    client.post(
        f"{API}/splits/join/{group['share_code']}",
        headers=ben,
        json={"member_id": ids["Ben"]},
    )
    blocked = client.put(
        f"{API}/splits/groups/{group['id']}/members/{ids['Ben']}/pay-handles",
        headers=ada,
        json={"venmo": "bennnn"},
    )
    assert blocked.status_code == 409
    client.put(f"{API}/auth/me/pay-handles", headers=ben, json={"paypal": "benb"})
    summary = client.get(
        f"{API}/splits/groups/{group['id']}/summary", headers=ada
    ).json()
    assert next(m for m in summary["members"] if m["name"] == "Ben")["pay_methods"] == [
        "paypal"
    ]


def test_adding_people_rejects_duplicates(client, db_session):
    ada, ada_id = _register(client, "ada@example.com", "Ada")
    group = _tab(client, db_session, ada, ada_id)
    url = f"{API}/splits/groups/{group['id']}/members"
    assert client.post(url, headers=ada, json={"name": "cara"}).status_code == 409
    names = [
        m["name"]
        for m in client.post(url, headers=ada, json={"name": "Dev"}).json()["members"]
    ]
    assert names == ["Ada", "Ben", "Cara", "Dev"]


def test_preview_shows_each_persons_share_before_saving(client, db_session):
    ada, ada_id = _register(client, "ada@example.com", "Ada")
    receipt = _receipt(db_session, ada_id, 33, merchant="Steakhouse")
    steak = ReceiptLineItem(
        receipt_id=receipt.id, user_id=ada_id, description="Steak", total_price=20
    )
    salad = ReceiptLineItem(
        receipt_id=receipt.id, user_id=ada_id, description="Salad", total_price=10
    )
    db_session.add_all([steak, salad])
    db_session.commit()
    body = {
        "receipt_id": receipt.id,
        "members": ["Ada", "Alex"],
        "paid_by": "Ada",
        "mode": "itemized",
        "assignments": {"Alex": [steak.id], "Ada": [salad.id]},
    }
    out = client.post(f"{API}/splits/preview", headers=ada, json=body).json()
    assert out["shares"] == {
        "Ada": 11.0,
        "Alex": 22.0,
    }  # $3 tax and tip shared by item value
    assert out["extra"] == 3.0
    even = client.post(
        f"{API}/splits/preview", headers=ada, json={**body, "tax_mode": "even"}
    ).json()
    assert even["shares"] == {"Ada": 11.5, "Alex": 21.5}
    other, _ = _register(client, "eve@example.com", "Eve")
    assert (
        client.post(f"{API}/splits/preview", headers=other, json=body).status_code
        == 404
    )


def test_deleting_an_account_unlinks_it_from_tabs_it_joined(client, db_session):
    ada, ada_id = _register(client, "ada@example.com", "Ada")
    group = _tab(client, db_session, ada, ada_id)
    ids = {m["name"]: m["id"] for m in group["members"]}
    ben, _ = _register(client, "ben@example.com", "Ben")
    client.post(
        f"{API}/splits/join/{group['share_code']}",
        headers=ben,
        json={"member_id": ids["Ben"]},
    )
    client.put(f"{API}/auth/me/pay-handles", headers=ben, json={"paypal": "benb"})
    assert client.post(
        f"{API}/auth/delete-account", headers=ben, json={"password": "pw12345"}
    ).status_code in (200, 204)
    summary = client.get(
        f"{API}/splits/groups/{group['id']}/summary", headers=ada
    ).json()
    ben_row = next(m for m in summary["members"] if m["name"] == "Ben")
    assert ben_row["joined"] is False and ben_row["pay_methods"] == []
