"""Regression tests for the security pass.

One section per fix. Each test is written so it fails against the code as it
was before the fix, so none of these can pass vacuously.
"""

import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from jose import jwt

from app.api.v1 import exports, receipts
from app.config.settings import Settings, get_settings
from app.db.session import get_db
from app.main import app
from app.models import Receipt, SplitGroup, User
from app.services import extraction_service

settings = get_settings()
PASSWORD = "Pw12345!"


@pytest.fixture()
def client(db_session):
    app.dependency_overrides[get_db] = lambda: db_session
    yield TestClient(app)
    app.dependency_overrides.clear()


def _register(client, email):
    r = client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": PASSWORD, "full_name": "T"},
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _login(client, email, password=PASSWORD):
    return client.post(
        "/api/v1/auth/login", data={"username": email, "password": password}
    )


def _token(user_id, token_type):
    return jwt.encode(
        {
            "sub": user_id,
            "exp": datetime.now(timezone.utc) + timedelta(days=30),
            "type": token_type,
        },
        settings.secret_key,
        algorithm=settings.algorithm,
    )


# --- 1. only access tokens authenticate --------------------------------------


def test_refresh_type_token_is_rejected(client, user):
    r = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {_token(user.id, 'refresh')}"},
    )
    assert r.status_code == 401


def test_token_without_type_is_rejected(client, user):
    token = jwt.encode(
        {"sub": user.id, "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
        settings.secret_key,
        algorithm=settings.algorithm,
    )
    r = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401


def test_access_token_is_accepted(client, user):
    r = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {_token(user.id, 'access')}"},
    )
    assert r.status_code == 200


def test_auth_responses_no_longer_issue_refresh_tokens(client):
    r = client.post(
        "/api/v1/auth/register",
        json={"email": "norefresh@example.com", "password": PASSWORD},
    )
    assert "refresh_token" not in r.json()


# --- 2. X-Dev-User fails closed ----------------------------------------------


@pytest.mark.parametrize("env", ["production", "Production", "prod", "staging", ""])
def test_dev_header_ignored_outside_development(client, monkeypatch, env):
    monkeypatch.setattr(settings, "environment", env)
    r = client.get("/api/v1/auth/me", headers={"X-Dev-User": "intruder@x.com"})
    assert r.status_code == 401


def test_dev_header_works_in_development(client, monkeypatch):
    monkeypatch.setattr(settings, "environment", "development")
    r = client.get("/api/v1/auth/me", headers={"X-Dev-User": "dev@local"})
    assert r.status_code == 200
    assert r.json()["email"] == "dev@local"


# --- 3. production refuses a default cron secret -----------------------------


def _prod_settings(**overrides):
    values = dict(
        environment="production",
        secret_key="a" * 48,
        gemini_api_key="key",
        database_url="postgresql://u:p@db/receiptwise",
        cron_secret="b" * 32,
    )
    values.update(overrides)
    return Settings(_env_file=None, **values)


@pytest.mark.parametrize("bad", ["dev-cron-secret", ""])
def test_validate_production_rejects_weak_cron_secret(bad):
    with pytest.raises(RuntimeError, match="CRON_SECRET"):
        _prod_settings(cron_secret=bad).validate_production()


def test_validate_production_accepts_strong_config():
    _prod_settings().validate_production()


# --- 4. cron secret comparison -----------------------------------------------


@pytest.mark.parametrize("provided", [None, "", "wrong", "dev-cron-secre"])
def test_cron_secret_rejects_wrong_values(monkeypatch, provided):
    monkeypatch.setattr(exports.settings, "cron_secret", "dev-cron-secret")
    with pytest.raises(HTTPException) as exc:
        exports.require_cron_secret(provided)
    assert exc.value.status_code == 401


def test_cron_secret_accepts_correct_value(monkeypatch):
    monkeypatch.setattr(exports.settings, "cron_secret", "s3cret")
    exports.require_cron_secret("s3cret")


