"""Turning notifications on for a device, and the server's own signing key."""

import pytest
from fastapi.testclient import TestClient

from app.db.session import get_db
from app.main import app
from app.services import push_service
from tests.test_direct_splits import _register

API = "/api/v1"


@pytest.fixture()
def client(db_session):
    app.dependency_overrides[get_db] = lambda: db_session
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_the_key_is_made_once_and_kept(client):
    first = client.get(f"{API}/push/key").json()["public_key"]
    assert len(first) > 80
    assert client.get(f"{API}/push/key").json()["public_key"] == first


def test_subscribe_and_unsubscribe_a_device(client):
    headers, _ = _register(client)
    body = {
        "endpoint": "https://push.example/abc",
        "keys": {"p256dh": "p", "auth": "a"},
    }
    assert client.post(f"{API}/push/subscribe", headers=headers, json=body).json() == {
        "devices": 1
    }
    # The same device again is still one device.
    client.post(f"{API}/push/subscribe", headers=headers, json=body)
    assert client.get(f"{API}/push/status", headers=headers).json() == {"devices": 1}
    out = client.post(
        f"{API}/push/unsubscribe", headers=headers, json={"endpoint": body["endpoint"]}
    )
    assert out.json() == {"devices": 0}


def test_a_gone_device_is_forgotten(db_session, monkeypatch):
    from app.models import User

    user = User(email="g@x.com", hashed_password="x")
    db_session.add(user)
    db_session.commit()
    push_service.subscribe(db_session, user.id, "https://push.example/gone", "p", "a")
    monkeypatch.setattr(push_service, "sent", None)

    class Gone(Exception):
        pass

    import pywebpush

    def fake(**kwargs):
        raise pywebpush.WebPushException(
            "gone", response=type("R", (), {"status_code": 410})()
        )

    monkeypatch.setattr(pywebpush, "webpush", fake)
    assert push_service.send(db_session, user.id, "t", "b", "/app") == 0
    assert push_service.devices(db_session, user.id) == []
