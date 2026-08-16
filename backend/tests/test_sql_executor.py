from datetime import datetime, timezone

from sqlalchemy.exc import OperationalError

from app.models import Receipt
from app.services.sql_executor import execute_validated_sql
from app.services.sql_safety import validate_and_scope_sql


def _run(db_session, user_id: str, sql: str):
    return execute_validated_sql(db_session, user_id, validate_and_scope_sql(sql))


def test_successful_query_returns_columns_rows_and_count(db_session, user):
    db_session.add(
        Receipt(
            user_id=user.id,
            merchant="Corner Cafe",
            total=14.5,
            currency="USD",
            purchased_at=datetime.now(timezone.utc),
            status="extracted",
        )
    )
    db_session.commit()

    result = _run(
        db_session,
        user.id,
        "SELECT r.merchant, r.total, r.currency FROM receipts r",
    )

    assert result.status == "ok"
    assert result.columns == ["merchant", "total", "currency"]
    assert result.rows == [
        {"merchant": "Corner Cafe", "total": 14.5, "currency": "USD"}
    ]
    assert result.row_count == 1
    assert result.truncated is False


def test_ownership_scope_is_respected_end_to_end(db_session, user, other_user):
    db_session.add_all(
        [
            Receipt(user_id=user.id, merchant="Mine", total=10, status="extracted"),
            Receipt(
                user_id=other_user.id,
                merchant="Not Mine",
                total=999,
                status="extracted",
            ),
        ]
    )
    db_session.commit()

    result = _run(
        db_session,
        user.id,
        "SELECT r.merchant, r.total FROM receipts r ORDER BY r.total DESC",
    )

    assert result.status == "ok"
    assert result.rows == [{"merchant": "Mine", "total": 10.0}]


def test_result_is_capped_and_reports_truncation(db_session, user):
    db_session.add_all(
        [
            Receipt(
                user_id=user.id,
                merchant=f"Merchant {index:03d}",
                total=index,
                status="extracted",
            )
            for index in range(501)
        ]
    )
    db_session.commit()

    result = _run(
        db_session,
        user.id,
        "SELECT r.merchant FROM receipts r ORDER BY r.merchant LIMIT 9999",
    )

    assert result.status == "ok"
    assert result.row_count == 500
    assert len(result.rows) == 500
    assert result.truncated is True


class _TimedOutDriverError(Exception):
    pgcode = "57014"


class _TimeoutSession:
    def __init__(self):
        self.rolled_back = False

    def get_bind(self):
        class _Dialect:
            name = "sqlite"

        class _Bind:
            dialect = _Dialect()

        return _Bind()

    def execute(self, *_args, **_kwargs):
        raise OperationalError(
            "SELECT secret_internal_column FROM private_table",
            {},
            _TimedOutDriverError("canceling statement due to statement timeout"),
        )

    def rollback(self):
        self.rolled_back = True


def test_timeout_is_aborted_cleanly_without_leaking_details():
    db = _TimeoutSession()

    result = execute_validated_sql(db, "user-1", "SELECT 1")

    assert result.status == "error"
    assert result.error_code == "query_timeout"
    assert result.message == "Query exceeded the 10-second execution limit."
    assert "private_table" not in result.message
    assert db.rolled_back is True


class _EmptyCursor:
    def keys(self):
        return []

    def fetchmany(self, _size):
        return []


class _PostgresSession:
    def __init__(self):
        self.statements = []
        self.rolled_back = False

    def get_bind(self):
        class _Dialect:
            name = "postgresql"

        class _Bind:
            dialect = _Dialect()

        return _Bind()

    def execute(self, statement, _params=None):
        rendered = str(statement)
        self.statements.append(rendered)
        return _EmptyCursor()

    def rollback(self):
        self.rolled_back = True


def test_postgres_execution_applies_read_only_mode_and_ten_second_timeout():
    db = _PostgresSession()

    result = execute_validated_sql(db, "user-1", "SELECT 1")

    assert result.status == "ok"
    assert db.statements == [
        "SET TRANSACTION READ ONLY",
        "SET LOCAL statement_timeout = 10000",
        "SELECT 1",
    ]
    assert db.rolled_back is True


def test_execution_error_does_not_leak_database_internals(db_session, user):
    # Simulates schema drift after validation: the execution boundary must still
    # return a fixed message rather than the database's table/column details.
    result = execute_validated_sql(
        db_session,
        user.id,
        "SELECT secret_internal_column FROM missing_private_table",
    )

    assert result.status == "error"
    assert result.error_code == "execution_failed"
    assert result.message == "Query could not be executed safely."
    assert "missing_private_table" not in result.message
