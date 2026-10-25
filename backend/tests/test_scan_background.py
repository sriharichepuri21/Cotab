"""Scans are saved at once and read in the background; the app polls for the
outcome. Covers each outcome, lost reads after a restart, and privacy."""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.api.v1 import receipts as receipts_api
from app.db.session import get_db
from app.main import app
from app.models import Receipt, ReceiptLineItem
from app.services import extraction_service, scan_service
from app.services.extraction_service import REJECTION_MESSAGES, ScanRejected
from app.services.gemini_service import LineItem, ReceiptExtraction

GOOD = dict(
    is_receipt=True,
    readability="good",
    merchant="Corner Market",
    total=26.15,
    currency="USD",
    category="groceries",
    date=datetime.now(timezone.utc).date().isoformat(),
    line_items=[LineItem(description="Oat milk", total_price=4.29)],
)


@pytest.fixture()
def jobs(monkeypatch):
    """Background reads are queued here instead of on threads, so a test can
    look at the 'still reading' moment and then run them."""

    class Jobs(list):
        def run_all(self):
            while self:
                scan_service._read_in_own_session(*self.pop(0))

    queued = Jobs()
    monkeypatch.setattr(scan_service.get_settings(), "scan_in_background", True)
    monkeypatch.setattr(
        scan_service,
        "submit",
        lambda rid, data=None, mime=None: queued.append((rid, data, mime)),
    )
    return queued


@pytest.fixture()
def files(monkeypatch):
    stored = {}
    monkeypatch.setattr(
        receipts_api.s3_mod,
        "upload_file",
        lambda k, d, m: stored.__setitem__(k, d.read()),
    )
    monkeypatch.setattr(
        receipts_api.s3_mod, "delete_file", lambda k: stored.pop(k, None)
    )
    monkeypatch.setattr(receipts_api.s3_mod, "download_bytes", lambda k: stored[k])
    return stored


@pytest.fixture()
def client(db_session, files):
    app.dependency_overrides[get_db] = lambda: db_session
    yield TestClient(app)
    app.dependency_overrides.clear()


def _headers(client):
    r = client.post(
        "/api/v1/auth/register",
        json={"email": f"{uuid.uuid4().hex[:8]}@example.com", "password": "pw12345"},
    )
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _ai(monkeypatch, result):
    def read(data, mime):
        if isinstance(result, Exception):
            raise result
        return ReceiptExtraction(**result)

    monkeypatch.setattr(extraction_service, "extract_receipt", read)


def _upload(client, h, data=None):
    return client.post(
        "/api/v1/receipts/upload",
        headers=h,
        files={"file": ("r.jpg", data or uuid.uuid4().bytes, "image/jpeg")},
    )


def _scan(client, h, rid):
    return client.get(f"/api/v1/receipts/{rid}/scan", headers=h).json()


def test_upload_answers_at_once_and_the_read_finishes_later(
    client, jobs, monkeypatch, db_session
):
    _ai(monkeypatch, GOOD)
    h = _headers(client)
    r = _upload(client, h)
    assert r.status_code == 201
    rid = r.json()["id"]
    assert r.json()["status"] == "processing"
    assert _scan(client, h, rid) == {
        "id": rid,
        "state": "reading",
        "receipt": None,
        "code": None,
        "message": "",
        "budget_alerts": [],
        "possible_duplicate_of": None,
    }
    # On the tab already, as "reading", so the person sees it landed.
    listed = client.get("/api/v1/receipts/", headers=h).json()
    assert [x["status"] for x in listed] == ["processing"]

    jobs.run_all()
    done = _scan(client, h, rid)
    assert done["state"] == "added"
    assert done["receipt"]["merchant"] == "Corner Market"
    assert db_session.query(ReceiptLineItem).count() == 1


def test_a_refused_scan_leaves_nothing_on_the_tab(client, jobs, files, monkeypatch):
    _ai(monkeypatch, ScanRejected("not_a_receipt"))
    h = _headers(client)
    photo = b"a photo of a cat"
    rid = _upload(client, h, photo).json()["id"]
    jobs.run_all()
    result = _scan(client, h, rid)
    assert result["state"] == "refused"
    assert result["code"] == "not_a_receipt"
    assert result["message"] == REJECTION_MESSAGES["not_a_receipt"]
    assert client.get("/api/v1/receipts/", headers=h).json() == []
    assert files == {}  # the photo was deleted
    # The same photo isn't treated as a duplicate of something refused.
    assert _upload(client, h, photo).status_code == 201


def test_a_scan_fills_in_an_apple_pay_tap(client, jobs, monkeypatch, db_session):
    _ai(monkeypatch, GOOD)
    h = _headers(client)
    me = client.get("/api/v1/auth/me", headers=h).json()
    tap = Receipt(
        user_id=me["id"],
        source="tap",
        status="extracted",
        merchant="Corner Market",
        total=26.15,
        image_key="",
        purchased_at=datetime.now(timezone.utc) - timedelta(hours=2),
    )
    db_session.add(tap)
    db_session.commit()
    rid = _upload(client, h).json()["id"]
    jobs.run_all()
    result = _scan(client, h, rid)
    assert result["state"] == "joined"
    assert result["receipt"]["id"] == tap.id
    listed = client.get("/api/v1/receipts/", headers=h).json()
    assert [x["id"] for x in listed] == [tap.id]
    db_session.refresh(tap)
    assert tap.image_key and len(tap.line_items) == 1


