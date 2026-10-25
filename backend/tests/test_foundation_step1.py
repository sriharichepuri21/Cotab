"""Step 1 of the redesign: one category list, and purchases kept beside receipts."""

import os
import sqlite3
import subprocess
import sys
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.db.session import get_db
from app.main import app
from app.models import Purchase, Receipt, User
from app.services import extraction_service, gemini_service
from app.services.categories import CANONICAL_CATEGORIES, CATEGORY_META
from app.services.gemini_service import ReceiptExtraction

BACKEND_DIR = Path(__file__).resolve().parent.parent
PASSWORD = "pw12345"


@pytest.fixture()
def client(db_session):
    app.dependency_overrides[get_db] = lambda: db_session
    yield TestClient(app)
    app.dependency_overrides.clear()


def _register(client, email):
    r = client.post(
        "/api/v1/auth/register", json={"email": email, "password": PASSWORD}
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _fake_extract(*_args, **_kwargs):
    return ReceiptExtraction(
        merchant="Corner Market",
        total=26.15,
        subtotal=25.02,
        tax=1.13,
        currency="USD",
        category="groceries",
        date="2026-10-12",
    )


def _upload(client, headers):
    r = client.post(
        "/api/v1/receipts/upload",
        headers=headers,
        # A different file each time: the same bytes twice is refused as a duplicate.
        files={"file": ("r.webp", uuid.uuid4().bytes, "image/webp")},
    )
    assert r.status_code == 201, r.text
    return r.json()


# --- categories --------------------------------------------------------------


def test_extraction_prompt_uses_the_shared_category_list():
    assert gemini_service.CATEGORIES == list(CANONICAL_CATEGORIES)
    for cat in CANONICAL_CATEGORIES:
        assert cat in gemini_service.EXTRACTION_PROMPT


def test_categories_endpoint_needs_no_auth_and_matches_the_list(client):
    r = client.get("/api/v1/meta/categories")
    assert r.status_code == 200
    body = r.json()
    assert [c["id"] for c in body] == list(CANONICAL_CATEGORIES)
    for c in body:
        assert c["label"] and c["icon"] and c["color"].startswith("#")


def test_every_category_has_unique_id_and_label():
    ids = [c["id"] for c in CATEGORY_META]
    labels = [c["label"] for c in CATEGORY_META]
    assert len(set(ids)) == len(ids) == 12
    assert len(set(labels)) == len(labels)


# --- purchases stay in step with receipts -----------------------------------


def test_upload_creates_a_matching_purchase(client, db_session, monkeypatch):
    monkeypatch.setattr(extraction_service, "extract_receipt", _fake_extract)
    receipt = _upload(client, _register(client, "p1@example.com"))

    purchase = db_session.get(Purchase, receipt["id"])
    assert purchase is not None
    assert purchase.merchant == "Corner Market"
    assert purchase.total == 26.15
    assert purchase.category == "groceries"
    assert purchase.source == "photo"
    assert db_session.get(Receipt, receipt["id"]).purchase_id == purchase.id


def test_failed_upload_still_gets_a_purchase(client, db_session, monkeypatch):
    def boom(*_a, **_k):
        raise RuntimeError("model down")

    monkeypatch.setattr(extraction_service, "extract_receipt", boom)
    receipt = _upload(client, _register(client, "p2@example.com"))
    assert receipt["status"] == "failed"
    assert db_session.get(Purchase, receipt["id"]) is not None


def test_review_edits_flow_to_the_purchase(client, db_session, monkeypatch):
    monkeypatch.setattr(extraction_service, "extract_receipt", _fake_extract)
    h = _register(client, "p3@example.com")
    receipt = _upload(client, h)
    r = client.post(
        f"/api/v1/receipts/{receipt['id']}/review",
        headers=h,
        json={"merchant": "Corner Mkt", "total": 30.0, "category": "shopping"},
    )
    assert r.status_code == 200, r.text
    db_session.expire_all()
    purchase = db_session.get(Purchase, receipt["id"])
    assert (purchase.merchant, purchase.total, purchase.category) == (
        "Corner Mkt",
        30.0,
        "shopping",
    )


def test_delete_and_bulk_flow_to_the_purchase(client, db_session, monkeypatch):
    monkeypatch.setattr(extraction_service, "extract_receipt", _fake_extract)
    h = _register(client, "p4@example.com")
    a = _upload(client, h)
    b = _upload(client, h)

    client.post(
        "/api/v1/receipts/bulk",
        headers=h,
        json={"receipt_ids": [a["id"]], "action": "categorize", "category": "dining"},
    )
    client.delete(f"/api/v1/receipts/{b['id']}", headers=h)

    db_session.expire_all()
    assert db_session.get(Purchase, a["id"]).category == "dining"
    assert db_session.get(Purchase, b["id"]).deleted_at is not None


def test_account_deletion_removes_purchases(client, db_session, monkeypatch):
    monkeypatch.setattr(extraction_service, "extract_receipt", _fake_extract)
    h = _register(client, "p5@example.com")
    receipt = _upload(client, h)
    client.post("/api/v1/auth/delete-account", headers=h, json={"password": PASSWORD})
    db_session.expire_all()
    assert db_session.get(Purchase, receipt["id"]).deleted_at is not None


def test_purchases_are_never_shared_across_users(client, db_session, monkeypatch):
    monkeypatch.setattr(extraction_service, "extract_receipt", _fake_extract)
    receipt = _upload(client, _register(client, "owner@example.com"))
    owner = db_session.query(User).filter(User.email == "owner@example.com").one()
    assert db_session.get(Purchase, receipt["id"]).user_id == owner.id


# --- the migration wraps existing receipts ----------------------------------


def _alembic(db_path, *args):
    env = os.environ.copy()
    env["DATABASE_URL"] = f"sqlite:///{db_path}"
    res = subprocess.run(
        [
            sys.executable,
            "-m",
            "alembic",
            "-c",
            str(BACKEND_DIR / "alembic.ini"),
            *args,
        ],
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
    )
    assert res.returncode == 0, res.stderr


def test_migration_wraps_every_existing_receipt(tmp_path):
    db = tmp_path / "m.db"
    _alembic(db, "upgrade", "a7c3e91d4b10")
    con = sqlite3.connect(db)
    ts = "2026-10-01 00:00:00"
    con.execute(
        "INSERT INTO users (id, email, hashed_password, created_at, updated_at) "
        "VALUES ('u1', 'a@b.c', 'x', ?, ?)",
        (ts, ts),
    )
    con.execute(
        "INSERT INTO receipts (id, user_id, merchant, total, currency, category, "
        "status, created_at, updated_at) VALUES "
        "('r1', 'u1', 'Costco', 186.4, 'USD', 'groceries', 'reviewed', ?, ?)",
        (ts, ts),
    )
    con.execute(
        "INSERT INTO receipts (id, user_id, merchant, total, status, created_at, "
        "updated_at, deleted_at) VALUES ('r2', 'u1', NULL, NULL, 'failed', ?, ?, ?)",
        (ts, ts, ts),
    )
    con.commit()
    con.close()

    _alembic(db, "upgrade", "head")

    con = sqlite3.connect(db)
    rows = {
        r[0]: r[1:]
        for r in con.execute(
            "SELECT id, user_id, merchant, total, currency, category, source, "
            "deleted_at FROM purchases"
        )
    }
    links = dict(con.execute("SELECT id, purchase_id FROM receipts"))
    con.close()

    assert rows["r1"] == ("u1", "Costco", 186.4, "USD", "groceries", "photo", None)
    assert rows["r2"][:6] == ("u1", "", 0.0, "USD", "other", "photo")
    assert rows["r2"][6] is not None, "deleted receipts stay deleted"
    assert links == {"r1": "r1", "r2": "r2"}

    _alembic(db, "downgrade", "a7c3e91d4b10")
    con = sqlite3.connect(db)
    tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master")}
    cols = {r[1] for r in con.execute("PRAGMA table_info(receipts)")}
    merchant = con.execute("SELECT merchant FROM receipts WHERE id='r1'").fetchone()
    con.close()
    assert "purchases" not in tables and "purchase_id" not in cols
    assert merchant == ("Costco",)
