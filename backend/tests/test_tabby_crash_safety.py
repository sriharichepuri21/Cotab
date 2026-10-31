"""Tabby's plans survive the bad moments: a crash between doing a step and
writing it down, a second tap, an undo that fails, a push that stopped
part-way. Each test injects the fault and checks the promise still holds:
nothing done twice, nothing left half-done, nothing claimed that didn't happen.
"""

# ruff: noqa: F811  (pytest fixtures are imported, then used as arguments)

import dataclasses
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app.api.v1.chat import confirm_proposal
from app.api.v1.tabby import activity as activity_api
from app.api.v1.tabby import undo as undo_api
from app.models import ChatActionProposal, ChatSession, ReceiptSplit, TabbyActivity
from app.services import chat_service, ops_alerts, tabby_agent
from app.services.tabby_agent import Action, ok
from tests.test_tabby_agent import _plan, _settings, trips  # noqa: F401


class Crash(BaseException):
    """The process dying: not an error the code can catch and handle."""


def _crash_at(monkeypatch, where, times=1):
    """Make the next `times` passes through checkpoint `where` die."""
    left = {"n": times}

    def checkpoint(name):
        if name == where and left["n"] > 0:
            left["n"] -= 1
            raise Crash(name)

    monkeypatch.setattr(tabby_agent, "_checkpoint", checkpoint)


def _restart(db):
    """What a new process sees: only what was committed."""
    db.rollback()
    db.expire_all()


def _age(db, run_id, minutes=30):
    """Pretend the request that was running this died a while ago."""
    old = datetime.now(timezone.utc) - timedelta(minutes=minutes)
    for row in db.query(TabbyActivity).filter(TabbyActivity.run_id == run_id):
        row.updated_at = old
    proposal = db.get(ChatActionProposal, run_id)
    if proposal is not None:
        proposal.updated_at = old
    db.commit()


def _proposal(db, user, plan):
    session = ChatSession(user_id=user.id)
    db.add(session)
    db.commit()
    return chat_service.save_plan(db, user.id, session.id, plan)


def _live_splits(db):
    return db.query(ReceiptSplit).filter(ReceiptSplit.deleted_at.is_(None)).count()


def _two_splits(db, user, trips):
    one, two, _ = trips
    return _plan(
        db,
        user,
        ("split_purchase", {"receipt_id": one.id, "people": ["Ben"]}),
        ("split_purchase", {"receipt_id": two.id, "people": ["Ben"]}),
    )


# ---------- a crash between doing a step and writing it down ----------


def test_crash_mid_step_rolls_the_step_back_and_a_retry_does_it_once(
    db_session, user, trips, monkeypatch
):
    proposal = _proposal(db_session, user, _two_splits(db_session, user, trips))
    _crash_at(monkeypatch, "after_execute")
    with pytest.raises(Crash):
        confirm_proposal(proposal.id, db_session, user)
    _restart(db_session)

    # The split was made inside the transaction that died: it's gone, and the
    # step is marked as running, not done.
    assert _live_splits(db_session) == 0
    steps = db_session.query(TabbyActivity).order_by(TabbyActivity.position).all()
    assert [s.status for s in steps] == ["running", "pending"]

    # A tap while the original request might still be alive is turned away.
    with pytest.raises(HTTPException) as busy:
        confirm_proposal(proposal.id, db_session, user)
    assert busy.value.status_code == 409

    # Once that request is clearly dead, approving again finishes the job once.
    _age(db_session, proposal.id)
    out = confirm_proposal(proposal.id, db_session, user)
    assert out["status"] == "executed"
    assert _live_splits(db_session) == 2
    assert {s.status for s in db_session.query(TabbyActivity)} == {"done"}


def test_crash_between_steps_never_repeats_the_finished_one(
    db_session, user, trips, monkeypatch
):
    proposal = _proposal(db_session, user, _two_splits(db_session, user, trips))
    _crash_at(monkeypatch, "after_commit")
    with pytest.raises(Crash):
        confirm_proposal(proposal.id, db_session, user)
    _restart(db_session)
    assert _live_splits(db_session) == 1

    _age(db_session, proposal.id)
    out = confirm_proposal(proposal.id, db_session, user)
    assert out["status"] == "executed"
    # Step 1 was skipped, not redone: two splits, not three.
    assert _live_splits(db_session) == 2
    assert db_session.query(TabbyActivity).count() == 2


