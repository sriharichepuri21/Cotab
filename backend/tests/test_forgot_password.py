"""Forgot password: email, the emailed code, a new password, signed in."""

import pytest
from fastapi.testclient import TestClient

from app.db.session import get_db
from app.main import app
from app.models import User
from app.services import email_verification

client = TestClient(app)


@pytest.fixture(autouse=True)
def _db(db_session):
    app.dependency_overrides[get_db] = lambda: db_session
    yield db_session
    app.dependency_overrides.clear()


def _register(email="pat@example.com", password="first-pass-1"):
    r = client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password, "full_name": "Pat"},
    )
    assert r.status_code == 200, r.text


def _login(email, password):
    return client.post(
        "/api/v1/auth/login", data={"username": email, "password": password}
    )


def _last_code(email):
    return next(
        m["code"]
        for m in reversed(email_verification.outbox)
        if m["to"] == email and m["purpose"] == "reset"
    )


def test_reset_with_the_emailed_code_and_sign_in():
    _register()
    r = client.post("/api/v1/auth/password/forgot", json={"email": "pat@example.com"})
    assert r.status_code == 200
    mail = email_verification.outbox[-1]
    assert mail["subject"].endswith("resets your Cotab password")
    r = client.post(
        "/api/v1/auth/password/reset",
        json={
            "email": "pat@example.com",
            "code": _last_code("pat@example.com"),
            "new_password": "second-pass-2",
        },
    )
    assert r.status_code == 200 and r.json()["access_token"]
    assert _login("pat@example.com", "first-pass-1").status_code == 401
    assert _login("pat@example.com", "second-pass-2").status_code == 200


def test_unknown_emails_get_the_same_answer_and_no_mail():
    before = len(email_verification.outbox)
    r = client.post(
        "/api/v1/auth/password/forgot", json={"email": "nobody@example.com"}
    )
    assert r.status_code == 200 and r.json()["sent"] is True
    assert len(email_verification.outbox) == before


def test_a_wrong_code_changes_nothing():
    _register("sam@example.com", "first-pass-1")
    client.post("/api/v1/auth/password/forgot", json={"email": "sam@example.com"})
    r = client.post(
        "/api/v1/auth/password/reset",
        json={
            "email": "sam@example.com",
            "code": "000000",
            "new_password": "hacked-pass",
        },
    )
    assert r.status_code == 400 and "isn't right" in r.json()["detail"]
    assert _login("sam@example.com", "first-pass-1").status_code == 200


def test_a_short_password_is_refused():
    _register("lee@example.com", "first-pass-1")
    client.post("/api/v1/auth/password/forgot", json={"email": "lee@example.com"})
    r = client.post(
        "/api/v1/auth/password/reset",
        json={
            "email": "lee@example.com",
            "code": _last_code("lee@example.com"),
            "new_password": "short",
        },
    )
    assert r.status_code == 422


def test_a_google_account_can_add_a_password_this_way(_db):
    _register("gia@example.com", "first-pass-1")
    user = _db.query(User).filter_by(email="gia@example.com").one()
    user.has_password = False
    _db.commit()
    client.post("/api/v1/auth/password/forgot", json={"email": "gia@example.com"})
    r = client.post(
        "/api/v1/auth/password/reset",
        json={
            "email": "gia@example.com",
            "code": _last_code("gia@example.com"),
            "new_password": "now-a-password",
        },
    )
    assert r.status_code == 200
    assert (
        client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {r.json()['access_token']}"},
        ).json()["has_password"]
        is True
    )
