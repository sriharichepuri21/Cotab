"""Apple Pay taps: private keys, the tap endpoint, and matching a later receipt."""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.api.v1 import receipts as receipts_api
from app.db.session import get_db
from app.main import app
from app.models import Budget, CaptureKey, Purchase, Receipt
from app.services import account_service, capture_service, extraction_service
from app.services.capture_service import clean_merchant, parse_amount, same_store
from app.services.gemini_service import LineItem, ReceiptExtraction
from app.services.rate_limiter import _reset_for_tests

PASSWORD = "pw12345"


@pytest.fixture(autouse=True)
def fresh_limits():
    _reset_for_tests()
    yield
    _reset_for_tests()


@pytest.fixture()
def client(db_session, monkeypatch):
    monkeypatch.setattr(receipts_api.s3_mod, "upload_file", lambda *a, **k: None)
    app.dependency_overrides[get_db] = lambda: db_session
    yield TestClient(app)
    app.dependency_overrides.clear()


def _account(client):
    r = client.post(
        "/api/v1/auth/register",
        json={"email": f"{uuid.uuid4().hex[:8]}@example.com", "password": PASSWORD},
    )
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _key(client, h, name="iPhone"):
    r = client.post("/api/v1/capture/keys", headers=h, json={"name": name})
    assert r.status_code == 201, r.text
    return r.json()


def _tap(client, key, **body):
    return client.post(
        "/api/v1/capture/tap", headers={"Authorization": f"Bearer {key}"}, json=body
    )


# --- reading what Wallet sends ------------------------------------------------------


@pytest.mark.parametrize(
    "raw, amount, currency",
    [
        ("$5.75", 5.75, "USD"),
        ("5,75 €", 5.75, "EUR"),
        ("€1.234,56", 1234.56, "EUR"),
        ("1,234.56", 1234.56, None),
        ("USD 12.00", 12.0, "USD"),
        ("£3", 3.0, "GBP"),
        ("₹ 450", 450.0, "INR"),
        (7.5, 7.5, None),
        ("", None, None),
        ("free", None, None),
        (True, None, None),
    ],
)
def test_amounts_in_every_shape_wallet_uses(raw, amount, currency):
    assert parse_amount(raw) == (amount, currency)


@pytest.mark.parametrize(
    "raw, clean",
    [
        ("SAFEWAY #1234", "Safeway"),
        ("Starbucks Store #5521", "Starbucks"),
        ("Trader Joe's", "Trader Joe's"),
        ("Shell Oil 5733", "Shell Oil"),
        ("7-Eleven", "7-Eleven"),
        ("", "Apple Pay purchase"),
    ],
)
def test_store_names_lose_their_store_numbers(raw, clean):
    assert clean_merchant(raw) == clean


@pytest.mark.parametrize(
    "a, b, same",
    [
        ("Safeway", "SAFEWAY #1234", True),
        ("Trader Joe's", "TRADER JOES #77", True),
        ("Whole Foods Market", "Whole Foods", True),
        ("Shell", "Shell Oil 5733", True),
        ("Target", "Starbucks", False),
        ("CVS", "CVS/pharmacy", True),
        ("Amazon", "", False),
    ],
)
def test_store_matching(a, b, same):
    assert same_store(a, b) is same


# --- keys ----------------------------------------------------------------------------


def test_a_key_is_shown_once_and_stored_only_as_a_fingerprint(client, db_session):
    h = _account(client)
    made = _key(client, h)
    assert made["key"].startswith("ctb_") and len(made["key"]) > 30
    row = db_session.get(CaptureKey, made["id"])
    assert row.key_hash != made["key"] and made["key"] not in row.key_hash
    listed = client.get("/api/v1/capture/status", headers=h).json()["keys"]
    assert [k["id"] for k in listed] == [made["id"]]
    assert "key" not in listed[0]


def test_keys_are_capped(client):
    h = _account(client)
    for i in range(capture_service.MAX_KEYS):
        _key(client, h, f"phone {i}")
    r = client.post("/api/v1/capture/keys", headers=h, json={})
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "too_many_keys"


