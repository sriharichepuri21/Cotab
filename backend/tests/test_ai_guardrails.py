"""AI cost guardrails: every call is logged with an estimated cost, daily caps
stop spending per person and for the whole app, and the everyday model only
hands a receipt to the stronger one when it wasn't sure."""

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.api.v1 import receipts as receipts_api
from app.db.session import get_db
from app.main import app
from app.models import AIUsage, Receipt
from app.services import (
    account_service,
    ai_usage,
    chat_service,
    extraction_service,
    gemini_service,
    inbound_processor,
)
from app.services.gemini_service import ReceiptExtraction
from tests import fake_gemini

PASSWORD = "Pw12345!"


def _usage(prompt=1000, output=200, total=None):
    return SimpleNamespace(
        prompt_token_count=prompt,
        candidates_token_count=output,
        total_token_count=total if total is not None else prompt + output,
    )


def _spend(db, cost, user_id=None, when=None):
    db.add(
        AIUsage(
            user_id=user_id,
            feature="scan",
            model="gemini-3.5-flash-lite",
            input_tokens=0,
            output_tokens=0,
            cost_usd=cost,
            created_at=when or datetime.now(timezone.utc),
        )
    )
    db.commit()


@pytest.fixture()
def budgets(monkeypatch):
    s = ai_usage.get_settings()
    monkeypatch.setattr(s, "ai_user_daily_budget_usd", 0.25)
    monkeypatch.setattr(s, "ai_daily_budget_usd", 3.00)
    return s


# --- cost estimates -------------------------------------------------------------


def test_cost_counts_thinking_as_output():
    # 1,000 in; 200 answer + 800 thinking = 1,000 out.
    assert ai_usage.tokens_from(
        SimpleNamespace(usage_metadata=_usage(1000, 200, 2000))
    ) == (
        1000,
        1000,
    )
    # 1,000 x $0.30 + 1,000 x $2.50, per million.
    assert ai_usage.estimate_cost("gemini-3.5-flash-lite", 1000, 1000) == pytest.approx(
        0.0028
    )


def test_unknown_models_are_priced_cautiously():
    assert ai_usage.estimate_cost("some-new-model", 1_000_000, 0) == 1.50


def test_a_response_without_usage_costs_nothing():
    assert ai_usage.tokens_from(SimpleNamespace()) == (0, 0)


# --- logging and caps -----------------------------------------------------------


def test_each_call_is_logged_against_the_person(db_session, user, budgets):
    with ai_usage.acting_for(user.id):
        ai_usage.guarded(
            "scan",
            "gemini-3.5-flash-lite",
            lambda: SimpleNamespace(usage_metadata=_usage(1500, 500)),
        )
    row = db_session.query(AIUsage).one()
    assert (row.user_id, row.feature, row.input_tokens, row.output_tokens) == (
        user.id,
        "scan",
        1500,
        500,
    )
    assert row.cost_usd == pytest.approx((1500 * 0.30 + 500 * 2.50) / 1e6)


def test_a_person_over_their_daily_cap_is_stopped(
    db_session, user, other_user, budgets
):
    _spend(db_session, 0.25, user.id)
    with pytest.raises(ai_usage.AILimitReached) as stopped:
        ai_usage.check(user.id)
    assert stopped.value.scope == "user"
    ai_usage.check(other_user.id)  # everyone else carries on


def test_yesterdays_spending_does_not_count(db_session, user, budgets):
    _spend(
        db_session, 5.0, user.id, when=datetime.now(timezone.utc) - timedelta(days=1)
    )
    ai_usage.check(user.id)


def test_the_whole_app_stops_at_its_daily_cap(db_session, user, budgets):
    _spend(db_session, 3.0)
    with pytest.raises(ai_usage.AILimitReached) as stopped:
        ai_usage.check(user.id)
    assert stopped.value.scope == "app"
    assert "paused" in stopped.value.message


def test_a_capped_call_never_reaches_the_ai(db_session, user, budgets):
    _spend(db_session, 1.0, user.id)

    def boom():
        raise AssertionError("the AI should not be called")

    with ai_usage.acting_for(user.id), pytest.raises(ai_usage.AILimitReached):
        ai_usage.guarded("scan", "gemini-3.5-flash-lite", boom)


def test_a_broken_usage_table_does_not_stop_scanning(monkeypatch):
    def broken():
        raise RuntimeError("database down")

    monkeypatch.setattr(ai_usage, "_factory", broken)
    ai_usage.check("someone")
    ai_usage.record("scan", "gemini-3.5-flash-lite", SimpleNamespace())


