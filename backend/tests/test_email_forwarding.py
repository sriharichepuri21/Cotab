"""Forwarding receipts by email: addresses, signed webhooks, and reading them."""

import base64
import hashlib
import hmac
import json
import time
import uuid
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.api.v1 import inbox as inbox_api
from app.config.settings import get_settings
from app.db.session import get_db
from app.main import app
from app.models import InboundEmail, Receipt, User
from app.services import (
    account_service,
    email_reader,
    extraction_service,
    inbound_processor,
    inbox_service,
)
from app.services.extraction_service import ScanRejected
from app.services.gemini_service import LineItem, ReceiptExtraction
from app.services.rate_limiter import _reset_for_tests

SECRET = "whsec_" + base64.b64encode(b"cotab-test-signing-key-123456").decode()
DOMAIN = "abc123.resend.app"

AMAZON_HTML = """<div>---------- Forwarded message ---------<br>From: <strong>Amazon.com</strong>
&lt;auto-confirm@amazon.com&gt;<br>Date: Sat, Oct 10, 2026 at 6:42 PM<br>
Subject: Your Amazon.com order #112-3456789<br>To: Srihari &lt;s@example.com&gt;<br></div>
<table><tr><td>Paper Towels, 12 Rolls</td><td>$21.99</td></tr>
<tr><td>Oat Milk 6-pack</td><td>$14.49</td></tr>
<tr><td>Total before tax:</td><td>$36.48</td></tr><tr><td>Estimated tax:</td><td>$3.00</td></tr>
<tr><td><b>Order Total:</b></td><td><b>$39.48</b></td></tr></table>"""

NEWSLETTER = """---------- Forwarded message ---------
From: Target <deals@em.target.com>
Date: Mon, Oct 12, 2026
Weekly deals! Save 20% on everything this weekend."""


@pytest.fixture(autouse=True)
def forwarding_on(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "resend_api_key", "re_test")
    monkeypatch.setattr(s, "resend_webhook_secret", SECRET)
    monkeypatch.setattr(s, "inbound_email_domain", DOMAIN)
    _reset_for_tests()
    yield
    _reset_for_tests()


@pytest.fixture()
def queued(monkeypatch):
    """Background work is captured instead of run, so tests can drive it."""
    jobs = []
    monkeypatch.setattr(inbox_api, "_process_later", lambda i: jobs.append(i))
    return jobs


@pytest.fixture()
def client(db_session):
    app.dependency_overrides[get_db] = lambda: db_session
    yield TestClient(app)
    app.dependency_overrides.clear()


def _account(client, name="Srihari"):
    email = f"{uuid.uuid4().hex[:8]}@example.com"
    r = client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "pw12345", "full_name": name},
    )
    return {"Authorization": f"Bearer {r.json()['access_token']}"}, email


def _sign(body: bytes, msg_id="msg_1", stamp=None, secret=SECRET):
    stamp = str(int(stamp if stamp is not None else time.time()))
    key = base64.b64decode(secret[len("whsec_") :])
    sig = base64.b64encode(
        hmac.new(key, f"{msg_id}.{stamp}.".encode() + body, hashlib.sha256).digest()
    ).decode()
    return {"svix-id": msg_id, "svix-timestamp": stamp, "svix-signature": f"v1,{sig}"}


def _notify(client, to, sender, email_id=None, subject="Your order", **extra):
    event = {
        "type": "email.received",
        "created_at": "2026-10-13T10:00:00Z",
        "data": {
            "email_id": email_id or str(uuid.uuid4()),
            "from": sender,
            "to": [to],
            "received_for": [],
            "subject": subject,
            "attachments": [],
            **extra,
        },
    }
    body = json.dumps(event).encode()
    return client.post(
        "/api/v1/inbound/resend",
        content=body,
        headers={**_sign(body), "content-type": "application/json"},
    )


# --- signatures ----------------------------------------------------------------------


def test_a_correct_signature_passes():
    body = b'{"x":1}'
    inbox_service.verify_signature(SECRET, _sign(body), body)