def test_a_revoked_key_stops_working(client):
    h = _account(client)
    made = _key(client, h)
    assert _tap(client, made["key"], merchant="Cafe", amount="$3").status_code == 201
    assert (
        client.delete(f"/api/v1/capture/keys/{made['id']}", headers=h).status_code
        == 204
    )
    r = _tap(client, made["key"], merchant="Cafe", amount="$4")
    assert r.status_code == 401
    assert r.json()["detail"]["code"] == "bad_key"


def test_someone_elses_key_cannot_be_revoked(client):
    mine = _key(client, _account(client))
    other = _account(client)
    assert (
        client.delete(f"/api/v1/capture/keys/{mine['id']}", headers=other).status_code
        == 404
    )


def test_deleting_the_account_kills_its_keys(client, db_session):
    h = _account(client)
    made = _key(client, h)
    user = db_session.get(CaptureKey, made["id"]).user_id
    from app.models import User

    account_service.delete_account(db_session, db_session.get(User, user))
    assert _tap(client, made["key"], merchant="Cafe", amount=3).status_code == 401


# --- taps --------------------------------------------------------------------------


def test_a_tap_lands_on_the_tab_with_no_ai(client, db_session, monkeypatch):
    monkeypatch.setattr(
        extraction_service,
        "extract_receipt",
        lambda *a, **k: (_ for _ in ()).throw(AssertionError("no AI for taps")),
    )
    h = _account(client)
    key = _key(client, h)["key"]
    r = _tap(client, key, merchant="STARBUCKS STORE #5521", amount="$5.75", card="Visa")
    assert r.status_code == 201, r.text
    assert r.json()["message"] == "Starbucks $5.75 is on your tab."
    row = db_session.get(Receipt, r.json()["receipt_id"])
    assert (row.source, row.status, row.total, row.category) == (
        "tap",
        "reviewed",
        5.75,
        "drinks",
    )
    assert db_session.get(Purchase, row.id).source == "tap"
    listed = client.get("/api/v1/receipts/", headers=h).json()
    assert listed[0]["source"] == "tap"
    status = client.get("/api/v1/capture/status", headers=h).json()
    assert status["taps_this_month"] == 1 and status["last_tap_at"]
    assert status["keys"][0]["last_used_at"]


def test_the_store_keeps_the_category_you_used_before(client, db_session):
    h = _account(client)
    key = _key(client, h)["key"]
    first = _tap(client, key, merchant="Blue Door", amount=12).json()["receipt_id"]
    client.post(
        "/api/v1/receipts/bulk",
        headers=h,
        json={
            "receipt_ids": [first],
            "action": "categorize",
            "category": "entertainment",
        },
    )
    second = _tap(client, key, merchant="Blue Door", amount=14).json()["receipt_id"]
    assert db_session.get(Receipt, second).category == "entertainment"


def test_a_double_fired_tap_is_kept_once(client, db_session):
    key = _key(client, _account(client))["key"]
    a = _tap(client, key, merchant="Shell", amount="$40.00")
    b = _tap(client, key, merchant="Shell", amount="$40.00")
    assert a.status_code == 201 and b.status_code == 200
    assert b.json()["duplicate"] is True
    assert db_session.query(Receipt).count() == 1


def test_field_names_are_forgiving(client):
    key = _key(client, _account(client))["key"]
    r = _tap(client, key, Merchant="Cafe", Amount="3.20")
    assert r.status_code == 201
    r = client.post(
        "/api/v1/capture/tap",
        headers={"X-Cotab-Key": key},
        json={"store": "Deli", "total": 9},
    )
    assert r.status_code == 201


@pytest.mark.parametrize(
    "body", [{"merchant": "Cafe"}, {"merchant": "Cafe", "amount": "$0"}, []]
)
def test_a_tap_without_an_amount_is_refused_clearly(client, body):
    key = _key(client, _account(client))["key"]
    r = client.post(
        "/api/v1/capture/tap", headers={"Authorization": f"Bearer {key}"}, json=body
    )
    assert r.status_code == 422
    assert r.json()["detail"]["code"] in ("no_amount", "bad_body")


@pytest.mark.parametrize("header", [None, "Bearer nope", "Bearer ctb_madeup"])
def test_taps_need_a_real_key(client, header):
    headers = {"Authorization": header} if header else {}
    r = client.post("/api/v1/capture/tap", headers=headers, json={"amount": 3})
    assert r.status_code == 401