def test_empty_configured_cron_secret_never_matches(monkeypatch):
    monkeypatch.setattr(exports.settings, "cron_secret", "")
    with pytest.raises(HTTPException):
        exports.require_cron_secret("")


# --- 5. uploads don't block the event loop ----------------------------------


def test_upload_handler_is_sync_so_it_runs_in_threadpool():
    assert not asyncio.iscoroutinefunction(receipts.upload_receipt)


# --- 6. uploads are rate-limited ---------------------------------------------


def _fail_extraction(*_args, **_kwargs):
    raise RuntimeError(
        "psycopg2.OperationalError: could not connect to db.internal:5432 "
        "(api_key=AIza-SECRET)"
    )


def test_upload_rate_limit(client, monkeypatch):
    monkeypatch.setattr(receipts.settings, "rate_limit_upload_per_hour", 2)
    monkeypatch.setattr(extraction_service, "extract_receipt", _fail_extraction)
    h = _register(client, "ul@example.com")

    def files(n):  # distinct bytes: an identical file twice is refused as a duplicate
        return {"file": ("r.webp", f"img{n}".encode(), "image/webp")}

    assert (
        client.post("/api/v1/receipts/upload", headers=h, files=files(1)).status_code
        == 201
    )
    assert (
        client.post("/api/v1/receipts/upload", headers=h, files=files(2)).status_code
        == 201
    )
    r = client.post("/api/v1/receipts/upload", headers=h, files=files(3))
    assert r.status_code == 429
    assert "Retry-After" in r.headers


def test_upload_rate_limit_is_per_user(client, monkeypatch):
    monkeypatch.setattr(receipts.settings, "rate_limit_upload_per_hour", 1)
    monkeypatch.setattr(extraction_service, "extract_receipt", _fail_extraction)
    files = {"file": ("r.webp", b"img", "image/webp")}
    a = _register(client, "ula@example.com")
    b = _register(client, "ulb@example.com")
    assert (
        client.post("/api/v1/receipts/upload", headers=a, files=files).status_code
        == 201
    )
    assert (
        client.post("/api/v1/receipts/upload", headers=b, files=files).status_code
        == 201
    )


def test_oversized_upload_still_rejected(client, monkeypatch):
    monkeypatch.setattr(receipts.settings, "max_upload_bytes", 10)
    h = _register(client, "big@example.com")
    files = {"file": ("r.webp", b"x" * 11, "image/webp")}
    assert (
        client.post("/api/v1/receipts/upload", headers=h, files=files).status_code
        == 413
    )


# --- 7. raw errors never reach the client ------------------------------------


def test_extraction_failure_hides_internal_error(client, monkeypatch, caplog):
    monkeypatch.setattr(extraction_service, "extract_receipt", _fail_extraction)
    h = _register(client, "err@example.com")
    r = client.post(
        "/api/v1/receipts/upload",
        headers=h,
        files={"file": ("r.webp", b"img", "image/webp")},
    )
    body = r.json()
    assert body["status"] == "failed"
    assert body["error_message"] == receipts.EXTRACTION_FAILED_MESSAGE
    for secret in ("psycopg2", "db.internal", "AIza"):
        assert secret not in r.text
    # ...but the real cause is still logged for whoever runs the server.
    assert "db.internal" in caplog.text


# --- 8. login brute-force limit ---------------------------------------------


def test_login_rate_limited_per_account(client, monkeypatch):
    monkeypatch.setattr(settings, "rate_limit_login_per_15min", 3)
    _register(client, "bf@example.com")
    for _ in range(3):
        assert _login(client, "bf@example.com", "wrong").status_code == 401
    r = _login(client, "bf@example.com", PASSWORD)
    assert r.status_code == 429
    assert "Retry-After" in r.headers


def test_login_limit_ignores_email_case(client, monkeypatch):
    monkeypatch.setattr(settings, "rate_limit_login_per_15min", 2)
    _register(client, "case@example.com")
    assert _login(client, "case@example.com", "wrong").status_code == 401
    assert _login(client, "CASE@example.com", "wrong").status_code == 401
    assert _login(client, "Case@Example.com", "wrong").status_code == 429