@pytest.mark.parametrize(
    "tamper",
    ["body", "old", "future", "secret", "missing"],
)
def test_bad_signatures_are_refused(tamper):
    body = b'{"x":1}'
    headers = _sign(body)
    if tamper == "body":
        body = b'{"x":2}'
    elif tamper == "old":
        headers = _sign(body, stamp=time.time() - 3600)
    elif tamper == "future":
        headers = _sign(body, stamp=time.time() + 3600)
    elif tamper == "secret":
        headers = _sign(body, secret="whsec_" + base64.b64encode(b"other-key").decode())
    elif tamper == "missing":
        headers = {}
    with pytest.raises(inbox_service.BadSignature):
        inbox_service.verify_signature(SECRET, headers, body)


def test_any_of_several_signatures_may_match():
    body = b"{}"
    headers = _sign(body)
    headers["svix-signature"] = "v1,bm90LWl0 " + headers["svix-signature"]
    inbox_service.verify_signature(SECRET, headers, body)


# --- the inbox in Settings ------------------------------------------------------------


def test_forwarding_is_hidden_until_switched_on(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "resend_api_key", None)
    h, _ = _account(client)
    r = client.get("/api/v1/inbox", headers=h).json()
    assert r["enabled"] is False and r["address"] is None


def test_each_person_gets_a_stable_private_address(client):
    h, email = _account(client, "Srihari Chepuri")
    first = client.get("/api/v1/inbox", headers=h).json()
    again = client.get("/api/v1/inbox", headers=h).json()
    assert first["address"] == again["address"]
    local, domain = first["address"].split("@")
    assert domain == DOMAIN
    assert local.startswith("srihari-") and len(local) == len("srihari-") + 4
    assert first["account_email"] == email


def test_a_new_address_retires_the_old_one(client, db_session, queued):
    h, email = _account(client)
    old = client.get("/api/v1/inbox", headers=h).json()["address"]
    new = client.post("/api/v1/inbox/new-address", headers=h).json()["address"]
    assert new != old
    _notify(client, old, email)
    row = db_session.query(InboundEmail).one()
    assert row.status == "ignored" and row.reason == "Unknown address"


def test_extra_senders_can_be_added_and_removed(client):
    h, _ = _account(client)
    r = client.post(
        "/api/v1/inbox/senders", headers=h, json={"email": "Work@Company.com"}
    )
    assert r.status_code == 201
    senders = r.json()["senders"]
    assert [s["email"] for s in senders] == ["work@company.com"]
    r = client.delete(f"/api/v1/inbox/senders/{senders[0]['id']}", headers=h)
    assert r.json()["senders"] == []
    again = client.post(
        "/api/v1/inbox/senders", headers=h, json={"email": "work@company.com"}
    )
    assert [s["email"] for s in again.json()["senders"]] == ["work@company.com"]


def test_a_bad_sender_address_is_refused(client):
    h, _ = _account(client)
    r = client.post("/api/v1/inbox/senders", headers=h, json={"email": "not an email"})
    assert r.status_code == 422


# --- the webhook --------------------------------------------------------------------


def test_the_webhook_is_off_until_configured(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "inbound_email_domain", None)
    body = b"{}"
    assert (
        client.post(
            "/api/v1/inbound/resend", content=body, headers=_sign(body)
        ).status_code
        == 404
    )


def test_an_unsigned_webhook_is_refused(client, db_session):
    r = client.post("/api/v1/inbound/resend", content=b'{"type":"email.received"}')
    assert r.status_code == 401
    assert db_session.query(InboundEmail).count() == 0


def test_mail_from_you_is_queued_for_reading(client, db_session, queued):
    h, email = _account(client)
    address = client.get("/api/v1/inbox", headers=h).json()["address"]
    r = _notify(client, f"Me <{address}>", f"Srihari <{email.upper()}>")
    assert r.status_code == 200
    row = db_session.query(InboundEmail).one()
    assert row.status == "queued" and queued == [row.id]