# --- everyday model, second look ------------------------------------------------


READ = dict(is_receipt=True, merchant="Corner Market", total=26.15, confidence=0.9)


@pytest.fixture()
def models(monkeypatch, db_session, budgets):
    s = gemini_service.settings
    monkeypatch.setattr(s, "gemini_api_key", "test")
    monkeypatch.setattr(s, "gemini_model", "gemini-3.5-flash-lite")
    monkeypatch.setattr(s, "gemini_upgrade_model", "gemini-3.8-flash")

    def install(lite, flash=None):
        fake = fake_gemini.Generate(
            {"gemini-3.5-flash-lite": lite, "gemini-3.8-flash": flash or {}}
        )
        monkeypatch.setattr(gemini_service.ai_client, "generate", fake)
        return fake

    return install


def test_a_clear_receipt_is_read_once_by_the_cheap_model(models, db_session):
    fake = models({**READ, "readability": "good"})
    out = gemini_service.extract_receipt_from_image(b"img", "image/jpeg")
    assert out.total == 26.15
    assert [c[0] for c in fake.calls] == ["gemini-3.5-flash-lite"]
    # Asks for bare JSON, so there are fewer output tokens to pay for.
    assert fake.calls[0][1].response_mime_type == "application/json"
    assert db_session.query(AIUsage).count() == 1


def test_an_unsure_read_gets_a_second_look(models, db_session):
    fake = models(
        {**READ, "readability": "partial", "total": 20.0, "confidence": 0.5},
        {**READ, "readability": "good", "total": 26.15, "confidence": 0.95},
    )
    out = gemini_service.extract_receipt_from_image(b"img", "image/jpeg")
    assert [c[0] for c in fake.calls] == ["gemini-3.5-flash-lite", "gemini-3.8-flash"]
    assert out.total == 26.15
    assert {r.model for r in db_session.query(AIUsage)} == {
        "gemini-3.5-flash-lite",
        "gemini-3.8-flash",
    }


def test_the_second_look_only_wins_when_it_is_surer(models):
    models(
        {**READ, "readability": "partial", "total": 20.0, "confidence": 0.55},
        {**READ, "readability": "unreadable", "total": 0, "confidence": 0.2},
    )
    assert gemini_service.extract_receipt_from_image(b"img", "image/jpeg").total == 20.0


def test_a_second_look_cannot_turn_a_receipt_into_a_non_receipt(models):
    models(
        {**READ, "readability": "partial", "total": 20.0, "confidence": 0.5},
        {"is_receipt": False, "readability": "good", "confidence": 0.99},
    )
    out = gemini_service.extract_receipt_from_image(b"img", "image/jpeg")
    assert out.is_receipt and out.total == 20.0


@pytest.mark.parametrize(
    "first",
    [
        {"is_receipt": False, "problem": "not_a_receipt"},
        {**READ, "readability": "unreadable", "problem": "blurry"},
        {**READ, "readability": "unreadable", "problem": "too_dark"},
    ],
)
def test_no_second_look_for_photos_a_better_model_cannot_fix(models, first):
    fake = models(first)
    gemini_service.extract_receipt_from_image(b"img", "image/jpeg")
    assert len(fake.calls) == 1


def test_no_second_look_once_the_budget_is_spent(models, db_session, user):
    fake = models({**READ, "readability": "partial", "confidence": 0.4})
    _spend(db_session, 0.2495, user.id)  # the first read ($0.0008) tips it over
    with ai_usage.acting_for(user.id):
        out = gemini_service.extract_receipt_from_image(b"img", "image/jpeg")
    assert out.total == 26.15
    assert len(fake.calls) == 1


def test_emails_use_the_cheap_model_and_are_logged_as_email(models, db_session):
    fake = models({**READ, "readability": "good"})
    gemini_service.extract_receipt_from_text("Order total $26.15")
    assert [c[0] for c in fake.calls] == ["gemini-3.5-flash-lite"]
    assert db_session.query(AIUsage).one().feature == "email"


# --- what people see when a cap is reached ---------------------------------------


@pytest.fixture()
def client(db_session, monkeypatch):
    monkeypatch.setattr(receipts_api.s3_mod, "upload_file", lambda *a: None)
    app.dependency_overrides[get_db] = lambda: db_session
    yield TestClient(app)
    app.dependency_overrides.clear()


