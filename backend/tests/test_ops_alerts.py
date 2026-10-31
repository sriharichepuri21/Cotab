"""Operator alerts: logged, emailed when configured, and never a flood."""

from types import SimpleNamespace

from app.services import ops_alerts


def test_the_same_alert_is_sent_once_an_hour(caplog):
    assert ops_alerts.alert("tabby_undo_failed", "step 1 failed", key="row-1")
    assert not ops_alerts.alert("tabby_undo_failed", "step 1 failed", key="row-1")
    assert ops_alerts.alert("tabby_undo_failed", "step 2 failed", key="row-2")
    assert [a["key"] for a in ops_alerts.sent] == ["row-1", "row-2"]
    assert "OPS ALERT [tabby_undo_failed]" in caplog.text


def test_alerts_are_emailed_when_an_address_is_set(monkeypatch):
    settings = ops_alerts.get_settings()
    monkeypatch.setattr(settings, "ops_alert_email", "ops@example.com")
    monkeypatch.setattr(settings, "resend_api_key", "re_test")
    monkeypatch.setattr(settings, "email_from", "Cotab <hi@example.com>")
    posted = []
    monkeypatch.setattr(
        ops_alerts.httpx,
        "post",
        lambda url, **kw: posted.append(kw["json"]) or SimpleNamespace(status_code=200),
    )
    monkeypatch.setattr(ops_alerts, "sent", None)  # the real path
    ops_alerts.alert("ai_budget_near", "AI spend is $2.50 of $3.00", key="2026-10-31")
    assert posted[0]["to"] == ["ops@example.com"]
    assert posted[0]["subject"] == "[Cotab alert] ai_budget_near"


def test_an_alert_that_cant_be_emailed_never_raises(monkeypatch):
    settings = ops_alerts.get_settings()
    monkeypatch.setattr(settings, "ops_alert_email", "ops@example.com")
    monkeypatch.setattr(settings, "resend_api_key", "re_test")
    monkeypatch.setattr(settings, "email_from", "Cotab <hi@example.com>")

    def down(*a, **k):
        raise ConnectionError("no network")

    monkeypatch.setattr(ops_alerts.httpx, "post", down)
    monkeypatch.setattr(ops_alerts, "sent", None)
    assert ops_alerts.alert("tabby_step_interrupted", "push stopped", key="x")