def test_mail_from_a_stranger_is_ignored_with_a_reason(client, db_session, queued):
    h, _ = _account(client)
    address = client.get("/api/v1/inbox", headers=h).json()["address"]
    _notify(client, address, "spammer@bad.example")
    row = db_session.query(InboundEmail).one()
    assert row.status == "ignored" and "Add it in Settings" in row.reason
    assert queued == []


def test_gmails_forwarding_code_is_shown_so_setup_can_finish(
    client, db_session, queued
):
    h, _ = _account(client)
    address = client.get("/api/v1/inbox", headers=h).json()["address"]
    _notify(
        client,
        address,
        "Gmail Team <forwarding-noreply@google.com>",
        subject="(#527916344) Gmail Forwarding Confirmation - Receive Mail from s@gmail.com",
    )
    recent = client.get("/api/v1/inbox", headers=h).json()["recent"][0]
    assert "527916344" in recent["reason"]
    assert queued == []


def test_an_added_sender_is_accepted(client, db_session, queued):
    h, _ = _account(client)
    address = client.get("/api/v1/inbox", headers=h).json()["address"]
    client.post("/api/v1/inbox/senders", headers=h, json={"email": "me@work.com"})
    _notify(client, address, "Me <me@work.com>")
    assert db_session.query(InboundEmail).one().status == "queued"


def test_the_same_notification_twice_is_handled_once(client, db_session, queued):
    h, email = _account(client)
    address = client.get("/api/v1/inbox", headers=h).json()["address"]
    _notify(client, address, email, email_id="same-id")
    _notify(client, address, email, email_id="same-id")
    assert db_session.query(InboundEmail).count() == 1
    assert len(queued) == 1


def test_other_event_types_are_acknowledged_and_ignored(client, db_session):
    body = json.dumps({"type": "email.sent", "data": {}}).encode()
    r = client.post("/api/v1/inbound/resend", content=body, headers=_sign(body))
    assert r.status_code == 200
    assert db_session.query(InboundEmail).count() == 0


# --- reading -----------------------------------------------------------------------


def _fake_resend(monkeypatch, message, attachments=(), files=None):
    monkeypatch.setattr(inbox_service, "fetch_email", lambda i: message)
    monkeypatch.setattr(inbox_service, "fetch_attachments", lambda i: list(attachments))
    monkeypatch.setattr(
        inbox_service, "download", lambda url, limit: (files or {}).get(url)
    )
    stored = []
    monkeypatch.setattr(
        inbound_processor.s3_mod, "upload_file", lambda k, d, m: stored.append((k, m))
    )
    return stored


def _queued_email(client, db_session, queued, sender=None):
    h, email = _account(client)
    address = client.get("/api/v1/inbox", headers=h).json()["address"]
    _notify(client, address, sender or email)
    return h, email, queued[-1]


def test_an_amazon_order_email_lands_itemized(client, db_session, queued, monkeypatch):
    h, email, job = _queued_email(client, db_session, queued)
    _fake_resend(monkeypatch, {"from": email, "html": AMAZON_HTML, "text": None})
    monkeypatch.setattr(
        extraction_service,
        "extract_receipt_text",
        lambda text: ReceiptExtraction(
            merchant="Srihari's Gmail",  # the AI picked up the forwarder: ignored
            total=36.48,  # and summed before tax: the printed Order Total wins
            category="shopping",
            line_items=[
                LineItem(description="Paper Towels, 12 Rolls", total_price=21.99),
                LineItem(description="Oat Milk 6-pack", total_price=14.49),
            ],
        ),
    )
    inbound_processor.process(job, db=db_session)
    row = db_session.get(InboundEmail, job)
    assert row.status == "added", row.reason
    receipt = db_session.get(Receipt, row.receipt_id)
    assert (receipt.merchant, receipt.total, receipt.source) == (
        "Amazon",
        39.48,
        "email",
    )
    assert receipt.purchased_at.date().isoformat() == "2026-10-10"
    assert len(receipt.line_items) == 2


