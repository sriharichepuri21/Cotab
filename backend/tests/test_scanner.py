"""The scanner refuses what isn't a readable receipt, before saving anything."""

import uuid
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.api.v1 import receipts as receipts_api
from app.db.session import get_db
from app.main import app
from app.models import Receipt
from app.services import extraction_service
from app.services.extraction_service import REJECTION_MESSAGES, ScanRejected, assess
from app.services.gemini_service import LineItem, ReceiptExtraction

PASSWORD = "Pw12345!"

GOOD = dict(
    is_receipt=True,
    readability="good",
    merchant="Corner Market",
    total=26.15,
    currency="USD",
    category="groceries",
    date="2026-10-12",
    line_items=[LineItem(description="Oat milk", total_price=4.29)],
)


@pytest.fixture()
def stored(monkeypatch):
    """What is in file storage, instead of calling S3: saving adds a file,
    deleting removes it."""
    files = []
    monkeypatch.setattr(
        receipts_api.s3_mod,
        "upload_file",
        lambda key, data, mime: files.append((key, mime)),
    )

    def delete(key):
        files[:] = [f for f in files if f[0] != key]

    monkeypatch.setattr(receipts_api.s3_mod, "delete_file", delete)
    return files


@pytest.fixture()
def client(db_session, stored):
    app.dependency_overrides[get_db] = lambda: db_session
    yield TestClient(app)
    app.dependency_overrides.clear()


def _headers(client):
    r = client.post(
        "/api/v1/auth/register",
        json={"email": f"{uuid.uuid4().hex[:8]}@example.com", "password": PASSWORD},
    )
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _model_says(monkeypatch, **fields):
    """Run the real checks on whatever the (faked) AI returns."""
    seen = {}

    def fake_gemini(data, mime):
        seen["mime"] = mime
        return ReceiptExtraction(**fields)

    real = extraction_service.extract_receipt
    monkeypatch.setattr(
        extraction_service,
        "extract_receipt",
        lambda data, mime: real(data, mime, gemini_extract=fake_gemini),
    )
    return seen


def _upload(client, h, data=None, name="r.jpg", mime="image/jpeg"):
    data = data if data is not None else uuid.uuid4().bytes
    return client.post(
        "/api/v1/receipts/upload", headers=h, files={"file": (name, data, mime)}
    )


# --- refusals: nothing is saved -----------------------------------------------


@pytest.mark.parametrize(
    "fields, code",
    [
        ({"is_receipt": False, "problem": "not_a_receipt"}, "not_a_receipt"),
        ({"is_receipt": False}, "not_a_receipt"),
        ({"readability": "unreadable", "problem": "blurry"}, "blurry"),
        ({"readability": "unreadable", "problem": "too_dark"}, "too_dark"),
        ({"readability": "unreadable", "problem": "cut_off"}, "cut_off"),
        ({"readability": "unreadable", "problem": "something odd"}, "no_total"),
        ({"merchant": "Somewhere", "total": 0, "line_items": []}, "no_total"),
    ],
)
def test_refused_scans_leave_nothing_behind(
    client, db_session, stored, monkeypatch, fields, code
):
    _model_says(monkeypatch, **fields)
    h = _headers(client)
    r = _upload(client, h)
    assert r.status_code == 422
    assert r.json()["detail"] == {"code": code, "message": REJECTION_MESSAGES[code]}
    assert db_session.query(Receipt).count() == 0
    assert stored == []


def test_a_good_receipt_is_saved_with_its_fingerprint(client, db_session, monkeypatch):
    _model_says(monkeypatch, **GOOD)
    r = _upload(client, _headers(client), data=b"receipt-bytes")
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["status"] == "extracted"
    assert body["merchant"] == "Corner Market"
    assert body["possible_duplicate_of"] is None
    row = db_session.get(Receipt, body["id"])
    assert row.image_sha256 and len(row.image_sha256) == 64


def test_an_ai_outage_keeps_the_receipt_to_retry_later(client, db_session, monkeypatch):
    def outage(data, mime):
        raise RuntimeError("upstream timeout")

    monkeypatch.setattr(extraction_service, "extract_receipt", outage)
    r = _upload(client, _headers(client))
    assert r.status_code == 201
    assert r.json()["status"] == "failed"
    assert "upstream" not in r.text


# --- duplicates -----------------------------------------------------------------


def test_the_same_file_twice_is_refused(client, db_session, monkeypatch):
    _model_says(monkeypatch, **GOOD)
    h = _headers(client)
    first = _upload(client, h, data=b"same-photo").json()
    again = _upload(client, h, data=b"same-photo")
    assert again.status_code == 409
    assert again.json()["detail"]["code"] == "duplicate"
    assert again.json()["detail"]["receipt_id"] == first["id"]
    assert db_session.query(Receipt).count() == 1


def test_same_file_from_another_person_is_fine(client, monkeypatch):
    _model_says(monkeypatch, **GOOD)
    assert _upload(client, _headers(client), data=b"shared").status_code == 201
    assert _upload(client, _headers(client), data=b"shared").status_code == 201


