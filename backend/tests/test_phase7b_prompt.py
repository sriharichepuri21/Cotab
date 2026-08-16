from app.services import gemini_service
from app.services.sql_safety import validate_and_scope_sql


def test_base_prompt_contains_strict_cross_currency_guard():
    prompt = gemini_service.CHAT_SYSTEM_PROMPT

    assert "NEVER sum monetary values across different currencies" in prompt
    assert "list them separately per currency" in prompt
    assert "note the currency mismatch" in prompt
    assert "Never invent or assume an exchange rate" in prompt


def test_disabled_prompt_does_not_reveal_schema_aware_tools(monkeypatch):
    monkeypatch.setattr(gemini_service.settings, "execute_sql_enabled", False)
    monkeypatch.setattr(gemini_service.settings, "execute_sql_canary_user_ids", "")
    monkeypatch.setattr(gemini_service.settings, "execute_sql_canary_emails", "")

    prompt = gemini_service._chat_system_prompt(user_id="ordinary-user")

    assert "execute_sql" not in prompt
    assert "line_items_search" not in prompt
    assert "SAFE schema" not in prompt
    assert "SQL EXAMPLE" not in prompt


def test_enabled_prompt_contains_schema_routing_and_four_examples(monkeypatch):
    monkeypatch.setattr(gemini_service.settings, "execute_sql_enabled", True)

    prompt = gemini_service._chat_system_prompt(user_id="canary-user")

    assert "execute_sql" in prompt
    assert "line_items_search" in prompt
    assert "receipt_line_items: id text" in prompt
    assert "receipt_line_items.receipt_id = receipts.id" in prompt
    assert "Prefer a specialized tool" in prompt
    assert "Use execute_sql for long-tail analytical questions" in prompt
    assert prompt.count("SQL EXAMPLE") == 4


def test_email_canary_gets_schema_prompt_while_global_flag_stays_off(monkeypatch):
    monkeypatch.setattr(gemini_service.settings, "execute_sql_enabled", False)
    monkeypatch.setattr(gemini_service.settings, "execute_sql_canary_user_ids", "")
    monkeypatch.setattr(
        gemini_service.settings,
        "execute_sql_canary_emails",
        "owner@example.com",
    )

    canary_prompt = gemini_service._chat_system_prompt(
        user_id="id-1", user_email="owner@example.com"
    )
    ordinary_prompt = gemini_service._chat_system_prompt(
        user_id="id-2", user_email="someone@example.com"
    )

    assert "execute_sql" in canary_prompt
    assert "execute_sql" not in ordinary_prompt


def test_prompt_examples_are_accepted_by_the_real_safety_validator():
    assert len(gemini_service.SAFE_SQL_EXAMPLES) >= 3

    for _title, sql in gemini_service.SAFE_SQL_EXAMPLES:
        validated = validate_and_scope_sql(sql)
        assert ":user_id" in validated
        assert "LIMIT" in validated
