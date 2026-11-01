from datetime import datetime, timedelta, timezone

from app.api.v1.chat import confirm_proposal
from app.models import Budget, ChatActionProposal, ChatSession, Receipt
from app.services.chat_service import _call_tool
from app.services.insight_service import active_insights, compute_for_user


def test_mutation_is_proposed_then_executes_once(db_session, user):
    session = ChatSession(user_id=user.id)
    db_session.add(session)
    db_session.commit()
    result = _call_tool(
        "add_budget",
        {"category": "coffee", "amount": 200},
        db_session,
        user.id,
        session.id,
    )
    assert result["status"] == "pending_confirmation"
    assert db_session.query(Budget).count() == 0
    proposal = db_session.query(ChatActionProposal).one()
    confirmed = confirm_proposal(proposal.id, db_session, user)
    assert confirmed["status"] == "executed"
    assert db_session.query(Budget).one().amount == 200
    again = confirm_proposal(proposal.id, db_session, user)
    assert again["result"] == {"already_executed": True}
    assert db_session.query(Budget).count() == 1


def test_insights_are_real_deduplicated_observations(db_session, user):
    # Dates relative to the month boundary, not to today: on the 1st-4th of a
    # month "two days ago" is last month, and last month's day 5 is past the
    # "same point last month" cutoff, so fixed offsets made this fail early
    # each month.
    now = datetime.now(timezone.utc)
    month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    previous = (month - timedelta(days=1)).replace(day=1, hour=1)
    so_far = now - month
    for merchant, amount, purchased in (
        ("Old month", 100, previous),
        ("Grocer", 80, month + so_far / 3),
        ("Cafe", 70, month + so_far / 2),
    ):
        db_session.add(
            Receipt(
                user_id=user.id,
                merchant=merchant,
                total=amount,
                category="dining",
                status="reviewed",
                purchased_at=purchased,
            )
        )
    db_session.commit()
    first = compute_for_user(db_session, user.id)
    second = compute_for_user(db_session, user.id)
    assert first
    assert len(active_insights(db_session, user.id)) == len(second)
    assert any(row.kind == "month_change" for row in first)
