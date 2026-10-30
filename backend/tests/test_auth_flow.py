"""Cookie auth + onboarding intent.

The cookie-attribute tests are the important ones: cross-site auth between
vercel.app and onrender.com silently breaks if SameSite/Secure regress, and the
symptom (login "works" but every later request 401s) is slow to diagnose in a
browser. Asserting the header directly catches it here instead.
"""

import pytest
from fastapi import Response
from fastapi.testclient import TestClient

from app.core import security
from app.db.session import get_db
from app.main import app


@pytest.fixture()
def client(db_session):
    app.dependency_overrides[get_db] = lambda: db_session
    # Deliberately NOT `with TestClient(app)`: the context manager runs the
    # lifespan, which calls ensure_bucket_exists() and spends ~13s waiting for
    # an unreachable LocalStack. These tests don't need startup.
    yield TestClient(app)
    app.dependency_overrides.clear()


class _FakeSettings:
    def __init__(self, environment):
        self.environment = environment
        self.access_token_expire_minutes = 60

    def is_production(self):
        return self.environment == "production"


@pytest.mark.parametrize(
    "environment,expected",
    [
        ("production", ["samesite=none", "secure", "httponly"]),
        ("development", ["samesite=lax", "httponly"]),
    ],
)
def test_cookie_attributes(monkeypatch, environment, expected):
    monkeypatch.setattr(security, "settings", _FakeSettings(environment))
    resp = Response()
    security.set_auth_cookie(resp, "TOKEN")
    header = resp.headers["set-cookie"].lower()
    for token in expected:
        assert token in header, f"{environment}: missing {token!r} in {header!r}"


def test_dev_cookie_is_not_secure(monkeypatch):
    """Secure cookies aren't stored over plain http, so localhost must not set it."""
    monkeypatch.setattr(security, "settings", _FakeSettings("development"))
    resp = Response()
    security.set_auth_cookie(resp, "TOKEN")
    assert "secure" not in resp.headers["set-cookie"].lower()


def _register(client, email="a@b.com", password="Pw12345!"):
    return client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password, "full_name": "Test"},
    )


def test_register_sets_cookie_and_authenticates(client):
    r = _register(client)
    assert r.status_code == 200
    assert security.ACCESS_COOKIE in r.cookies

    # No Authorization header — the cookie alone must carry the session.
    me = client.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.json()["intent"] is None


def test_logout_clears_cookie(client):
    _register(client)
    assert client.get("/api/v1/auth/me").status_code == 200
    client.post("/api/v1/auth/logout")
    assert client.get("/api/v1/auth/me").status_code == 401


def test_set_intent_roundtrip(client):
    _register(client)
    r = client.post("/api/v1/auth/set-intent", json={"intent": "splits"})
    assert r.status_code == 200
    assert r.json()["intent"] == "splits"
    assert client.get("/api/v1/auth/me").json()["intent"] == "splits"


def test_set_intent_rejects_unknown_value(client):
    _register(client)
    r = client.post("/api/v1/auth/set-intent", json={"intent": "whatever"})
    assert r.status_code == 422


def test_set_intent_requires_auth(client):
    assert (
        client.post("/api/v1/auth/set-intent", json={"intent": "personal"}).status_code
        == 401
    )


def test_bearer_still_works(client):
    """scripts/smoke.sh authenticates with a bearer token, not a cookie."""
    token = _register(client).json()["access_token"]
    client.cookies.clear()
    r = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