def test_a_signed_in_session_token_is_not_a_tap_key(client):
    h = _account(client)
    r = client.post("/api/v1/capture/tap", headers=h, json={"amount": 3})
    assert r.status_code == 401


def test_a_tap_mentions_a_budget_it_pushes_over_the_line(client, db_session):
    h = _account(client)
    key = _key(client, h)["key"]
    me = client.get("/api/v1/auth/me", headers=h).json()
    db_session.add(
        Budget(
            user_id=me["id"],
            level="category",
            target="drinks",
            period="monthly",
            amount=10,
        )
    )
    db_session.commit()
    r = _tap(client, key, merchant="Starbucks", amount="$9.50")
    assert "drinks" in r.json()["message"].lower()
    assert "budget" in r.json()["message"]


# --- matching the receipt that comes later --------------------------------------------


def _scan(client, h, monkeypatch, **fields):
    def fake(data, mime, gemini_extract=None):
        return ReceiptExtraction(**fields)

    monkeypatch.setattr(extraction_service, "extract_receipt", fake)
    return client.post(
        "/api/v1/receipts/upload",
        headers=h,
        files={"file": ("r.jpg", uuid.uuid4().bytes, "image/jpeg")},
    )


def test_scanning_the_receipt_fills_in_the_tap(client, db_session, monkeypatch):
    h = _account(client)
    key = _key(client, h)["key"]
    tap = _tap(client, key, merchant="SAFEWAY #1234", amount="$41.20").json()
    today = datetime.now(timezone.utc).date().isoformat()
    r = _scan(
        client,
        h,
        monkeypatch,
        merchant="Safeway",
        total=41.20,
        date=today,
        category="groceries",
        line_items=[LineItem(description="Bananas", total_price=1.99)],
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["id"] == tap["receipt_id"]
    assert body["matched_tap"] is True
    assert body["possible_duplicate_of"] is None
    assert [li["description"] for li in body["line_items"]] == ["Bananas"]
    assert db_session.query(Receipt).filter(Receipt.deleted_at.is_(None)).count() == 1
    row = db_session.get(Receipt, tap["receipt_id"])
    assert row.image_key and row.source == "tap"


def test_a_different_amount_is_a_different_purchase(client, db_session, monkeypatch):
    h = _account(client)
    key = _key(client, h)["key"]
    _tap(client, key, merchant="Safeway", amount="$41.20")
    r = _scan(client, h, monkeypatch, merchant="Safeway", total=12.00)
    assert r.json()["matched_tap"] is False
    assert db_session.query(Receipt).count() == 2


def test_an_old_tap_is_not_matched(client, db_session, monkeypatch):
    h = _account(client)
    key = _key(client, h)["key"]
    tap = _tap(client, key, merchant="Safeway", amount="$41.20").json()
    row = db_session.get(Receipt, tap["receipt_id"])
    row.purchased_at = datetime.now(timezone.utc) - timedelta(days=5)
    db_session.commit()
    r = _scan(client, h, monkeypatch, merchant="Safeway", total=41.20)
    assert r.json()["matched_tap"] is False


def test_a_tap_already_matched_is_not_matched_again(client, db_session, monkeypatch):
    h = _account(client)
    key = _key(client, h)["key"]
    _tap(client, key, merchant="Safeway", amount="$41.20")
    today = datetime.now(timezone.utc).date().isoformat()
    first = _scan(client, h, monkeypatch, merchant="Safeway", total=41.20, date=today)
    second = _scan(client, h, monkeypatch, merchant="Safeway", total=41.20, date=today)
    assert first.json()["matched_tap"] is True
    assert second.json()["matched_tap"] is False
    assert second.json()["possible_duplicate_of"] == first.json()["id"]


def test_someone_elses_tap_is_never_matched(client, db_session, monkeypatch):
    theirs = _key(client, _account(client))["key"]
    _tap(client, theirs, merchant="Safeway", amount="$41.20")
    mine = _account(client)
    r = _scan(client, mine, monkeypatch, merchant="Safeway", total=41.20)
    assert r.json()["matched_tap"] is False
