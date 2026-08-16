import pytest

from app.services.sql_safety import SqlSafetyError, validate_and_scope_sql


def scoped(sql: str) -> str:
    return validate_and_scope_sql(sql).lower()


def test_scopes_direct_user_table_and_caps_rows():
    result = scoped("SELECT r.merchant, r.total FROM receipts r ORDER BY r.total DESC")
    assert "__rw_scope_1.user_id = :user_id" in result
    assert "__rw_scope_1.deleted_at is null" in result
    assert "limit 500" in result


def test_scopes_every_union_branch():
    result = scoped(
        "SELECT r.merchant FROM receipts r "
        "UNION ALL SELECT r2.merchant FROM receipts r2"
    )
    assert result.count("user_id = :user_id") == 2


def test_scopes_indirect_split_table_through_owned_group():
    result = scoped("SELECT sm.name FROM split_members sm")
    assert "exists(select1fromsplit_groups" in result.replace(" ", "")
    assert "__scope_group.owner_id = :user_id" in result
    assert "__rw_scope_1.group_id" in result


@pytest.mark.parametrize(
    "sql",
    [
        "UPDATE receipts SET total = 0",
        "DELETE FROM receipts",
        "INSERT INTO receipts (id) VALUES ('x')",
        "DROP TABLE receipts",
        "SELECT merchant FROM receipts; SELECT name FROM split_groups",
        "SELECT merchant INTO leaked FROM receipts",
        "SELECT merchant FROM receipts FOR UPDATE",
        "WITH removed AS (DELETE FROM receipts RETURNING merchant) "
        "SELECT merchant FROM removed",
    ],
)
def test_rejects_writes_multiple_statements_and_locks(sql):
    with pytest.raises(SqlSafetyError):
        validate_and_scope_sql(sql)


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT email FROM users",
        "SELECT tablename FROM pg_catalog.pg_tables",
        "SELECT r.image_key FROM receipts r",
        "SELECT r.error_message FROM receipts r",
        "SELECT sg.share_code FROM split_groups sg",
        "SELECT sm.email FROM split_members sm",
        "SELECT tool_trace FROM chat_messages",
        "SELECT raw_extraction FROM receipts",
        "SELECT * FROM receipts",
    ],
)
def test_rejects_non_allowlisted_tables_and_sensitive_columns(sql):
    with pytest.raises(SqlSafetyError):
        validate_and_scope_sql(sql)


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT pg_sleep(1) FROM receipts",
        "SELECT pg_read_file('/etc/passwd') FROM receipts",
        "SELECT current_setting('server_version') FROM receipts",
        "SELECT nextval('anything') FROM receipts",
    ],
)
def test_rejects_dangerous_functions(sql):
    with pytest.raises(SqlSafetyError):
        validate_and_scope_sql(sql)


def test_scopes_cte_source_and_preserves_aggregate():
    result = scoped(
        "WITH dining AS ("
        "SELECT r.currency, r.total FROM receipts r WHERE r.category = 'dining'"
        ") SELECT d.currency, SUM(d.total) AS amount FROM dining d GROUP BY d.currency"
    )
    assert "__rw_scope_1.user_id = :user_id" in result
    assert "sum(d.total)" in result


def test_allows_ordering_by_safe_projection_alias():
    result = scoped(
        "SELECT r.merchant, SUM(r.total) AS total_spent "
        "FROM receipts r GROUP BY r.merchant ORDER BY total_spent DESC"
    )
    assert "order by total_spent desc" in result


def test_scopes_line_item_join_on_both_denormalized_owners():
    result = scoped(
        "SELECT r.merchant, li.description, li.total_price "
        "FROM receipts r JOIN receipt_line_items li ON li.receipt_id = r.id"
    )
    assert result.count("user_id = :user_id") == 2


def test_scoped_subquery_preserves_left_join_semantics():
    result = scoped(
        "SELECT r.merchant, li.description FROM receipts r "
        "LEFT JOIN receipt_line_items li ON li.receipt_id = r.id"
    )
    assert "left join (select" in result
    assert "where li.user_id" not in result


def test_rejects_ambiguous_unqualified_column():
    with pytest.raises(SqlSafetyError, match="ambiguous"):
        validate_and_scope_sql(
            "SELECT id FROM receipts r "
            "JOIN receipt_line_items li ON li.receipt_id = r.id"
        )


def test_reduces_large_limit_but_preserves_smaller_limit():
    assert "limit 500" in scoped("SELECT merchant FROM receipts LIMIT 5000")
    assert "limit 25" in scoped("SELECT merchant FROM receipts LIMIT 25")


def test_rejects_non_literal_limit():
    with pytest.raises(SqlSafetyError):
        validate_and_scope_sql("SELECT merchant FROM receipts LIMIT :limit")


def test_unknown_extension_function_fails_closed():
    with pytest.raises(SqlSafetyError, match="not allowed"):
        validate_and_scope_sql("SELECT mystery_extension(merchant) FROM receipts")