def test_a_deleted_receipt_can_be_scanned_again(client, monkeypatch):
    _model_says(monkeypatch, **GOOD)
    h = _headers(client)
    first = _upload(client, h, data=b"again").json()
    client.delete(f"/api/v1/receipts/{first['id']}", headers=h)
    assert _upload(client, h, data=b"again").status_code == 201


def test_same_store_total_and_day_is_flagged_not_refused(client, monkeypatch):
    _model_says(monkeypatch, **GOOD)
    h = _headers(client)
    first = _upload(client, h).json()
    second = _upload(client, h)
    assert second.status_code == 201
    assert second.json()["possible_duplicate_of"] == first["id"]


# --- sources and formats ----------------------------------------------------------


def test_pdf_receipts_are_read_as_pdf_and_stored_as_pdf(client, stored, monkeypatch):
    seen = _model_says(monkeypatch, **GOOD)
    r = _upload(client, _headers(client), name="invoice.pdf", mime="application/pdf")
    assert r.status_code == 201, r.text
    assert seen["mime"] == "application/pdf"
    assert stored[0][0].endswith(".pdf") and stored[0][1] == "application/pdf"


@pytest.mark.parametrize("mime", ["image/heic", "image/png", "image/webp"])
def test_phone_photo_formats_are_accepted(client, monkeypatch, mime):
    _model_says(monkeypatch, **GOOD)
    assert _upload(client, _headers(client), mime=mime).status_code == 201


@pytest.mark.parametrize("mime", ["text/plain", "video/mp4", "image/gif", ""])
def test_other_files_are_refused_with_a_reason(client, mime):
    r = _upload(client, _headers(client), mime=mime or "application/octet-stream")
    assert r.status_code == 415
    assert r.json()["detail"]["code"] == "unsupported_type"


def test_an_empty_file_is_refused(client):
    r = _upload(client, _headers(client), data=b"")
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "empty"


# --- retry ----------------------------------------------------------------------


def test_retry_reads_the_stored_file_type_and_explains_refusals(
    client, db_session, monkeypatch
):
    h = _headers(client)
    me = client.get("/api/v1/auth/me", headers=h).json()
    receipt = Receipt(
        user_id=me["id"],
        status="failed",
        image_key="uploads/x/abc.pdf",
        purchased_at=datetime(2026, 10, 1, tzinfo=timezone.utc),
    )
    db_session.add(receipt)
    db_session.commit()
    monkeypatch.setattr(receipts_api.s3_mod, "download_bytes", lambda key: b"pdf")
    seen = _model_says(monkeypatch, is_receipt=False)
    r = client.post(f"/api/v1/receipts/{receipt.id}/retry", headers=h)
    assert r.status_code == 200
    assert seen["mime"] == "application/pdf"
    assert r.json()["status"] == "failed"
    assert r.json()["error_message"] == REJECTION_MESSAGES["not_a_receipt"]


# --- the checks themselves ----------------------------------------------------------


def test_partial_readability_with_a_total_is_accepted():
    assess(ReceiptExtraction(readability="partial", total=12.0))


def test_items_without_a_total_are_accepted():
    assess(ReceiptExtraction(total=0, line_items=[LineItem(description="x")]))


def test_the_word_null_counts_as_no_problem():
    with pytest.raises(ScanRejected) as e:
        assess(ReceiptExtraction(readability="unreadable", problem="null"))
    assert e.value.code == "no_total"


# --- order screenshots -------------------------------------------------------------


def test_two_screenshots_of_one_long_order_are_flagged_not_doubled(client, monkeypatch):
    """A long Amazon order in two screenshots, both showing its total."""
    _model_says(monkeypatch, **{**GOOD, "merchant": "Amazon", "screenshot": True})
    h = _headers(client)
    first = _upload(client, h, name="top.png", mime="image/png").json()
    second = _upload(client, h, name="bottom.png", mime="image/png")
    assert second.json()["possible_duplicate_of"] == first["id"]


@pytest.mark.parametrize("date", ["2001-10-22", "2099-01-01"])
def test_a_date_that_cant_be_right_keeps_the_time_it_was_added(
    client, monkeypatch, date
):
    """ "Oct 22" with no year read as 2001, or a date in the future: ignored."""
    _model_says(monkeypatch, **{**GOOD, "date": date})
    out = _upload(client, _headers(client)).json()
    assert out["status"] == "extracted"
    assert out["purchased_at"].startswith(datetime.now(timezone.utc).date().isoformat())


@pytest.mark.parametrize(
    "merchant, category",
    [
        ("Uber Eats", "dining"),
        ("DoorDash", "dining"),
        ("Amazon", "shopping"),
        ("Instacart", "groceries"),
    ],
)
def test_delivery_apps_and_amazon_land_in_their_category(
    client, monkeypatch, merchant, category
):
    _model_says(monkeypatch, **{**GOOD, "merchant": merchant, "category": "other"})
    assert _upload(client, _headers(client)).json()["category"] == category
