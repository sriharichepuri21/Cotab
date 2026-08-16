"""Execute SQL that has already passed :mod:`app.services.sql_safety`.

There is deliberately no route or Gemini tool integration here.  Phase 7B.2
only establishes the database execution boundary; callers in later stages must
first use ``validate_and_scope_sql`` and must pass the authenticated user ID.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.services.sql_safety import MAX_ROWS

logger = logging.getLogger(__name__)

QUERY_TIMEOUT_MS = 10_000


@dataclass(frozen=True)
class SqlExecutionResult:
    """JSON-safe result envelope for the future ``execute_sql`` chat tool."""

    status: str
    columns: List[str] = field(default_factory=list)
    rows: List[Dict[str, Any]] = field(default_factory=list)
    row_count: int = 0
    truncated: bool = False
    error_code: Optional[str] = None
    message: Optional[str] = None

    @classmethod
    def error(cls, code: str, message: str) -> "SqlExecutionResult":
        return cls(status="error", error_code=code, message=message)


def _json_safe(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, UUID):
        return str(value)
    # Allowed columns should not contain arbitrary objects. Fail closed by
    # stringifying an unexpected scalar rather than letting serialization crash
    # and exposing its Python representation through an exception.
    return str(value)


def _is_timeout_error(exc: SQLAlchemyError) -> bool:
    original = getattr(exc, "orig", None)
    pgcode = getattr(original, "pgcode", None) or getattr(original, "sqlstate", None)
    if pgcode == "57014":  # PostgreSQL query_canceled
        return True
    # Drivers differ in which attribute carries SQLSTATE. This text is used
    # only for classification and is never returned to the user.
    return "statement timeout" in str(original or exc).lower()


def _configure_postgres_transaction(db: Session) -> None:
    bind = db.get_bind()
    if bind.dialect.name != "postgresql":
        return
    # Both values are static server policy, never model input. SET TRANSACTION
    # must be the first statement in this dedicated read-only session.
    db.execute(text("SET TRANSACTION READ ONLY"))
    db.execute(text(f"SET LOCAL statement_timeout = {QUERY_TIMEOUT_MS}"))


def execute_validated_sql(
    db: Session, user_id: str, validated_sql: str
) -> SqlExecutionResult:
    """Execute one validated/scoped query with bounded, safe output.

    The session is treated as owned by this call and is rolled back afterward,
    including on success. That closes the read-only transaction and resets its
    local timeout before the connection returns to the pool.
    """

    if not validated_sql or not validated_sql.strip():
        return SqlExecutionResult.error(
            "invalid_query", "The validated query was empty."
        )

    try:
        _configure_postgres_transaction(db)
        cursor = db.execute(text(validated_sql), {"user_id": user_id})
        columns = [str(key) for key in cursor.keys()]
        fetched = cursor.fetchmany(MAX_ROWS + 1)
        truncated = len(fetched) > MAX_ROWS or len(fetched) == MAX_ROWS
        rows = [
            {
                columns[index]: _json_safe(value)
                for index, value in enumerate(tuple(row))
            }
            for row in fetched[:MAX_ROWS]
        ]
        return SqlExecutionResult(
            status="ok",
            columns=columns,
            rows=rows,
            row_count=len(rows),
            truncated=truncated,
        )
    except SQLAlchemyError as exc:
        if _is_timeout_error(exc):
            logger.warning("Read-only analytical query exceeded timeout")
            return SqlExecutionResult.error(
                "query_timeout", "Query exceeded the 10-second execution limit."
            )
        logger.exception("Read-only analytical query failed")
        return SqlExecutionResult.error(
            "execution_failed", "Query could not be executed safely."
        )
    finally:
        # PostgreSQL aborts the transaction after a timeout/error. Rollback is
        # mandatory before this pooled connection can be reused.
        db.rollback()
