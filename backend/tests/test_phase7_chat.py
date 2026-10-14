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
    now = datetime.now(timezone.utc)
    previous = (now.replace(day=1) - timedelta(days=1)).replace(day=5)
    for merchant, amount, purchased in (
        ("Old month", 100, previous),
        ("Grocer", 80, now - timedelta(days=2)),
        ("Cafe", 70, now - timedelta(days=1)),
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
