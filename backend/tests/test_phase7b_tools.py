from datetime import datetime, timezone

from app.models import Receipt, ReceiptLineItem
from app.services import chat_ai as gemini_service
from app.services import chat_tools
from app.services.chat_service import _call_tool
from app.services.sql_executor import SqlExecutionResult


def _declaration_names(user_id=None):
    tool = gemini_service._chat_tool_declarations(user_id=user_id)[0]
    return {declaration.name for declaration in tool.function_declarations}


def test_schema_tools_are_not_registered_when_flag_is_off(monkeypatch):
    monkeypatch.setattr(gemini_service.settings, "execute_sql_enabled", False)
    monkeypatch.setattr(gemini_service.settings, "execute_sql_canary_user_ids", "")

    names = _declaration_names("user-1")

    assert "execute_sql" not in names
    assert "line_items_search" not in names
    assert len(names) == 11


def test_forged_schema_tool_calls_are_rejected_while_flag_is_off(
    monkeypatch, db_session, user
):
    monkeypatch.setattr(gemini_service.settings, "execute_sql_enabled", False)
    monkeypatch.setattr(gemini_service.settings, "execute_sql_canary_user_ids", "")

    for name, arguments in (
        ("execute_sql", {"sql": "SELECT r.merchant FROM receipts r"}),
        ("line_items_search", {"search_text": "paneer"}),
    ):
        result = _call_tool(
            name, arguments, db_session, user.id, db_readonly=db_session
        )
        assert result == {
            "status": "error",
            "hint": "Schema-aware queries are not enabled for this account.",
        }


def test_schema_tools_are_registered_when_flag_is_on(monkeypatch):
    monkeypatch.setattr(gemini_service.settings, "execute_sql_enabled", True)

    names = _declaration_names("user-1")

    assert "execute_sql" in names
    assert "line_items_search" in names
    assert len(names) == 13


def test_execute_sql_declaration_documents_safe_schema_and_joins(monkeypatch):
    monkeypatch.setattr(gemini_service.settings, "execute_sql_enabled", True)
    declarations = gemini_service._chat_tool_declarations(user_id="user-1")[
        0
    ].function_declarations
    declaration = next(item for item in declarations if item.name == "execute_sql")

    assert "receipt_line_items: id text" in declaration.description
    assert "receipt_line_items.receipt_id = receipts.id" in declaration.description
    assert "normalized rows, not JSON/JSONB" in declaration.description


def test_schema_tools_can_be_registered_for_one_canary_user(monkeypatch):
    monkeypatch.setattr(gemini_service.settings, "execute_sql_enabled", False)
    monkeypatch.setattr(
        gemini_service.settings,
        "execute_sql_canary_user_ids",
        "canary-user, another-user",
    )

    assert "execute_sql" in _declaration_names("canary-user")
    assert "execute_sql" not in _declaration_names("other-user")


def test_schema_tools_can_be_registered_for_authenticated_canary_email(monkeypatch):
    monkeypatch.setattr(gemini_service.settings, "execute_sql_enabled", False)
    monkeypatch.setattr(gemini_service.settings, "execute_sql_canary_user_ids", "")
    monkeypatch.setattr(
        gemini_service.settings,
        "execute_sql_canary_emails",
        "canary@example.com",
    )

    canary = gemini_service._chat_tool_declarations(
        user_id="opaque-id", user_email="CANARY@example.com"
    )[0]
    ordinary = gemini_service._chat_tool_declarations(
        user_id="other-id", user_email="other@example.com"
    )[0]

    assert "execute_sql" in {item.name for item in canary.function_declarations}
    assert "execute_sql" not in {item.name for item in ordinary.function_declarations}


def test_authenticated_email_canary_passes_dispatch_and_tool_level_gates(
    monkeypatch, db_session, user
):
    monkeypatch.setattr(gemini_service.settings, "execute_sql_enabled", False)
    monkeypatch.setattr(gemini_service.settings, "execute_sql_canary_user_ids", "")
    monkeypatch.setattr(
        gemini_service.settings,
        "execute_sql_canary_emails",
        user.email,
    )

    result = _call_tool(
        "line_items_search",
        {"search_text": "nothing-seeded"},
        db_session,
        user.id,
        user_email=user.email,
    )

    assert result["status"] == "empty"
    assert "not enabled" not in result["hint"]


