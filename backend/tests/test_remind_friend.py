"""Remind a friend what they owe you, from the tab: Tabby emails them, or you
send a message yourself and the tab notes when."""

import pytest
from fastapi.testclient import TestClient

from app.db.session import get_db
from app.main import app
from tests.test_direct_splits import _receipt, _register

API = "/api/v1"


@pytest.fixture()
def client(db_session):
    app.dependency_overrides[get_db] = lambda: db_session
    yield TestClient(app)
    app.dependency_overrides.clear()


def _tab_ben_owes(client, db_session):
    headers, uid = _register(client)
    tab = client.post(
        f"{API}/splits/direct",
        headers=headers,
        json={"my_name": "Ada", "members": [{"name": "Ben"}]},
    ).json()
    receipt = _receipt(db_session, uid, 26.64)
    client.post(
        f"{API}/splits/groups/{tab['id']}/splits",
        headers=headers,
        json={"receipt_id": receipt.id, "paid_by": "Ada", "mode": "even"},
    )
    ben = next(m["id"] for m in tab["members"] if m["name"] == "Ben")
    return headers, tab["id"], ben


def test_a_message_reminder_is_noted_on_the_tab(client, db_session):
    headers, tab, ben = _tab_ben_owes(client, db_session)
    out = client.post(
        f"{API}/splits/groups/{tab}/remind",
        headers=headers,
        json={"member_id": ben, "channel": "message"},
    )
    assert out.status_code == 200, out.text
    assert out.json()["suggested_settlements"][0]["last_reminded_at"]


def test_a_push_reminder_opens_the_tab_on_their_phone(client, db_session):
    from app.models import SplitMember, User
    from app.services import push_service

    headers, tab, ben = _tab_ben_owes(client, db_session)
    url = f"{API}/splits/groups/{tab}/remind"
    nobody = client.post(
        url, headers=headers, json={"member_id": ben, "channel": "push"}
    )
    assert nobody.status_code == 409 and "notifications" in nobody.json()["detail"]

    friend = User(email="ben@x.com", hashed_password="x", full_name="Ben")
    db_session.add(friend)
    db_session.commit()
    db_session.get(SplitMember, ben).user_id = friend.id
    db_session.commit()
    push_service.subscribe(db_session, friend.id, "https://push.example/1", "p", "a")
    summary = client.get(f"{API}/splits/groups/{tab}/summary", headers=headers).json()
    assert next(m for m in summary["members"] if m["id"] == ben)["notify"] is True

    sent = client.post(url, headers=headers, json={"member_id": ben, "channel": "push"})
    assert sent.status_code == 200, sent.text
    note = push_service.sent[-1]
    assert note["user_id"] == friend.id
    assert note["body"].startswith("You owe Ada $13.32 on your tab with Ada")
    assert note["url"] == f"/app?tab=circles&group={tab}"
    again = client.post(
        url, headers=headers, json={"member_id": ben, "channel": "push"}
    )
    assert again.status_code == 409 and "today" in again.json()["detail"]


def test_you_can_only_remind_someone_who_owes_you(client, db_session):
    headers, tab, ben = _tab_ben_owes(client, db_session)
    summary = client.get(f"{API}/splits/groups/{tab}/summary", headers=headers).json()
    me = summary["me"]
    out = client.post(
        f"{API}/splits/groups/{tab}/remind",
        headers=headers,
        json={"member_id": me, "channel": "message"},
    )
    assert out.status_code == 400