def test_a_second_approval_of_a_finished_plan_does_nothing(db_session, user, trips):
    proposal = _proposal(db_session, user, _two_splits(db_session, user, trips))
    confirm_proposal(proposal.id, db_session, user)
    again = confirm_proposal(proposal.id, db_session, user)
    assert again["result"] == {"already_executed": True}
    assert _live_splits(db_session) == 2


def test_running_the_same_run_twice_skips_finished_steps(db_session, user, trips):
    plan = _two_splits(db_session, user, trips)
    first = tabby_agent.run(db_session, user.id, plan.steps, run_id="r-1")
    second = tabby_agent.run(db_session, user.id, plan.steps, run_id="r-1")
    assert first["status"] == second["status"] == "ok"
    assert _live_splits(db_session) == 2


def test_a_step_another_request_is_running_is_left_alone(db_session, user, trips):
    plan = _two_splits(db_session, user, trips)
    tabby_agent._write_down(db_session, user.id, "r-2", plan.steps, "chat")
    row = db_session.query(TabbyActivity).filter_by(run_id="r-2", position=0).one()
    row.status = "running"  # claimed a moment ago by another request
    db_session.commit()
    out = tabby_agent.run(db_session, user.id, plan.steps, run_id="r-2")
    assert out["status"] == "error" and out.get("busy")
    assert _live_splits(db_session) == 0


# ---------- an undo that fails is a state, not a footnote ----------


def _failing_undo(monkeypatch, name="split_purchase"):
    action = tabby_agent.ACTIONS[name]

    def broken(*_a, **_k):
        raise RuntimeError("database went away")

    monkeypatch.setitem(
        tabby_agent.ACTIONS, name, dataclasses.replace(action, undo=broken)
    )
    return action


def test_a_failed_rollback_is_reported_not_called_a_clean_one(
    db_session, user, trips, monkeypatch
):
    one, two, _ = trips
    plan = _plan(
        db_session,
        user,
        ("split_purchase", {"receipt_id": one.id, "people": ["Ben"]}),
        ("edit_receipt", {"receipt_id": two.id, "total": 12.5}),
    )
    two.deleted_at = datetime.now(timezone.utc)  # step 2 will fail
    db_session.commit()
    proposal = _proposal(db_session, user, plan)
    real = _failing_undo(monkeypatch)

    with pytest.raises(HTTPException) as problem:
        confirm_proposal(proposal.id, db_session, user)
    detail = str(problem.value.detail)
    assert "Nothing was changed" not in detail
    assert "couldn't put back" in detail

    # The split really is still there, and everything says so.
    assert _live_splits(db_session) == 1
    steps = db_session.query(TabbyActivity).order_by(TabbyActivity.position).all()
    assert [s.status for s in steps] == ["undo_failed", "failed"]
    assert db_session.get(ChatActionProposal, proposal.id).status == "needs_attention"
    run = activity_api(db_session, user)[0]
    assert run["status"] == "needs_attention" and run["undoable"]
    assert [a["kind"] for a in ops_alerts.sent] == [
        "tabby_undo_failed",
        "tabby_rollback_failed",
    ]
    # The held plan can't be approved again by accident.
    with pytest.raises(HTTPException):
        confirm_proposal(proposal.id, db_session, user)

    # Once the problem is fixed, Undo is tried again and finishes the job.
    monkeypatch.setitem(tabby_agent.ACTIONS, "split_purchase", real)
    undo_api(proposal.id, db_session, user)
    assert _live_splits(db_session) == 0
    assert activity_api(db_session, user)[0]["status"] == "undone"


def test_a_failed_undo_from_the_activity_page_can_be_retried(
    db_session, user, trips, monkeypatch
):
    out = tabby_agent.run(
        db_session, user.id, _two_splits(db_session, user, trips).steps
    )
    run_id = out["data"]["run_id"]
    real = _failing_undo(monkeypatch)
    with pytest.raises(HTTPException):
        undo_api(run_id, db_session, user)
    assert {s.status for s in db_session.query(TabbyActivity)} == {"undo_failed"}
    assert _live_splits(db_session) == 2
    assert activity_api(db_session, user)[0]["status"] == "needs_attention"

    monkeypatch.setitem(tabby_agent.ACTIONS, "split_purchase", real)
    undo_api(run_id, db_session, user)
    assert _live_splits(db_session) == 0


