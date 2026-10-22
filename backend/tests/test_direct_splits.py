"""Splitting straight with a friend: no group name, and the same people
always land on the same tab so the balance keeps one running total."""

import pytest
from fastapi.testclient import TestClient

from app.db.session import get_db
from app.main import app
from app.models import Receipt

API = "/api/v1"


@pytest.fixture()
def client(db_session):
    app.dependency_overrides[get_db] = lambda: db_session
    yield TestClient(app)
    app.dependency_overrides.clear()


def _register(client, email="ada@x.com"):
    token = client.post(
        f"{API}/auth/register",
        json={"email": email, "password": "pw12345", "full_name": "Ada"},
    ).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    return headers, client.get(f"{API}/auth/me", headers=headers).json()["id"]


def _receipt(db, user_id, total):
    receipt = Receipt(
        user_id=user_id,
        merchant="Costco",
        total=total,
        subtotal=total,
        status="extracted",
    )
    db.add(receipt)
    db.commit()
    return receipt


def test_a_friend_split_needs_no_name_and_reuses_the_same_tab(client, db_session):
    headers, uid = _register(client)
    first = client.post(
        f"{API}/splits/direct",
        headers=headers,
        json={"my_name": "Ada", "members": [{"name": "Ben"}]},
    )
    assert first.status_code == 200, first.text
    tab = first.json()
    assert tab["kind"] == "direct" and tab["name"] == "You & Ben"
    assert [m["name"] for m in tab["members"]] == ["Ada", "Ben"]

    for total in (20, 10):
        receipt = _receipt(db_session, uid, total)
        out = client.post(
            f"{API}/splits/groups/{tab['id']}/splits",
            headers=headers,
            json={"receipt_id": receipt.id, "paid_by": "Ada", "mode": "even"},
        )
        assert out.status_code == 200, out.text

    again = client.post(
        f"{API}/splits/direct",
        headers=headers,
        json={"my_name": "Ada", "members": [{"name": " ben "}]},
    ).json()
    assert again["id"] == tab["id"]

    summary = client.get(
        f"{API}/splits/groups/{tab['id']}/summary", headers=headers
    ).json()
    assert summary["kind"] == "direct"
    row = summary["suggested_settlements"][0]
    assert (row["from"], row["to"], row["amount"]) == ("Ben", "Ada", 15.0)


def test_a_combo_of_friends_is_its_own_tab(client):
    headers, _ = _register(client)
    duo = client.post(
        f"{API}/splits/direct",
        headers=headers,
        json={"my_name": "Ada", "members": [{"name": "Ben"}, {"name": "Cara"}]},
    ).json()
    assert duo["name"] == "Ben & Cara"
    solo = client.post(
        f"{API}/splits/direct",
        headers=headers,
        json={"my_name": "Ada", "members": [{"name": "Ben"}]},
    ).json()
    assert solo["id"] != duo["id"]
    listed = client.get(f"{API}/splits/groups", headers=headers).json()
    assert {g["kind"] for g in listed} == {"direct"}


def test_named_groups_are_still_groups(client):
    headers, _ = _register(client)
    group = client.post(
        f"{API}/splits/groups",
        headers=headers,
        json={"name": "Flat 4B", "my_name": "Ada", "members": ["Ben"]},
    ).json()
    assert group["kind"] == "group"
    direct = client.post(
        f"{API}/splits/direct",
        headers=headers,
        json={"my_name": "Ada", "members": [{"name": "Ben"}]},
    ).json()
    assert direct["id"] != group["id"]


def test_someone_to_split_with_is_required(client):
    headers, _ = _register(client)
    out = client.post(
        f"{API}/splits/direct",
        headers=headers,
        json={"my_name": "Ada", "members": [{"name": " "}, {"name": "ada"}]},
    )
    assert out.status_code == 400