def _register(client):
    r = client.post(
        "/api/v1/auth/register",
        json={"email": f"{uuid.uuid4().hex[:8]}@example.com", "password": PASSWORD},
    )
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_a_scan_over_the_cap_keeps_the_photo_for_later(client, db_session, monkeypatch):
    def capped(data, mime):
        raise ai_usage.AILimitReached("user")

    monkeypatch.setattr(extraction_service, "extract_receipt", capped)
    r = client.post(
        "/api/v1/receipts/upload",
        headers=_register(client),
        files={"file": ("r.jpg", uuid.uuid4().bytes, "image/jpeg")},
    )
    assert r.status_code in (200, 201)
    receipt = db_session.get(Receipt, r.json()["id"])
    assert receipt.status == "failed"
    assert "today's limit" in receipt.error_message
    assert "Read it again" in receipt.error_message
    assert receipt.image_key


def test_scans_are_attributed_to_the_person_who_uploaded(
    client, db_session, monkeypatch
):
    seen = []

    def read(data, mime):
        seen.append(ai_usage.current_user())
        return ReceiptExtraction(**READ)

    monkeypatch.setattr(extraction_service, "extract_receipt", read)
    h = _register(client)
    client.post(
        "/api/v1/receipts/upload",
        headers=h,
        files={"file": ("r.jpg", uuid.uuid4().bytes, "image/jpeg")},
    )
    me = client.get("/api/v1/auth/me", headers=h).json()
    assert seen == [me["id"]]
    assert ai_usage.current_user() is None  # nothing leaks into later requests


def test_an_email_over_the_cap_falls_back_to_reading_the_total_itself():
    def capped(text):
        raise ai_usage.AILimitReached("app")

    message = {
        "from": "Corner Market <orders@cornermarket.com>",
        "subject": "Your receipt",
        "text": "Thanks for shopping!\nOrder total: $26.15\n",
    }
    got, why = inbound_processor.read_email(message, read_text=capped)
    assert got is not None and got.total == 26.15 and why == ""

    got, why = inbound_processor.read_email(
        {"from": "x@example.com", "text": "hello"}, read_text=capped
    )
    assert got is None and "paused" in why


def test_chat_over_the_cap_says_so_without_calling_the_ai(
    db_session, user, budgets, monkeypatch
):
    def boom(*_a, **_k):
        raise AssertionError("the AI should not be called")

    monkeypatch.setattr(chat_service.ai_client, "stream", boom)
    monkeypatch.setattr(chat_service, "_check_rate_limit", lambda _u: None)
    _spend(db_session, 0.30, user.id)
    result = chat_service.process_chat_message(
        db_session,
        db_session,
        user.id,
        "Which store do I visit most on weekends?",
        None,
    )
    assert "today's limit" in result.message


def test_chat_calls_are_logged(db_session, user, budgets, monkeypatch):
    monkeypatch.setattr(
        chat_service.ai_client,
        "stream",
        fake_gemini.Stream(
            [
                fake_gemini.text("You spent the most at "),
                fake_gemini.text(
                    "Corner Market.", meta=fake_gemini.usage(3000, 100, thoughts=50)
                ),
            ]
        ),
    )
    monkeypatch.setattr(chat_service, "_check_rate_limit", lambda _u: None)
    result = chat_service.process_chat_message(
        db_session,
        db_session,
        user.id,
        "Which store do I visit most on weekends?",
        None,
    )
    assert "Corner Market" in result.message
    row = db_session.query(AIUsage).one()
    assert (row.feature, row.user_id, row.input_tokens) == ("chat", user.id, 3000)


# --- the report, and deleting an account -----------------------------------------


def test_usage_report_needs_the_cron_secret(client, db_session, user):
    _spend(db_session, 0.01, user.id)
    _spend(db_session, 0.02, None)
    assert client.get("/api/v1/admin/ai-usage").status_code == 401
    secret = ai_usage.get_settings().cron_secret
    r = client.get("/api/v1/admin/ai-usage?days=7", headers={"X-Cron-Secret": secret})
    assert r.status_code == 200
    body = r.json()
    assert body["calls"] == 2 and body["people"] == 1
    assert body["estimated_cost_usd"] == pytest.approx(0.03)
    assert body["by_feature"]["scan"]["calls"] == 2
    assert body["today"]["estimated_cost_usd"] == pytest.approx(0.03)


def test_deleting_an_account_keeps_the_totals_but_not_the_person(db_session, user):
    _spend(db_session, 0.05, user.id)
    account_service.delete_account(db_session, user)
    row = db_session.query(AIUsage).one()
    assert row.user_id is None and row.cost_usd == 0.05