def test_execute_sql_invocation_validates_then_executes_and_returns_grounding(
    monkeypatch, db_session, user
):
    monkeypatch.setattr(gemini_service.settings, "execute_sql_enabled", True)
    calls = []

    def fake_validator(raw_sql):
        calls.append(("validate", raw_sql))
        return "SELECT merchant FROM scoped_receipts LIMIT 500"

    def fake_executor(db, user_id, validated_sql):
        calls.append(("execute", db, user_id, validated_sql))
        return SqlExecutionResult(
            status="ok",
            columns=["merchant"],
            rows=[{"merchant": "Costco"}],
            row_count=1,
        )

    monkeypatch.setattr(chat_tools, "validate_and_scope_sql", fake_validator)
    monkeypatch.setattr(chat_tools, "execute_validated_sql", fake_executor)

    result = _call_tool(
        "execute_sql",
        {"sql": "SELECT merchant FROM receipts"},
        db_session,
        user.id,
        db_readonly=db_session,
    )

    assert calls[0] == ("validate", "SELECT merchant FROM receipts")
    assert calls[1][0] == "execute"
    assert calls[1][1] is db_session
    assert calls[1][2:] == (
        user.id,
        "SELECT merchant FROM scoped_receipts LIMIT 500",
    )
    assert result["status"] == "ok"
    assert result["data"]["sql"] == "SELECT merchant FROM scoped_receipts LIMIT 500"
    assert result["data"]["row_count"] == 1


def test_execute_sql_rejection_is_helpful_and_contains_no_stack_trace(
    monkeypatch, db_session, user
):
    monkeypatch.setattr(gemini_service.settings, "execute_sql_enabled", True)

    result = _call_tool(
        "execute_sql",
        {"sql": "DROP TABLE receipts"},
        db_session,
        user.id,
        db_readonly=db_session,
    )

    assert result["status"] == "error"
    assert "rejected by the safety policy" in result["hint"]
    assert "select" in result["hint"].lower()
    assert "traceback" not in result["hint"].lower()


def test_line_items_search_matches_normalized_description_and_returns_grounding(
    monkeypatch, db_session, user
):
    monkeypatch.setattr(gemini_service.settings, "execute_sql_enabled", True)
    receipt = Receipt(
        user_id=user.id,
        merchant="Spice Market",
        total=18.0,
        currency="USD",
        category="dining",
        status="extracted",
        purchased_at=datetime.now(timezone.utc),
    )
    db_session.add(receipt)
    db_session.flush()
    db_session.add_all(
        [
            ReceiptLineItem(
                receipt_id=receipt.id,
                user_id=user.id,
                description="Paneer Tikka",
                quantity=1,
                unit_price=14.0,
                total_price=14.0,
            ),
            ReceiptLineItem(
                receipt_id=receipt.id,
                user_id=user.id,
                description="Mango Lassi",
                quantity=1,
                unit_price=4.0,
                total_price=4.0,
            ),
        ]
    )
    db_session.commit()

    result = _call_tool(
        "line_items_search",
        {"search_text": "PANEER"},
        db_session,
        user.id,
    )

    assert result["status"] == "ok"
    assert result["data"]["row_count"] == 1
    assert result["data"]["items"][0]["description"] == "Paneer Tikka"
    assert "lower" in result["data"]["sql"].lower()
    assert "receipt_line_items" in result["data"]["sql"]


def test_line_items_search_does_not_return_another_users_match(
    monkeypatch, db_session, user, other_user
):
    monkeypatch.setattr(gemini_service.settings, "execute_sql_enabled", True)
    receipt = Receipt(
        user_id=other_user.id,
        merchant="Other Account Store",
        total=12.0,
        status="extracted",
    )
    db_session.add(receipt)
    db_session.flush()
    db_session.add(
        ReceiptLineItem(
            receipt_id=receipt.id,
            user_id=other_user.id,
            description="Secret paneer",
            total_price=12.0,
        )
    )
    db_session.commit()

    result = _call_tool(
        "line_items_search", {"search_text": "paneer"}, db_session, user.id
    )

    assert result["status"] == "empty"
