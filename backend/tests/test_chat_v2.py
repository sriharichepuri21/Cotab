"""Chat, end to end: answers from the account summary in one step, lookups
that keep Gemini 3's thought signatures, streamed events, nothing technical
reaching the browser, and friendly failures."""

import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from google.genai import errors, types

from app.db.session import get_db, get_db_readonly
from app.main import app
from app.models import (
    Budget,
    ChatActionProposal,
    ChatMessage,
    Receipt,
    ReceiptLineItem,
)
from app.services import chat_context, chat_service
from tests import fake_gemini

NOW = datetime.now(timezone.utc)


@pytest.fixture(autouse=True)
def _settings(monkeypatch):
    s = chat_service.settings
    monkeypatch.setattr(s, "gemini_model", "gemini-3.5-flash-lite")
    monkeypatch.setattr(s, "execute_sql_enabled", True)
    monkeypatch.setattr(chat_service, "_check_rate_limit", lambda _u: None)


@pytest.fixture()
def spending(db_session, user):
    user.full_name = "Sam Rivera"
    rows = [
        ("Corner Market", 42.10, "groceries", 0),
        ("Corner Market", 18.40, "groceries", 2),
        ("Blue Bottle", 6.50, "dining", 1),
        ("Shell", 55.00, "transport", 35),
    ]
    made = []
    for merchant, total, category, days_ago in rows:
        r = Receipt(
            user_id=user.id,
            merchant=merchant,
            total=total,
            currency="USD",
            category=category,
            status="extracted",
            purchased_at=NOW - timedelta(days=days_ago),
        )
        db_session.add(r)
        made.append(r)
    db_session.flush()
    db_session.add(
        ReceiptLineItem(
            receipt_id=made[0].id,
            user_id=user.id,
            description="Oat milk",
            quantity=1,
            total_price=4.29,
        )
    )
    db_session.add(
        Budget(
            user_id=user.id,
            level="category",
            target="groceries",
            period="monthly",
            amount=300,
        )
    )
    db_session.commit()
    return made


def _events(turn):
    return list(chat_service.run_turn(turn))


def _ask(db, user, message, context=None, session_id=None):
    turn = chat_service.prepare_turn(db, db, user.id, message, session_id, context)
    return turn, _events(turn)


def _text(events):
    return "".join(e["text"] for e in events if e["type"] == "delta")


# --- the account summary ---------------------------------------------------------


def test_summary_covers_what_most_questions_need(db_session, user, spending):
    summary = chat_context.build(db_session, user)
    assert "Name: Sam." in summary
    assert "This month" in summary and "Last month" in summary
    assert "groceries" in summary and "$60.50" in summary
    assert "Corner Market $60.50 over 2 visits" in summary
    assert "groceries (monthly): spent" in summary
    assert f"id={spending[0].id}" in summary
    assert "Oat milk" not in summary  # items come from a lookup, not the summary


def test_summary_for_a_new_account(db_session, user):
    summary = chat_context.build(db_session, user)
    assert "No purchases in the last 120 days." in summary
    assert "Budgets: none set yet." in summary


def test_currencies_are_never_added_together(db_session, user):
    for cur, amount in (("USD", 10.0), ("EUR", 20.0)):
        db_session.add(
            Receipt(
                user_id=user.id,
                merchant="Shop",
                total=amount,
                currency=cur,
                status="extracted",
                purchased_at=NOW,
            )
        )
    db_session.commit()
    summary = chat_context.build(db_session, user)
    assert "€20.00 + $10.00" in summary
    assert "Never add different currencies together." in summary


# --- answering ------------------------------------------------------------------


def test_a_simple_question_is_one_streamed_step(
    db_session, user, spending, monkeypatch
):
    stream = fake_gemini.Stream(
        [
            fake_gemini.text("You've spent **$67.00** "),
            fake_gemini.text("this month.", meta=fake_gemini.usage(2000, 20)),
        ]
    )
    monkeypatch.setattr(chat_service.ai_client, "stream", stream)
    turn, events = _ask(db_session, user, "Where does my money go these days?")

    assert [e["type"] for e in events] == ["delta", "delta", "done"]
    assert _text(events) == "You've spent **$67.00** this month."
    request = stream.requests[0]
    system = request["config"].system_instruction
    assert "ACCOUNT SUMMARY" in system and "Corner Market" in system
    assert "COTAB GUIDE" in system
    assert (
        request["config"].thinking_config.thinking_level == types.ThinkingLevel.MINIMAL
    )
    saved = db_session.query(ChatMessage).filter_by(role="assistant").one()
    assert saved.content == "You've spent **$67.00** this month."


