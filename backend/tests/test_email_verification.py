"""Every new account confirms its email with a 6-digit code before using Cotab,
whether it signed up with a password, Google or Apple."""

import time
from datetime import datetime, timedelta, timezone

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from jose import jwk, jwt

from app.config.settings import get_settings
from app.db.session import get_db
from app.main import app
from app.models import User
from app.services import email_verification, social_auth

API = "/api/v1"


@pytest.fixture()
def client(db_session):
    settings = get_settings()
    settings.require_email_verification = True
    app.dependency_overrides[get_db] = lambda: db_session
    yield TestClient(app)
    app.dependency_overrides.clear()


def _register(client, email="ada@x.com", name="Ada Lovelace"):
    out = client.post(
        f"{API}/auth/register",
        json={"email": email, "password": "Pw12345!", "full_name": name},
    )
    assert out.status_code == 200, out.text
    body = out.json()
    return {"Authorization": f"Bearer {body['access_token']}"}, body


def _last_code(to):
    sent = [m for m in email_verification.outbox if m["to"] == to]
    assert sent, f"no email to {to}"
    return sent[-1]["code"]


# ---------- the code ----------


def test_signing_up_sends_a_code_and_holds_the_app_until_it_is_entered(client):
    headers, body = _register(client)
    assert body["email_verified"] is False and body["new_account"] is True
    mail = email_verification.outbox[-1]
    assert mail["to"] == "ada@x.com"
    assert len(mail["code"]) == 6 and mail["code"].isdigit()
    assert mail["code"] in mail["subject"] and "Hi Ada," in mail["text"]

    me = client.get(f"{API}/auth/me", headers=headers).json()
    assert me["email_verified"] is False
    blocked = client.get(f"{API}/receipts/", headers=headers)
    assert blocked.status_code == 403
    assert blocked.headers.get("X-Verify-Email") == "1"

    ok = client.post(
        f"{API}/auth/verify-email", headers=headers, json={"code": mail["code"]}
    )
    assert ok.status_code == 200 and ok.json()["email_verified"] is True
    assert client.get(f"{API}/receipts/", headers=headers).status_code == 200


def test_only_a_hash_of_the_code_is_stored(client, db_session):
    _register(client)
    code = _last_code("ada@x.com")
    user = db_session.query(User).filter(User.email == "ada@x.com").one()
    assert user.verify_code_hash and code not in user.verify_code_hash


def test_wrong_codes_count_down_then_lock(client):
    headers, _ = _register(client)
    code = _last_code("ada@x.com")
    wrong = "000000" if code != "000000" else "111111"
    for left in (4, 3, 2, 1):
        out = client.post(
            f"{API}/auth/verify-email", headers=headers, json={"code": wrong}
        )
        assert out.status_code == 400
        assert f"{left} tr" in out.json()["detail"]
    out = client.post(f"{API}/auth/verify-email", headers=headers, json={"code": wrong})
    assert out.status_code == 429
    # Even the right code doesn't work once locked.
    out = client.post(f"{API}/auth/verify-email", headers=headers, json={"code": code})
    assert out.status_code == 429


def test_codes_expire(client, db_session):
    headers, _ = _register(client)
    code = _last_code("ada@x.com")
    user = db_session.query(User).filter(User.email == "ada@x.com").one()
    user.verify_expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    db_session.commit()
    out = client.post(f"{API}/auth/verify-email", headers=headers, json={"code": code})
    assert out.status_code == 400 and "expired" in out.json()["detail"]


def test_a_new_code_waits_a_minute_and_replaces_the_old_one(client, db_session):
    headers, _ = _register(client)
    first = _last_code("ada@x.com")
    too_soon = client.post(f"{API}/auth/verify-email/resend", headers=headers)
    assert too_soon.status_code == 429 and "Retry-After" in too_soon.headers

    user = db_session.query(User).filter(User.email == "ada@x.com").one()
    user.verify_sent_at = datetime.now(timezone.utc) - timedelta(minutes=2)
    db_session.commit()
    again = client.post(f"{API}/auth/verify-email/resend", headers=headers)
    assert again.status_code == 200 and again.json()["sent"] is True
    second = _last_code("ada@x.com")
    if second != first:
        out = client.post(
            f"{API}/auth/verify-email", headers=headers, json={"code": first}
        )
        assert out.status_code == 400
    out = client.post(
        f"{API}/auth/verify-email", headers=headers, json={"code": second}
    )
    assert out.status_code == 200


