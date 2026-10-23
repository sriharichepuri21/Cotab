"""Your mobile number: added after signing up, one account per number."""

import json

import pytest
from fastapi.testclient import TestClient

from app.db.session import get_db
from app.main import app
from app.models import User
from app.services.account_service import delete_account
from app.utils.phone import PhoneError, normalize_us_phone, pretty

API = "/api/v1"


@pytest.fixture()
def client(db_session):
    app.dependency_overrides[get_db] = lambda: db_session
    yield TestClient(app)
    app.dependency_overrides.clear()


def _register(client, email, name="Ada"):
    token = client.post(
        f"{API}/auth/register",
        json={"email": email, "password": "pw12345", "full_name": name},
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.parametrize(
    "typed",
    [
        "(415) 555-0123",
        "415.555.0123",
        "4155550123",
        "+1 415 555 0123",
        "1-415-555-0123",
    ],
)
def test_every_way_of_typing_a_number_is_stored_the_same(typed):
    assert normalize_us_phone(typed) == "+14155550123"
    assert pretty("+14155550123") == "(415) 555-0123"


@pytest.mark.parametrize(
    "typed, says",
    [
        ("", "Add your mobile number"),
        ("hello", "doesn't look like a phone number"),
        ("555-0123", "real US number"),
        ("(123) 456-7890", "real US number"),
        ("+44 20 7946 0958", "only works with US numbers"),
        ("+1 604 555 0123", "only works with US numbers"),  # Canada shares +1
    ],
)
def test_numbers_that_arent_us_mobiles_are_refused(typed, says):
    with pytest.raises(PhoneError, match=says):
        normalize_us_phone(typed)


def test_new_accounts_have_no_number_until_they_add_one(client):
    headers = _register(client, "a@x.com")
    assert client.get(f"{API}/auth/me", headers=headers).json()["phone"] is None

    out = client.put(
        f"{API}/auth/me/phone", headers=headers, json={"phone": "(415) 555-0123"}
    )
    assert out.status_code == 200
    assert out.json()["phone"] == "+14155550123"
    assert (
        client.get(f"{API}/auth/me", headers=headers).json()["phone"] == "+14155550123"
    )


def test_a_bad_number_says_why(client):
    headers = _register(client, "a@x.com")
    out = client.put(
        f"{API}/auth/me/phone", headers=headers, json={"phone": "555-0123"}
    )
    assert out.status_code == 400
    assert "real US number" in out.json()["detail"]


def test_one_account_per_number_however_it_is_typed(client):
    ada = _register(client, "a@x.com")
    ben = _register(client, "b@x.com", "Ben")
    client.put(f"{API}/auth/me/phone", headers=ada, json={"phone": "415-555-0123"})

    out = client.put(
        f"{API}/auth/me/phone", headers=ben, json={"phone": "+14155550123"}
    )
    assert out.status_code == 409
    assert "already on another Cotab account" in out.json()["detail"]
    # Saving your own number again is fine.
    again = client.put(
        f"{API}/auth/me/phone", headers=ada, json={"phone": "(415) 555-0123"}
    )
    assert again.status_code == 200


def test_changing_the_number_frees_the_old_one(client, db_session):
    ada = _register(client, "a@x.com")
    ben = _register(client, "b@x.com", "Ben")
    client.put(f"{API}/auth/me/phone", headers=ada, json={"phone": "415-555-0123"})
    client.put(f"{API}/auth/me/phone", headers=ada, json={"phone": "212-555-0199"})

    out = client.put(
        f"{API}/auth/me/phone", headers=ben, json={"phone": "415-555-0123"}
    )
    assert out.status_code == 200


def test_a_new_number_is_not_marked_proved(client, db_session):
    from datetime import datetime, timezone

    headers = _register(client, "a@x.com")
    client.put(f"{API}/auth/me/phone", headers=headers, json={"phone": "415-555-0123"})
    user = db_session.query(User).filter_by(email="a@x.com").one()
    user.phone_verified_at = datetime.now(timezone.utc)
    db_session.commit()

    client.put(f"{API}/auth/me/phone", headers=headers, json={"phone": "212-555-0199"})
    db_session.refresh(user)
    assert user.phone_verified_at is None


def test_deleting_the_account_frees_the_number(client, db_session):
    ada = _register(client, "a@x.com")
    client.put(f"{API}/auth/me/phone", headers=ada, json={"phone": "415-555-0123"})
    delete_account(db_session, db_session.query(User).filter_by(email="a@x.com").one())

    ben = _register(client, "b@x.com", "Ben")
    out = client.put(
        f"{API}/auth/me/phone", headers=ben, json={"phone": "415-555-0123"}
    )
    assert out.status_code == 200


def test_the_export_includes_the_number(client, monkeypatch):
    from app.api.v1 import exports

    files = {}
    monkeypatch.setattr(
        exports.s3_mod,
        "upload_file",
        lambda key, body, _type: files.update({key: body.read()}),
    )
    monkeypatch.setattr(exports.s3_mod, "presign_download_url", lambda key: "/x")
    headers = _register(client, "a@x.com")
    client.put(f"{API}/auth/me/phone", headers=headers, json={"phone": "415-555-0123"})
    assert client.post(f"{API}/exports/", headers=headers).json()["status"] == "ready"
    (body,) = files.values()
    assert json.loads(body)["user"]["phone"] == "+14155550123"


def test_checking_numbers_in_bulk_is_limited(client):
    headers = _register(client, "a@x.com")
    codes = [
        client.put(
            f"{API}/auth/me/phone",
            headers=headers,
            json={"phone": f"415-555-01{n:02d}"},
        ).status_code
        for n in range(11)
    ]
    assert codes[:10] == [200] * 10
    assert codes[10] == 429