def test_a_newsletter_is_skipped_not_added(client, db_session, queued, monkeypatch):
    _, email, job = _queued_email(client, db_session, queued)
    _fake_resend(monkeypatch, {"from": email, "text": NEWSLETTER})

    def not_receipt(text):
        raise ScanRejected("not_a_receipt")

    monkeypatch.setattr(extraction_service, "extract_receipt_text", not_receipt)
    inbound_processor.process(job, db=db_session)
    row = db_session.get(InboundEmail, job)
    assert row.status == "skipped" and "doesn't look like a receipt" in row.reason
    assert db_session.query(Receipt).count() == 0


def test_when_the_ai_is_down_the_printed_total_still_lands(
    client, db_session, queued, monkeypatch
):
    _, email, job = _queued_email(client, db_session, queued)
    _fake_resend(monkeypatch, {"from": email, "html": AMAZON_HTML})

    def down(text):
        raise RuntimeError("quota")

    monkeypatch.setattr(extraction_service, "extract_receipt_text", down)
    inbound_processor.process(job, db=db_session)
    row = db_session.get(InboundEmail, job)
    assert row.status == "added"
    receipt = db_session.get(Receipt, row.receipt_id)
    assert (receipt.merchant, receipt.total) == ("Amazon", 39.48)


def test_a_pdf_receipt_attachment_is_read_and_kept(
    client, db_session, queued, monkeypatch
):
    _, email, job = _queued_email(client, db_session, queued)
    stored = _fake_resend(
        monkeypatch,
        {
            "from": email,
            "text": "Your receipt is attached.",
            "attachments": [{"id": "a"}],
        },
        attachments=[
            {
                "content_type": "image/png",
                "content_disposition": "inline",
                "size": 900,
                "download_url": "logo",
            },
            {
                "content_type": "application/pdf",
                "filename": "invoice.pdf",
                "size": 40_000,
                "download_url": "pdf",
            },
        ],
        files={"pdf": b"%PDF-1.4", "logo": b"png"},
    )
    seen = {}

    def read_file(data, mime):
        seen["mime"] = mime
        return ReceiptExtraction(merchant="Comcast", total=79.99, category="utilities")

    monkeypatch.setattr(extraction_service, "extract_receipt", read_file)
    inbound_processor.process(job, db=db_session)
    row = db_session.get(InboundEmail, job)
    assert row.status == "added"
    assert seen["mime"] == "application/pdf"
    assert stored and stored[0][1] == "application/pdf"
    assert db_session.get(Receipt, row.receipt_id).image_key == stored[0][0]


def test_an_emailed_receipt_joins_its_apple_pay_tap(
    client, db_session, queued, monkeypatch
):
    h, email, job = _queued_email(client, db_session, queued)
    key = client.post("/api/v1/capture/keys", headers=h, json={}).json()["key"]
    tap = client.post(
        "/api/v1/capture/tap",
        headers={"Authorization": f"Bearer {key}"},
        json={"merchant": "AMAZON MKTPLACE", "amount": "$39.48"},
    ).json()
    html = AMAZON_HTML.replace("Sat, Oct 10, 2026 at 6:42 PM", "today")
    _fake_resend(monkeypatch, {"from": email, "html": html})
    monkeypatch.setattr(
        extraction_service,
        "extract_receipt_text",
        lambda text: ReceiptExtraction(merchant="Amazon", total=39.48),
    )
    inbound_processor.process(job, db=db_session)
    row = db_session.get(InboundEmail, job)
    assert row.status == "matched" and row.receipt_id == tap["receipt_id"]
    assert db_session.query(Receipt).count() == 1