def test_codes_are_typed_loosely(client):
    headers, _ = _register(client)
    code = _last_code("ada@x.com")
    spaced = f" {code[:3]} {code[3:]} "
    out = client.post(
        f"{API}/auth/verify-email", headers=headers, json={"code": spaced}
    )
    assert out.status_code == 200


def test_existing_accounts_are_not_locked_out(client, db_session):
    # Rows from before codes existed are marked verified by the migration;
    # the model default for brand-new rows is unverified.
    user = User(email="old@x.com", hashed_password="x", full_name="Old")
    db_session.add(user)
    db_session.commit()
    assert user.email_verified is False
    user.email_verified = True
    db_session.commit()
    assert db_session.query(User).filter(User.email == "old@x.com").one().email_verified


# ---------- Google and Apple ----------


@pytest.fixture()
def signer(monkeypatch):
    """Sign ID tokens with a local key and publish it as Google's and Apple's."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    public = key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    published = jwk.construct(public, "RS256").to_dict()
    published.update({"kid": "test-key", "alg": "RS256", "use": "sig"})
    for k in ("n", "e"):
        if isinstance(published[k], bytes):
            published[k] = published[k].decode()
    social_auth._cache.clear()
    monkeypatch.setattr(social_auth, "fetch_keys", lambda url: {"keys": [published]})
    settings = get_settings()
    monkeypatch.setattr(settings, "google_client_id", "google-client.apps")
    monkeypatch.setattr(settings, "apple_client_id", "app.cotab.signin")

    def sign(**claims):
        now = int(time.time())
        base = {"iat": now, "exp": now + 600}
        base.update(claims)
        return jwt.encode(base, private, algorithm="RS256", headers={"kid": "test-key"})

    yield sign
    social_auth._cache.clear()


def _google(sign, **extra):
    claims = {
        "iss": "https://accounts.google.com",
        "aud": "google-client.apps",
        "sub": "g-123",
        "email": "ada@gmail.com",
        "email_verified": True,
        "given_name": "Ada",
        "nonce": "n1",
    }
    claims.update(extra)
    return sign(**claims)


def test_google_sign_up_makes_an_account_that_still_needs_a_code(client, signer):
    out = client.post(
        f"{API}/auth/google", json={"credential": _google(signer), "nonce": "n1"}
    )
    assert out.status_code == 200, out.text
    body = out.json()
    assert body["new_account"] is True and body["email_verified"] is False
    headers = {"Authorization": f"Bearer {body['access_token']}"}
    me = client.get(f"{API}/auth/me", headers=headers).json()
    assert me["email"] == "ada@gmail.com" and me["full_name"] == "Ada"
    code = _last_code("ada@gmail.com")
    assert (
        client.post(f"{API}/auth/verify-email", headers=headers, json={"code": code})
    ).status_code == 200

    # Next time: same Google account, straight in, no new code.
    sent = len(email_verification.outbox)
    again = client.post(
        f"{API}/auth/google", json={"credential": _google(signer), "nonce": "n1"}
    ).json()
    assert again["new_account"] is False and again["email_verified"] is True
    assert len(email_verification.outbox) == sent


@pytest.mark.parametrize(
    "change,detail",
    [
        ({"aud": "someone-elses-app"}, "didn't check out"),
        ({"iss": "https://evil.example"}, "wrong place"),
        ({"exp": int(time.time()) - 3600}, "didn't check out"),
        ({"nonce": "other"}, "expired"),
    ],
)
def test_google_tokens_must_be_for_us_fresh_and_ours(client, signer, change, detail):
    out = client.post(
        f"{API}/auth/google",
        json={"credential": _google(signer, **change), "nonce": "n1"},
    )
    assert out.status_code == 401
    assert detail in out.json()["detail"]


def test_a_forged_signature_is_refused(client, signer):
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = other.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    now = int(time.time())
    forged = jwt.encode(
        {
            "iss": "accounts.google.com",
            "aud": "google-client.apps",
            "sub": "g-1",
            "email": "x@gmail.com",
            "iat": now,
            "exp": now + 600,
        },
        pem,
        algorithm="RS256",
        headers={"kid": "test-key"},
    )
    assert (
        client.post(f"{API}/auth/google", json={"credential": forged}).status_code
        == 401
    )


def test_google_links_to_a_verified_password_account_with_the_same_email(
    client, signer, db_session
):
    headers, _ = _register(client, email="ada@gmail.com")
    client.post(
        f"{API}/auth/verify-email",
        headers=headers,
        json={"code": _last_code("ada@gmail.com")},
    )
    out = client.post(
        f"{API}/auth/google", json={"credential": _google(signer), "nonce": "n1"}
    ).json()
    assert out["new_account"] is False and out["email_verified"] is True
    user = db_session.query(User).filter(User.email == "ada@gmail.com").one()
    assert user.google_sub == "g-123"
    assert db_session.query(User).count() == 1


def test_an_unconfirmed_squatter_loses_the_password_when_the_owner_arrives(
    client, signer
):
    # Someone signs up with Ada's address but never confirms it.
    client.post(
        f"{API}/auth/register",
        json={"email": "ada@gmail.com", "password": "Squatter1!", "full_name": "X"},
    )
    client.post(
        f"{API}/auth/google", json={"credential": _google(signer), "nonce": "n1"}
    )
    login = client.post(
        f"{API}/auth/login",
        data={"username": "ada@gmail.com", "password": "Squatter1!"},
    )
    assert login.status_code == 401


def test_google_without_a_verified_email_cannot_take_over_an_account(client, signer):
    _register(client, email="ada@gmail.com")
    out = client.post(
        f"{API}/auth/google",
        json={"credential": _google(signer, email_verified=False), "nonce": "n1"},
    )
    assert out.status_code == 409


def test_apple_sign_up_uses_the_name_from_the_first_sign_in(client, signer):
    token = signer(
        iss="https://appleid.apple.com",
        aud="app.cotab.signin",
        sub="a-777",
        email="x1y2@privaterelay.appleid.com",
        email_verified="true",
        nonce="n2",
    )
    out = client.post(
        f"{API}/auth/apple",
        json={"id_token": token, "nonce": "n2", "name": "Ben Rivera"},
    )
    assert out.status_code == 200, out.text
    headers = {"Authorization": f"Bearer {out.json()['access_token']}"}
    me = client.get(f"{API}/auth/me", headers=headers).json()
    assert me["full_name"] == "Ben Rivera"
    assert _last_code("x1y2@privaterelay.appleid.com")


def test_providers_lists_what_is_set_up(client, signer):
    assert client.get(f"{API}/auth/providers").json() == {
        "google_client_id": "google-client.apps",
        "apple_client_id": "app.cotab.signin",
    }


def test_sign_in_with_a_provider_that_is_not_set_up_is_refused(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "google_client_id", None)
    out = client.post(f"{API}/auth/google", json={"credential": "x" * 40})
    assert out.status_code == 401 and "isn't set up" in out.json()["detail"]


def test_google_accounts_delete_with_an_emailed_code_and_free_the_link(client, signer):
    body = client.post(
        f"{API}/auth/google", json={"credential": _google(signer), "nonce": "n1"}
    ).json()
    headers = {"Authorization": f"Bearer {body['access_token']}"}
    client.post(
        f"{API}/auth/verify-email",
        headers=headers,
        json={"code": _last_code("ada@gmail.com")},
    )
    me = client.get(f"{API}/auth/me", headers=headers).json()
    assert me["has_password"] is False

    sent = client.post(f"{API}/auth/delete-account/code", headers=headers)
    assert sent.status_code == 200
    mail = email_verification.outbox[-1]
    assert mail["purpose"] == "delete" and "delet" in mail["subject"]
    # A code for something else doesn't delete the account.
    assert client.post(
        f"{API}/auth/delete-account", headers=headers, json={"code": "000000"}
    ).status_code in (400, 429)
    gone = client.post(
        f"{API}/auth/delete-account", headers=headers, json={"code": mail["code"]}
    )
    assert gone.status_code == 200

    # The same Google account can sign up again afterwards.
    again = client.post(
        f"{API}/auth/google", json={"credential": _google(signer), "nonce": "n1"}
    ).json()
    assert again["new_account"] is True


def test_password_accounts_still_delete_with_the_password(client):
    headers, _ = _register(client)
    client.post(
        f"{API}/auth/verify-email",
        headers=headers,
        json={"code": _last_code("ada@x.com")},
    )
    assert client.get(f"{API}/auth/me", headers=headers).json()["has_password"] is True
    assert (
        client.post(
            f"{API}/auth/delete-account", headers=headers, json={"password": "nope"}
        ).status_code
        == 403
    )
    assert (
        client.post(
            f"{API}/auth/delete-account", headers=headers, json={"password": "Pw12345!"}
        ).status_code
        == 200
    )