def test_a_lookup_sends_the_thought_signature_back(
    db_session, user, spending, monkeypatch
):
    stream = fake_gemini.Stream(
        [
            fake_gemini.call(
                "find_receipts", signature=b"sig-xyz", search_text="oat milk"
            )
        ],
        [fake_gemini.text("Yes, oat milk for **$4.29** at Corner Market.")],
    )
    monkeypatch.setattr(chat_service.ai_client, "stream", stream)
    turn, events = _ask(db_session, user, "Did I buy oat milk?")

    assert events[0] == {"type": "status", "text": "Looking through your receipts…"}
    assert "oat milk for **$4.29**" in _text(events)
    second = stream.requests[1]["contents"]
    model_turn, tool_turn = second[-2], second[-1]
    assert model_turn.role == "model"
    assert model_turn.parts[0].thought_signature == b"sig-xyz"
    reply = tool_turn.parts[0].function_response
    assert reply.name == "find_receipts"
    assert reply.response["result"]["status"] == "ok"
    trace = json.loads(
        db_session.query(ChatMessage).filter_by(role="assistant").one().tool_trace
    )
    assert trace[0]["tool"] == "find_receipts"


def test_sql_text_never_goes_back_to_the_model_or_the_browser(
    db_session, user, spending, monkeypatch
):
    monkeypatch.setitem(
        chat_service.chat_tools.TOOL_REGISTRY,
        "execute_sql",
        lambda db, uid, sql, user_email=None: {
            "status": "ok",
            "data": {"sql": "SELECT secret", "rows": [[1]] * 200, "row_count": 200},
        },
    )
    stream = fake_gemini.Stream(
        [fake_gemini.call("execute_sql", sql="SELECT r.merchant FROM receipts r")],
        [fake_gemini.text("You shopped **200** times.")],
    )
    monkeypatch.setattr(chat_service.ai_client, "stream", stream)
    turn, events = _ask(db_session, user, "How many times did I shop?")

    sent = stream.requests[1]["contents"][-1].parts[0].function_response.response
    assert "sql" not in sent["result"]["data"]
    assert len(sent["result"]["data"]["rows"]) == chat_service.MAX_ROWS
    assert "SELECT" not in json.dumps(events)


def test_actions_come_back_as_a_proposal_to_confirm(
    db_session, user, spending, monkeypatch
):
    stream = fake_gemini.Stream(
        [fake_gemini.call("add_budget", category="dining", amount=150)],
        [
            fake_gemini.text(
                "I've set up a **$150.00** dining budget. Confirm it below."
            )
        ],
    )
    monkeypatch.setattr(chat_service.ai_client, "stream", stream)
    turn, events = _ask(db_session, user, "Give me a $150 dining budget")

    proposal = next(e for e in events if e["type"] == "proposal")["proposal"]
    assert proposal["summary"] == "Set a $150.00 monthly budget for dining spending."
    assert db_session.query(ChatActionProposal).one().status == "pending"
    assert db_session.query(Budget).filter_by(target="dining").count() == 0


def test_the_last_step_must_answer_without_more_lookups(
    db_session, user, spending, monkeypatch
):
    steps = [[fake_gemini.call("list_receipts")] for _ in range(4)]
    stream = fake_gemini.Stream(*steps, [fake_gemini.text("Here's what I found.")])
    monkeypatch.setattr(chat_service.ai_client, "stream", stream)
    turn, events = _ask(db_session, user, "Show me everything")
    assert len(stream.requests) == chat_service.MAX_STEPS
    last = stream.requests[-1]["config"].tool_config
    assert last.function_calling_config.mode == "NONE"
    assert _text(events).endswith("Here's what I found.")


def test_the_receipt_on_screen_needs_no_lookup(db_session, user, spending, monkeypatch):
    stream = fake_gemini.Stream([fake_gemini.text("It has oat milk.")])
    monkeypatch.setattr(chat_service.ai_client, "stream", stream)
    _ask(
        db_session,
        user,
        "What's on this one?",
        context={"page": "/app/receipts/x", "receipt_id": spending[0].id},
    )
    system = stream.requests[0]["config"].system_instruction
    assert "RECEIPT ON SCREEN" in system and "Oat milk" in system


def test_the_conversation_continues(db_session, user, spending, monkeypatch):
    stream = fake_gemini.Stream(
        [fake_gemini.text("**$60.50** at Corner Market.")],
        [fake_gemini.text("**$6.50** at Blue Bottle.")],
    )
    monkeypatch.setattr(chat_service.ai_client, "stream", stream)
    first, _ = _ask(db_session, user, "Groceries this month?")
    _ask(db_session, user, "And coffee?", session_id=first.session_id)
    contents = stream.requests[1]["contents"]
    assert [c.role for c in contents] == ["user", "model", "user"]
    assert contents[1].parts[0].text == "**$60.50** at Corner Market."


# --- failures ---------------------------------------------------------------------


