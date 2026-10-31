"""Every try at a Tabby step is kept under the run's id, so one operation's
whole story can be read in order: what ran, what a crash cut off, what was
retried, undone or put back."""

# ruff: noqa: F401, F811  (pytest fixtures are imported, then used as arguments)

from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from app.api.v1.admin import tabby_run
from app.api.v1.chat import confirm_proposal
from app.api.v1.tabby import run_history
from app.api.v1.tabby import undo as undo_api
from app.services import tabby_agent
from tests.test_tabby_agent import _plan, _settings, trips  # noqa: F401
from tests.test_tabby_crash_safety import (
    Crash,
    _age,
    _crash_at,
    _failing_undo,
    _proposal,
    _restart,
    _two_splits,
    pings,
)


def _story(db, run_id):
    """(step, kind, outcome) for each try, oldest first."""
    return [
        (a["position"], a["kind"], a["outcome"])
        for a in tabby_agent.history(db, run_id)
    ]


def test_a_clean_run_has_one_try_per_step(db_session, user, trips):
    proposal = _proposal(db_session, user, _two_splits(db_session, user, trips))
    confirm_proposal(proposal.id, db_session, user)
    assert _story(db_session, proposal.id) == [
        (0, "execute", "ok"),
        (1, "execute", "ok"),
    ]


def test_a_crash_mid_step_shows_the_abandoned_try_then_the_retry(
    db_session, user, trips, monkeypatch
):
    proposal = _proposal(db_session, user, _two_splits(db_session, user, trips))
    _crash_at(monkeypatch, "after_execute")
    with pytest.raises(Crash):
        confirm_proposal(proposal.id, db_session, user)
    _restart(db_session)
    # The try was written down before the step ran, so the crash left a trace.
    assert _story(db_session, proposal.id) == [(0, "execute", "started")]

    _age(db_session, proposal.id)
    confirm_proposal(proposal.id, db_session, user)
    assert _story(db_session, proposal.id) == [
        (0, "execute", "abandoned"),
        (0, "execute", "ok"),
        (1, "execute", "ok"),
    ]
    abandoned = tabby_agent.history(db_session, proposal.id)[0]
    assert abandoned["detail"] == "The process running it stopped."
    assert abandoned["finished_at"] is not None


def test_a_retry_after_a_crash_between_steps_notes_the_skip(
    db_session, user, trips, monkeypatch
):
    proposal = _proposal(db_session, user, _two_splits(db_session, user, trips))
    _crash_at(monkeypatch, "after_commit")
    with pytest.raises(Crash):
        confirm_proposal(proposal.id, db_session, user)
    _restart(db_session)
    _age(db_session, proposal.id)
    confirm_proposal(proposal.id, db_session, user)
    assert _story(db_session, proposal.id) == [
        (0, "execute", "ok"),
        (0, "execute", "skipped"),
        (1, "execute", "ok"),
    ]


def test_a_failed_rollback_and_the_later_undo_are_one_story(
    db_session, user, trips, monkeypatch
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
    real = _failing_undo(monkeypatch)
    with pytest.raises(HTTPException):
        confirm_proposal(proposal.id, db_session, user)
    monkeypatch.setitem(tabby_agent.ACTIONS, "split_purchase", real)
    undo_api(proposal.id, db_session, user)

    assert _story(db_session, proposal.id) == [
        (0, "execute", "ok"),
        (1, "execute", "failed"),
        (0, "rollback", "failed"),
        (0, "undo", "ok"),
    ]
    tries = tabby_agent.history(db_session, proposal.id)
    assert tries[1]["detail"]  # why step 2 failed
    assert tries[2]["detail"] == "Undo failed."


def test_recovery_is_part_of_the_story(db_session, user, trips, monkeypatch):
    proposal = _proposal(db_session, user, _two_splits(db_session, user, trips))
    _crash_at(monkeypatch, "after_commit")
    with pytest.raises(Crash):
        confirm_proposal(proposal.id, db_session, user)
    _restart(db_session)
    monkeypatch.setattr(tabby_agent, "_checkpoint", lambda name: None)
    _age(db_session, proposal.id)
    tabby_agent.recover_stale(db_session)
    assert _story(db_session, proposal.id) == [
        (0, "execute", "ok"),
        (1, "recover", "failed"),  # never started; marked so
        (0, "rollback", "ok"),  # what was done is put back
    ]


def test_an_interrupted_push_is_on_record(db_session, user, pings, monkeypatch):
    steps = [{"action": "test_ping", "step": {"to": "Ben"}, "summary": "Nudge Ben"}]
    _crash_at(monkeypatch, "after_execute")
    with pytest.raises(Crash):
        tabby_agent.run(db_session, user.id, steps, run_id="p-9")
    _restart(db_session)
    _age(db_session, "p-9")
    tabby_agent.run(db_session, user.id, steps, run_id="p-9")
    assert _story(db_session, "p-9") == [(0, "execute", "interrupted")]


def test_people_see_only_their_own_history_and_operators_see_all(
    db_session, user, other_user, trips
):
    proposal = _proposal(db_session, user, _two_splits(db_session, user, trips))
    confirm_proposal(proposal.id, db_session, user)

    mine = run_history(proposal.id, db_session, user)
    assert [t["outcome"] for t in mine] == ["ok", "ok"]
    with pytest.raises(HTTPException) as hidden:
        run_history(proposal.id, db_session, other_user)
    assert hidden.value.status_code == 404

    report = tabby_run(proposal.id, db_session)
    assert report["user_id"] == user.id
    assert [s["status"] for s in report["steps"]] == ["done", "done"]
    assert len(report["attempts"]) == 2


def test_alerts_point_at_the_runs_history(db_session, user, trips, monkeypatch):
    from app.services import ops_alerts

    out = tabby_agent.run(
        db_session, user.id, _two_splits(db_session, user, trips).steps
    )
    _failing_undo(monkeypatch)
    with pytest.raises(HTTPException):
        undo_api(out["data"]["run_id"], db_session, user)
    assert f"/admin/tabby/runs/{out['data']['run_id']}" in ops_alerts.sent[0]["message"]