def test_an_order_email_joins_the_screenshot_of_the_same_order(
    client, db_session, queued, monkeypatch
):
    """Screenshot the Amazon order, then forward its email: one purchase."""
    h, email, job = _queued_email(client, db_session, queued)
    me = client.get("/api/v1/auth/me", headers=h).json()
    shot = Receipt(
        user_id=me["id"],
        source="screenshot",
        status="extracted",
        merchant="Amazon",
        total=39.48,
        image_key="receipts/shot.png",
        purchased_at=datetime.now(timezone.utc),
    )
    db_session.add(shot)
    db_session.commit()
    html = AMAZON_HTML.replace("Sat, Oct 10, 2026 at 6:42 PM", "today")
    _fake_resend(monkeypatch, {"from": email, "html": html})
    monkeypatch.setattr(
        extraction_service,
        "extract_receipt_text",
        lambda text: ReceiptExtraction(
            merchant="Amazon",
            total=39.48,
            line_items=[
                LineItem(description="Paper Towels, 12 Rolls", total_price=21.99),
                LineItem(description="Oat Milk 6-pack", total_price=14.49),
            ],
        ),
    )
    inbound_processor.process(job, db=db_session)
    row = db_session.get(InboundEmail, job)
    assert row.status == "matched" and row.receipt_id == shot.id
    assert "already on your tab" in row.reason.lower()
    assert db_session.query(Receipt).filter(Receipt.deleted_at.is_(None)).count() == 1
    db_session.refresh(shot)
    assert len(shot.line_items) == 2  # the email filled in what the screenshot lacked


def test_mail_that_fails_sender_checks_is_ignored(
    client, db_session, queued, monkeypatch
):
    _, email, job = _queued_email(client, db_session, queued)
    _fake_resend(
        monkeypatch,
        {
            "from": email,
            "text": "Total $5",
            "authentication": {"spf": "fail", "dkim": "fail", "dmarc": "fail"},
        },
    )
    inbound_processor.process(job, db=db_session)
    assert db_session.get(InboundEmail, job).status == "ignored"


def test_processing_twice_does_nothing_the_second_time(
    client, db_session, queued, monkeypatch
):
    _, email, job = _queued_email(client, db_session, queued)
    _fake_resend(monkeypatch, {"from": email, "html": AMAZON_HTML})
    monkeypatch.setattr(
        extraction_service,
        "extract_receipt_text",
        lambda text: ReceiptExtraction(merchant="Amazon", total=39.48),
    )
    inbound_processor.process(job, db=db_session)
    inbound_processor.process(job, db=db_session)
    assert db_session.query(Receipt).count() == 1


def test_recent_emails_show_in_settings(client, db_session, queued):
    h, _ = _account(client)
    address = client.get("/api/v1/inbox", headers=h).json()["address"]
    _notify(client, address, "stranger@x.example", subject="Hello")
    recent = client.get("/api/v1/inbox", headers=h).json()["recent"]
    assert recent[0]["subject"] == "Hello" and recent[0]["status"] == "ignored"


def test_deleting_the_account_frees_the_address(client, db_session, queued):
    h, email = _account(client)
    address = client.get("/api/v1/inbox", headers=h).json()["address"]
    user = db_session.query(User).filter(User.email == email).one()
    account_service.delete_account(db_session, user)
    _notify(client, address, email)
    assert db_session.query(InboundEmail).one().reason == "Unknown address"


# --- the plain-code reader on its own ---------------------------------------------------


@pytest.mark.parametrize(
    "text, merchant, total, currency",
    [
        (email_reader.html_to_text(AMAZON_HTML), "Amazon", 39.48, "USD"),
        (
            "Begin forwarded message:\n\nFrom: Uber Receipts <noreply@uber.com>\n"
            "Date: October 8, 2026 at 9:14 PM\n\nTotal  $18.64\nTrip fare  $15.20\n",
            "Uber",
            18.64,
            "USD",
        ),
        (
            "From: Blue Bottle Coffee via Square <receipts@messaging.squareup.com>\n"
            "Latte $5.75\nTotal €10,00\n",
            "Blue Bottle Coffee",
            10.0,
            "EUR",
        ),
        (NEWSLETTER, "Target", None, None),
    ],
)
def test_plain_code_reading(text, merchant, total, currency):
    got = email_reader.read(text, "")
    assert (got.merchant, got.total, got.currency) == (merchant, total, currency)
