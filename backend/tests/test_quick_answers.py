"""Common spending questions are answered from the database, without the AI."""

from datetime import date, datetime, timezone

import pytest

from app.models import Budget, Receipt
from app.services import chat_service, quick_answers
from app.services.chat_service import needs_rewrite, process_chat_message

TODAY = date(2026, 10, 13)


def _receipt(db, user, total, category, day, status="extracted", merchant="Shop"):
    r = Receipt(
        user_id=user.id,
        merchant=merchant,
        total=total,
        currency="USD",
        category=category,
        status=status,
        purchased_at=datetime(day.year, day.month, day.day, 12, tzinfo=timezone.utc),
    )
    db.add(r)
    db.commit()
    return r


@pytest.fixture()
def spending(db_session, user, other_user):
    _receipt(db_session, user, 40.00, "groceries", date(2026, 10, 2))
    _receipt(db_session, user, 12.50, "dining", date(2026, 10, 12))
    _receipt(db_session, user, 7.25, "dining", date(2026, 10, 13))
    _receipt(db_session, user, 99.00, "groceries", date(2026, 9, 20))  # last month
    _receipt(db_session, user, 500.00, "groceries", date(2026, 10, 5), status="failed")
    _receipt(db_session, other_user, 1000.00, "groceries", date(2026, 10, 3))


def ask(db, user, text, context=None):
    return quick_answers.try_answer(db, user.id, text, context, today=TODAY)


@pytest.mark.parametrize(
    "question, expected",
    [
        ("How much did I spend this month?", "$59.75 this month, across 3 purchases"),
        (
            "how much have I spent on groceries this month",
            "$40.00 on groceries this month",
        ),
        ("How much did I spend on eating out?", "$19.75 on dining this month"),
        ("How much did I spend this month on coffee?", None),  # not a category
        ("what did I spend last month", "$99.00 last month, across 1 purchase."),
        ("How much did I spend today?", "$7.25 today"),
        ("How much did I spend yesterday on dining", "$12.50 on dining yesterday"),
        ("total spending this month", "$59.75 this month"),
        (
            "How much did we spend on supermarket last month?",
            "$99.00 on groceries last month",
        ),
    ],
)
def test_spend_questions(db_session, user, spending, question, expected):
    answer = ask(db_session, user, question)
    if expected is None:
        assert answer is None
    else:
        assert answer is not None
        assert expected in answer.text


def test_only_counts_the_askers_own_successful_receipts(db_session, user, spending):
    answer = ask(db_session, user, "how much did I spend on groceries this month")
    assert answer.trace[0]["data"]["count"] == 1
    assert answer.trace[0]["data"]["total"] == 40.0


def test_empty_period_says_so(db_session, user, spending):
    answer = ask(db_session, user, "how much did I spend on travel this year")
    assert answer.text.startswith("Nothing on travel this year")


@pytest.mark.parametrize(
    "question",
    [
        "How much did I spend at Costco?",  # merchants go to the AI
        "Did we buy paper towels this month?",
        "How much did I spend on groceries compared to last month?",
        "split this three ways",
        "How much was this receipt?",
    ],
)
def test_anything_else_goes_to_the_ai(db_session, user, spending, question):
    assert ask(db_session, user, question) is None


def test_page_context_always_goes_to_the_ai(db_session, user, spending):
    assert ask(db_session, user, "how much did I spend", {"receipt_id": "abc"}) is None


def test_budget_status(db_session, user, spending):
    db_session.add(
        Budget(
            user_id=user.id,
            level="category",
            target="dining",
            period="monthly",
            amount=15,
        )
    )
    db_session.commit()
    answer = quick_answers.try_answer(db_session, user.id, "How are my budgets?")
    assert answer is not None
    assert "budgets is over" in answer.text or "within their limits" in answer.text


def test_no_budgets_explains_how_to_add_one(db_session, user):
    answer = quick_answers.try_answer(db_session, user.id, "budget status?")
    assert "don't have any budgets" in answer.text


def test_chat_answers_without_calling_the_ai(db_session, user, spending, monkeypatch):
    def boom(*_a, **_k):
        raise AssertionError("the AI should not be called")

    monkeypatch.setattr(chat_service, "reformulate_question", boom)
    monkeypatch.setattr(chat_service, "start_chat_with_tools", boom)
    monkeypatch.setattr(chat_service, "_check_rate_limit", boom)
    result = process_chat_message(
        db_session, db_session, user.id, "How much did I spend this month?", None
    )
    assert "this month" in result.message
    assert result.explanation[0]["tool"] == "quick_spend_total"


def test_rewrite_only_when_the_question_refers_to_something():
    history = [{"role": "user", "parts": ["show my receipts"]}]
    assert needs_rewrite("how much on groceries", None, []) is False
    assert needs_rewrite("how much on groceries", None, history) is False
    assert needs_rewrite("and what about last month", None, history) is True
    assert needs_rewrite("split it", {"receipt_id": "x"}, []) is True