def test_a_cleanly_failed_plan_leaves_nothing_on_the_activity_page(
    db_session, user, trips
):
    one, two, _ = trips
    plan = _plan(
        db_session,
        user,
        ("split_purchase", {"receipt_id": one.id, "people": ["Ben"]}),
        ("edit_receipt", {"receipt_id": two.id, "total": 12.5}),
    )
    two.deleted_at = datetime.now(timezone.utc)
    db_session.commit()
    proposal = _proposal(db_session, user, plan)
    with pytest.raises(HTTPException):
        confirm_proposal(proposal.id, db_session, user)
    assert activity_api(db_session, user) == []
    assert db_session.get(ChatActionProposal, proposal.id).status == "pending"
    assert ops_alerts.sent == []

    # Fixed, approved again: the same run finishes.
    two.deleted_at = None
    db_session.commit()
    out = confirm_proposal(proposal.id, db_session, user)
    assert out["status"] == "executed"
    assert _live_splits(db_session) == 1


# ---------- steps that reach outside the app ----------


@pytest.fixture()
def pings(monkeypatch):
    """A stand-in for a push to a friend's phone: can't be rolled back."""
    sent = []

    def ping(db, user_id, to):
        sent.append(to)
        return ok({})

    monkeypatch.setitem(
        tabby_agent.ACTIONS,
        "test_ping",
        Action("test_ping", lambda *a: None, ping, None, external=True),
    )
    return sent


def test_an_interrupted_push_is_never_sent_twice(db_session, user, pings, monkeypatch):
    steps = [{"action": "test_ping", "step": {"to": "Ben"}, "summary": "Nudge Ben"}]
    _crash_at(monkeypatch, "after_execute")
    with pytest.raises(Crash):
        tabby_agent.run(db_session, user.id, steps, run_id="p-1")
    _restart(db_session)
    assert pings == ["Ben"]  # it did reach the phone before the crash

    _age(db_session, "p-1")
    out = tabby_agent.run(db_session, user.id, steps, run_id="p-1")
    assert out["status"] == "error" and out["needs_attention"]
    assert pings == ["Ben"]  # not sent again
    row = db_session.query(TabbyActivity).filter_by(run_id="p-1").one()
    assert row.status == "interrupted"
    assert ops_alerts.sent[0]["kind"] == "tabby_step_interrupted"


# ---------- cleaning up after a request that died ----------


def test_recovery_puts_back_a_half_done_run_and_frees_the_plan(
    db_session, user, trips, monkeypatch
):
    proposal = _proposal(db_session, user, _two_splits(db_session, user, trips))
    _crash_at(monkeypatch, "after_commit")
    with pytest.raises(Crash):
        confirm_proposal(proposal.id, db_session, user)
    _restart(db_session)
    monkeypatch.setattr(tabby_agent, "_checkpoint", lambda name: None)
    assert _live_splits(db_session) == 1

    # Too fresh: a request might still be working on it.
    assert tabby_agent.recover_stale(db_session)["runs"] == 0
    _age(db_session, proposal.id)
    counts = tabby_agent.recover_stale(db_session)
    assert counts["runs"] == 1 and counts["needs_attention"] == 0

    assert _live_splits(db_session) == 0  # nothing left half-done
    assert db_session.get(ChatActionProposal, proposal.id).status == "pending"
    assert activity_api(db_session, user) == []
    # And the person can simply approve it again.
    assert confirm_proposal(proposal.id, db_session, user)["status"] == "executed"
    assert _live_splits(db_session) == 2


def test_recovery_marks_an_outside_step_interrupted(
    db_session, user, pings, monkeypatch
):
    steps = [{"action": "test_ping", "step": {"to": "Ben"}, "summary": "Nudge Ben"}]
    _crash_at(monkeypatch, "after_execute")
    with pytest.raises(Crash):
        tabby_agent.run(db_session, user.id, steps, run_id="p-2")
    _restart(db_session)
    _age(db_session, "p-2")
    counts = tabby_agent.recover_stale(db_session)
    assert counts["interrupted"] == 1
    row = db_session.query(TabbyActivity).filter_by(run_id="p-2").one()
    assert row.status == "interrupted"
    assert activity_api(db_session, user)[0]["status"] == "needs_attention"


def test_the_daily_job_runs_recovery(db_session, user, trips, monkeypatch):
    from app.api.v1.reminders import cron_recovery

    proposal = _proposal(db_session, user, _two_splits(db_session, user, trips))
    _crash_at(monkeypatch, "after_commit")
    with pytest.raises(Crash):
        confirm_proposal(proposal.id, db_session, user)
    _restart(db_session)
    _age(db_session, proposal.id)
    assert cron_recovery(db_session)["tabby"]["runs"] == 1
    assert _live_splits(db_session) == 0