def test_a_split_tap_keeps_its_split_when_the_receipt_is_scanned(
    client, jobs, monkeypatch, db_session
):
    """Split the Apple Pay tap with Ben first; the scan that fills it in adds
    its items without upsetting the split."""
    db_session.execute(text("PRAGMA foreign_keys=ON"))
    _ai(monkeypatch, GOOD)
    h = _headers(client)
    me = client.get("/api/v1/auth/me", headers=h).json()
    tap = Receipt(
        user_id=me["id"],
        source="tap",
        status="extracted",
        merchant="Corner Market",
        total=26.15,
        image_key="",
        purchased_at=datetime.now(timezone.utc) - timedelta(hours=2),
    )
    db_session.add(tap)
    db_session.commit()
    tab = client.post(
        "/api/v1/splits/direct",
        headers=h,
        json={"my_name": "Ada", "members": [{"name": "Ben"}]},
    ).json()
    split = client.post(
        f"/api/v1/splits/groups/{tab['id']}/splits",
        headers=h,
        json={"receipt_id": tap.id, "paid_by": "Ada", "mode": "even"},
    )
    assert split.status_code == 200, split.text

    rid = _upload(client, h).json()["id"]
    jobs.run_all()
    assert _scan(client, h, rid)["state"] == "joined"
    summary = client.get(f"/api/v1/splits/groups/{tab['id']}/summary", headers=h).json()
    (row,) = summary["splits"]
    assert row["shares"] == [{"member": "Ben", "amount": 13.07, "settled": False}]
    db_session.refresh(tap)
    assert len(tap.line_items) == 1


def test_an_order_screenshot_is_read_and_marked_as_one(client, jobs, monkeypatch):
    _ai(monkeypatch, {**GOOD, "screenshot": True})
    h = _headers(client)
    rid = _upload(client, h).json()["id"]
    jobs.run_all()
    assert _scan(client, h, rid)["state"] == "added"
    receipt = client.get(f"/api/v1/receipts/{rid}", headers=h).json()
    assert receipt["source"] == "screenshot"


def test_an_ai_outage_keeps_it_to_read_again(client, jobs, monkeypatch):
    _ai(monkeypatch, RuntimeError("upstream down"))
    h = _headers(client)
    rid = _upload(client, h).json()["id"]
    jobs.run_all()
    result = _scan(client, h, rid)
    assert result["state"] == "failed"
    assert result["receipt"]["status"] == "failed"

    _ai(monkeypatch, GOOD)
    again = client.post(f"/api/v1/receipts/{rid}/retry", headers=h).json()
    assert again["status"] == "extracted" and again["merchant"] == "Corner Market"


def test_a_read_lost_to_a_restart_is_picked_up_once(
    client, jobs, monkeypatch, db_session
):
    _ai(monkeypatch, GOOD)
    h = _headers(client)
    rid = _upload(client, h).json()["id"]
    jobs.clear()  # the server restarted before reading it
    row = db_session.get(Receipt, rid)
    row.reading_since = datetime.now(timezone.utc) - timedelta(minutes=5)
    db_session.commit()

    assert _scan(client, h, rid)["state"] == "reading"
    assert len(jobs) == 1
    assert _scan(client, h, rid)["state"] == "reading"
    assert len(jobs) == 1  # a second poll doesn't start it twice
    jobs.run_all()
    assert _scan(client, h, rid)["state"] == "added"


def test_startup_resumes_lost_reads(client, jobs, monkeypatch, db_session):
    _ai(monkeypatch, GOOD)
    h = _headers(client)
    rid = _upload(client, h).json()["id"]
    jobs.clear()
    db_session.get(Receipt, rid).reading_since = datetime.now(timezone.utc) - timedelta(
        minutes=10
    )
    db_session.commit()
    assert scan_service.resume_stuck() == 1
    jobs.run_all()
    assert db_session.get(Receipt, rid).status == "extracted"


def test_a_fresh_read_is_not_restarted(client, jobs, monkeypatch):
    _ai(monkeypatch, GOOD)
    h = _headers(client)
    rid = _upload(client, h).json()["id"]
    jobs.clear()
    _scan(client, h, rid)
    assert jobs == []


def test_nobody_else_can_see_a_scan(client, jobs, monkeypatch):
    _ai(monkeypatch, GOOD)
    rid = _upload(client, _headers(client)).json()["id"]
    r = client.get(f"/api/v1/receipts/{rid}/scan", headers=_headers(client))
    assert r.status_code == 404


def test_wait_reads_before_answering(client, jobs, monkeypatch):
    _ai(monkeypatch, GOOD)
    r = client.post(
        "/api/v1/receipts/upload?wait=true",
        headers=_headers(client),
        files={"file": ("r.jpg", b"bytes", "image/jpeg")},
    )
    assert r.json()["status"] == "extracted"
    assert jobs == []


def test_chat_stream_is_never_compressed(client, monkeypatch):
    """Compression would hold the answer back until the end."""
    from app.services import chat_service
    from tests import fake_gemini

    monkeypatch.setattr(chat_service, "_check_rate_limit", lambda _u: None)
    monkeypatch.setattr(
        chat_service.ai_client,
        "stream",
        fake_gemini.Stream([fake_gemini.text("word " * 600)]),
    )
    h = _headers(client)
    r = client.post(
        "/api/v1/chat/stream",
        headers={**h, "Accept-Encoding": "gzip"},
        json={"message": "Tell me about my spending habits"},
    )
    assert r.status_code == 200 and len(r.content) > 1000
    assert "content-encoding" not in r.headers


def test_the_real_worker_pool_reads_it(client, monkeypatch):
    import time

    monkeypatch.setattr(scan_service.get_settings(), "scan_in_background", True)
    _ai(monkeypatch, GOOD)
    h = _headers(client)
    rid = _upload(client, h).json()["id"]
    for _ in range(50):
        state = _scan(client, h, rid)["state"]
        if state != "reading":
            break
        time.sleep(0.1)
    assert state == "added"
