"""People hear about their tabs: a push to their phone, or an email when no
device of theirs has notifications on."""

import pytest
from fastapi.testclient import TestClient

from app.config.settings import get_settings
from app.db.session import get_db
from app.main import app
from app.models import User
from app.services import notify, push_service
from tests.test_direct_splits import _receipt

API = "/api/v1"


@pytest.fixture()
def client(db_session):
    app.dependency_overrides[get_db] = lambda: db_session
    yield TestClient(app)
    app.dependency_overrides.clear()


def _account(client, email, name, phone):
    token = client.post(
        f"{API}/auth/register",
        json={"email": email, "password": "Pw12345!", "full_name": name},
    ).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    client.put(f"{API}/auth/me/phone", headers=headers, json={"phone": phone})
    return headers


def _lake_trip(client, ada, *people):
    return client.post(
        f"{API}/splits/groups",
        headers=ada,
        json={"name": "Lake trip", "my_name": "Ada", "members": list(people)},
    ).json()


def _uid(db, email):
    return db.query(User).filter_by(email=email).one().id


def test_being_added_emails_you_when_you_have_no_notifications_on(client):
    ada = _account(client, "ada@x.com", "Ada", "212-555-0100")
    _account(client, "ben@x.com", "Ben", "415-555-0199")
    _lake_trip(client, ada, {"name": "Ben", "phone": "415-555-0199"})

    (mail,) = notify.emailed
    assert mail["to"] == "ben@x.com"
    assert mail["subject"] == "Ada added you to Lake trip"
    assert push_service.sent == []


def test_being_added_pushes_to_your_phone_instead(client, db_session):
    ada = _account(client, "ada@x.com", "Ada", "212-555-0100")
    _account(client, "ben@x.com", "Ben", "415-555-0199")
    push_service.subscribe(
        db_session, _uid(db_session, "ben@x.com"), "https://push/1", "k", "a"
    )
    tab = _lake_trip(client, ada, {"name": "Ben", "phone": "415-555-0199"})

    (push,) = push_service.sent
    assert push["title"] == "Ada added you to Lake trip"
    assert push["url"] == f"/app/groups/{tab['id']}"
    assert notify.emailed == []


def test_a_friend_tab_says_whose_it_is(client):
    ada = _account(client, "ada@x.com", "Ada", "212-555-0100")
    _account(client, "ben@x.com", "Ben", "415-555-0199")
    client.post(
        f"{API}/splits/direct",
        headers=ada,
        json={"my_name": "Ada", "members": [{"name": "Ben", "phone": "415-555-0199"}]},
    )
    assert notify.emailed[0]["subject"] == "Ada added you to your tab with Ada"


def test_nobody_hears_about_people_not_on_cotab_or_themselves(client):
    ada = _account(client, "ada@x.com", "Ada", "212-555-0100")
    _lake_trip(client, ada, {"name": "Dev", "phone": "917-555-0123"})
    assert notify.emailed == [] and push_service.sent == []


def test_a_new_split_tells_everyone_else_their_share(client, db_session):
    ada = _account(client, "ada@x.com", "Ada", "212-555-0100")
    _account(client, "ben@x.com", "Ben", "415-555-0199")
    tab = _lake_trip(client, ada, {"name": "Ben", "phone": "415-555-0199"})
    notify.emailed.clear()
    receipt = _receipt(db_session, _uid(db_session, "ada@x.com"), 30.0)

    out = client.post(
        f"{API}/splits/groups/{tab['id']}/splits",
        headers=ada,
        json={"receipt_id": receipt.id, "paid_by": "Ada", "mode": "even"},
    )
    assert out.status_code == 200, out.text
    (mail,) = notify.emailed
    assert mail["to"] == "ben@x.com"
    assert mail["subject"] == "Ada added Costco to Lake trip"
    assert mail["text"].startswith("$30.00 in all. Your share: $15.00.")


def test_signing_up_tells_the_people_who_added_you(client):
    ada = _account(client, "ada@x.com", "Ada", "212-555-0100")
    _lake_trip(client, ada, {"name": "Ben", "phone": "415-555-0199"})
    _account(client, "ben@x.com", "Ben", "415-555-0199")

    (mail,) = notify.emailed
    assert mail["to"] == "ada@x.com"
    assert mail["subject"] == "Ben joined Cotab"
    assert "They're on Lake trip now" in mail["text"]


def test_emails_link_to_the_tab_when_the_app_url_is_set(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "app_url", "https://cotab.example/")
    ada = _account(client, "ada@x.com", "Ada", "212-555-0100")
    _account(client, "ben@x.com", "Ben", "415-555-0199")
    tab = _lake_trip(client, ada, {"name": "Ben", "phone": "415-555-0199"})
    assert notify.emailed[0]["text"].endswith(
        f"Open: https://cotab.example/app/groups/{tab['id']}"
    )


def test_a_notification_that_fails_never_undoes_the_add(client, monkeypatch):
    def broken(*args, **kwargs):
        raise RuntimeError("push service down")

    monkeypatch.setattr(push_service, "send", broken)
    ada = _account(client, "ada@x.com", "Ada", "212-555-0100")
    _account(client, "ben@x.com", "Ben", "415-555-0199")
    tab = _lake_trip(client, ada, {"name": "Ben", "phone": "415-555-0199"})
    assert any(m["name"] == "Ben" and m["joined"] for m in tab["members"])