def test_a_failure_reads_as_a_friendly_sentence(
    db_session, user, spending, monkeypatch
):
    stream = fake_gemini.Stream(RuntimeError("network down"))
    monkeypatch.setattr(chat_service.ai_client, "stream", stream)
    _, events = _ask(db_session, user, "Where does my money go?")
    assert _text(events) == chat_service.TROUBLE
    assert events[-1]["type"] == "done"


def test_googles_quota_reads_as_busy(db_session, user, spending, monkeypatch):
    quota = errors.ClientError(429, {"error": {"code": 429, "message": "quota"}})
    monkeypatch.setattr(chat_service.ai_client, "stream", fake_gemini.Stream(quota))
    _, events = _ask(db_session, user, "Where does my money go?")
    assert _text(events) == chat_service.BUSY


def test_off_topic_rules_are_in_the_prompt():
    prompt = chat_service.chat_ai._chat_system_prompt("u")
    assert "Anything not about their money or Cotab" in prompt
    assert "Never mention tools, databases, SQL" in prompt


# --- the API ------------------------------------------------------------------------


@pytest.fixture()
def client(db_session):
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_db_readonly] = lambda: db_session
    yield TestClient(app)
    app.dependency_overrides.clear()


def _register(client):
    r = client.post(
        "/api/v1/auth/register",
        json={"email": f"{uuid.uuid4().hex[:8]}@example.com", "password": "pw12345"},
    )
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_the_stream_endpoint_sends_one_event_per_line(client, monkeypatch):
    stream = fake_gemini.Stream(
        [
            fake_gemini.call("list_receipts"),
        ],
        [
            fake_gemini.text("Nothing yet. "),
            fake_gemini.text("Scan a receipt to start."),
        ],
    )
    monkeypatch.setattr(chat_service.ai_client, "stream", stream)
    h = _register(client)
    r = client.post(
        "/api/v1/chat/stream",
        headers=h,
        json={"message": "What did I buy last week at the hardware store?"},
    )
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/x-ndjson")
    events = [json.loads(line) for line in r.text.splitlines() if line]
    assert [e["type"] for e in events] == ["status", "delta", "delta", "done"]
    assert "tool" not in r.text and "list_receipts" not in r.text

    session_id = events[-1]["session_id"]
    msgs = client.get(f"/api/v1/chat/sessions/{session_id}/messages", headers=h).json()
    assert [m["role"] for m in msgs] == ["user", "assistant"]
    assert all("tool_trace" not in m for m in msgs)


def test_the_plain_endpoint_returns_no_explanation(client, monkeypatch):
    monkeypatch.setattr(
        chat_service.ai_client,
        "stream",
        fake_gemini.Stream([fake_gemini.text("**$0.00** so far.")]),
    )
    r = client.post(
        "/api/v1/chat/",
        headers=_register(client),
        json={"message": "What have I spent on travel since spring?"},
    )
    body = r.json()
    assert body["message"] == "**$0.00** so far."
    assert body["explanation"] == [] and body.get("sql") is None


def test_too_many_questions_is_refused_before_streaming(client, monkeypatch):
    def limited(_u):
        raise chat_service.RateLimited()

    monkeypatch.setattr(chat_service, "_check_rate_limit", limited)
    r = client.post(
        "/api/v1/chat/stream",
        headers=_register(client),
        json={"message": "Which store is my favorite?"},
    )
    assert r.status_code == 429


def test_an_empty_question_is_refused(client):
    r = client.post(
        "/api/v1/chat/stream", headers=_register(client), json={"message": ""}
    )
    assert r.status_code == 422


@pytest.mark.parametrize(
    "args, summary, level, target",
    [
        (
            {"level": "item", "target": "coffee", "amount": 40},
            "Set a $40.00 monthly budget for items matching \u201ccoffee\u201d.",
            "item",
            "coffee",
        ),
        (
            {"level": "store", "target": "Costco", "amount": 200, "period": "weekly"},
            "Set a $200.00 weekly budget for purchases at Costco.",
            "merchant",
            "Costco",
        ),
        (
            {"level": "total", "amount": 1500},
            "Set a $1,500.00 monthly budget for everything you spend.",
            "total",
            "",
        ),
    ],
)
def test_chat_can_set_item_store_and_total_budgets(
    db_session, user, args, summary, level, target
):
    from app.api.v1.chat import confirm_proposal
    from app.models import ChatSession

    session = ChatSession(user_id=user.id)
    db_session.add(session)
    db_session.commit()
    result = chat_service._call_tool(
        "add_budget", args, db_session, user.id, session.id
    )
    assert result["summary"] == summary
    confirm_proposal(result["proposal_id"], db_session, user)
    budget = db_session.query(Budget).one()
    assert (budget.level, budget.target) == (level, target)


def test_an_item_named_as_a_category_is_explained(db_session, user):
    out = chat_service.chat_tools.add_budget(db_session, user.id, "milk", 20)
    assert out["status"] == "error" and "level 'item'" in out["hint"]