# --- 9. account deletion -----------------------------------------------------


def test_delete_account_requires_correct_password(client):
    h = _register(client, "keep@example.com")
    r = client.post("/api/v1/auth/delete-account", headers=h, json={"password": "nope"})
    assert r.status_code == 403
    assert client.get("/api/v1/auth/me", headers=h).status_code == 200


def test_delete_account_removes_access_and_data(client, db_session):
    h = _register(client, "gone@example.com")
    user = db_session.query(User).filter(User.email == "gone@example.com").one()
    db_session.add(
        Receipt(user_id=user.id, merchant="Shop", total=5, status="extracted")
    )
    group = SplitGroup(owner_id=user.id, name="Trip", share_code="code123")
    db_session.add(group)
    db_session.commit()

    r = client.post(
        "/api/v1/auth/delete-account", headers=h, json={"password": PASSWORD}
    )
    assert r.status_code == 200

    # Existing session no longer works, and neither does signing in again.
    assert client.get("/api/v1/auth/me", headers=h).status_code == 401
    assert _login(client, "gone@example.com").status_code == 401

    # Personal details are scrubbed immediately.
    db_session.expire_all()
    row = db_session.get(User, user.id)
    assert row.deleted_at is not None
    assert "gone@example.com" not in row.email
    assert row.full_name == ""

    # Owned data is soft-deleted and the public share link stops working.
    assert all(
        rec.deleted_at is not None
        for rec in db_session.query(Receipt).filter(Receipt.user_id == user.id)
    )
    assert client.get("/api/v1/splits/share/code123").status_code == 404


def test_deleted_email_can_register_again(client):
    h = _register(client, "again@example.com")
    client.post("/api/v1/auth/delete-account", headers=h, json={"password": PASSWORD})
    _register(client, "again@example.com")


def test_delete_account_leaves_other_users_alone(client, db_session):
    a = _register(client, "a-del@example.com")
    b = _register(client, "b-keep@example.com")
    b_id = db_session.query(User).filter(User.email == "b-keep@example.com").one().id
    db_session.add(Receipt(user_id=b_id, merchant="Mine", total=1, status="extracted"))
    db_session.commit()

    client.post("/api/v1/auth/delete-account", headers=a, json={"password": PASSWORD})

    assert client.get("/api/v1/auth/me", headers=b).status_code == 200
    kept = db_session.query(Receipt).filter(Receipt.user_id == b_id).one()
    assert kept.deleted_at is None


def test_delete_account_removes_tabbys_memories_rules_and_history(client, db_session):
    from app.models import TabbyActivity, TabbyAttempt, TabbyMemory, TabbyRule

    h = _register(client, "tabby-gone@example.com")
    user = db_session.query(User).filter(User.email == "tabby-gone@example.com").one()
    db_session.add_all(
        [
            TabbyMemory(user_id=user.id, text="Ben is my roommate", kind="person"),
            TabbyRule(
                user_id=user.id,
                action="split",
                store="Costco",
                summary="Split Costco with Ben",
                params="{}",
            ),
            TabbyActivity(
                user_id=user.id,
                run_id="r",
                position=0,
                action="remember",
                summary="Remember Ben",
            ),
            TabbyAttempt(
                user_id=user.id,
                run_id="r",
                position=0,
                action="remember",
                kind="execute",
                outcome="ok",
            ),
        ]
    )
    db_session.commit()
    client.post("/api/v1/auth/delete-account", headers=h, json={"password": PASSWORD})
    db_session.expire_all()
    for model in (TabbyMemory, TabbyRule, TabbyActivity):
        row = db_session.query(model).filter(model.user_id == user.id).one()
        assert row.deleted_at is not None, model.__name__
    assert db_session.query(TabbyAttempt).filter_by(user_id=user.id).count() == 0
