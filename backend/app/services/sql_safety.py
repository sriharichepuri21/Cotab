"""Validation and user scoping for Phase 7B read-only analytical SQL.

This module intentionally does not execute SQL.  It is the policy boundary that
the future ``execute_sql`` tool must pass before using the read-only session.
The policy is deliberately narrower than PostgreSQL's SELECT grammar: useful
receipt analytics are allowed; introspection, locking, side effects and data
that is irrelevant or sensitive to chat are not.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, FrozenSet, Iterable, Mapping

from sqlglot import exp, parse
from sqlglot.errors import ParseError
from sqlglot.optimizer.scope import Scope, traverse_scope


class SqlSafetyError(ValueError):
    """A stable, user-safe rejection; never contains a database error."""


@dataclass(frozen=True)
class TablePolicy:
    columns: FrozenSet[str]
    scope_sql: str


_TIMESTAMPS = {"created_at", "updated_at", "deleted_at"}


def _columns(*names: str) -> FrozenSet[str]:
    return frozenset({*names, *_TIMESTAMPS})


# Only analytical columns are exposed. In particular this excludes image_key,
# error_message, share_code, split member email, and all auth/chat contents.
TABLE_POLICIES: Mapping[str, TablePolicy] = {
    "receipts": TablePolicy(
        _columns(
            "id",
            "user_id",
            "merchant",
            "merchant_raw",
            "purchased_at",
            "total",
            "subtotal",
            "tax",
            "currency",
            "category",
            "status",
            "confidence",
            "extraction_method",
        ),
        "{alias}.user_id = :user_id AND {alias}.deleted_at IS NULL",
    ),
    "receipt_line_items": TablePolicy(
        _columns(
            "id",
            "receipt_id",
            "user_id",
            "description",
            "quantity",
            "unit_price",
            "total_price",
            "item_code",
            "item_name",
            "size_qty",
            "size_unit",
            "item_key",
        ),
        "{alias}.user_id = :user_id AND {alias}.deleted_at IS NULL",
    ),
    "budgets": TablePolicy(
        _columns(
            "id",
            "user_id",
            "level",
            "target",
            "period",
            "amount",
            "alert_thresholds",
        ),
        "{alias}.user_id = :user_id AND {alias}.deleted_at IS NULL",
    ),
    "split_groups": TablePolicy(
        _columns("id", "owner_id", "name"),
        "{alias}.owner_id = :user_id AND {alias}.deleted_at IS NULL",
    ),
    "split_members": TablePolicy(
        _columns("id", "group_id", "name", "user_id"),
        "EXISTS (SELECT 1 FROM split_groups AS __scope_group "
        "WHERE __scope_group.id = {alias}.group_id "
        "AND __scope_group.owner_id = :user_id "
        "AND __scope_group.deleted_at IS NULL) "
        "AND {alias}.deleted_at IS NULL",
    ),
    "receipt_splits": TablePolicy(
        _columns(
            "id",
            "group_id",
            "receipt_id",
            "paid_by_member_id",
            "mode",
            "tax_mode",
        ),
        "EXISTS (SELECT 1 FROM split_groups AS __scope_group "
        "WHERE __scope_group.id = {alias}.group_id "
        "AND __scope_group.owner_id = :user_id "
        "AND __scope_group.deleted_at IS NULL) "
        "AND {alias}.deleted_at IS NULL",
    ),
    "split_shares": TablePolicy(
        _columns("id", "split_id", "member_id", "amount", "settled"),
        "EXISTS (SELECT 1 FROM receipt_splits AS __scope_split "
        "JOIN split_groups AS __scope_group ON __scope_group.id = __scope_split.group_id "
        "WHERE __scope_split.id = {alias}.split_id "
        "AND __scope_group.owner_id = :user_id "
        "AND __scope_split.deleted_at IS NULL "
        "AND __scope_group.deleted_at IS NULL) "
        "AND {alias}.deleted_at IS NULL",
    ),
    "split_item_assignments": TablePolicy(
        _columns("id", "split_id", "line_item_id", "member_id"),
        "EXISTS (SELECT 1 FROM receipt_splits AS __scope_split "
        "JOIN split_groups AS __scope_group ON __scope_group.id = __scope_split.group_id "
        "WHERE __scope_split.id = {alias}.split_id "
        "AND __scope_group.owner_id = :user_id "
        "AND __scope_split.deleted_at IS NULL "
        "AND __scope_group.deleted_at IS NULL) "
        "AND {alias}.deleted_at IS NULL",
    ),
}

BLOCKED_COLUMNS = frozenset(
    {
        "hashed_password",
        "password_hash",
        "raw_extraction",
        "tool_trace",
        "context",
        "sql_used",
        "image_key",
        "error_message",
        "share_code",
        "email",
        "telegram_chat_id",
    }
)

BLOCKED_FUNCTIONS = frozenset(
    {
        "current_setting",
        "dblink",
        "dblink_exec",
        "lo_export",
        "lo_import",
        "nextval",
        "pg_advisory_lock",
        "pg_advisory_lock_shared",
        "pg_advisory_xact_lock",
        "pg_advisory_xact_lock_shared",
        "pg_read_binary_file",
        "pg_read_file",
        "pg_sleep",
        "pg_terminate_backend",
        "set_config",
        "setval",
    }
)

# PostgreSQL extension/custom functions parse as Anonymous. Unknown anonymous
# functions fail closed because a blocklist can never enumerate every
# side-effecting extension a database may install.
ALLOWED_ANONYMOUS_FUNCTIONS = frozenset(
    {
        "date_part",
        "date_trunc",
        "jsonb_array_elements",
        "jsonb_array_elements_text",
        "jsonb_path_exists",
        "jsonb_typeof",
        "to_char",
    }
)

MAX_SQL_LENGTH = 8_192
MAX_JOINS = 8
MAX_NESTING_DEPTH = 6
MAX_ROWS = 500


def _physical_tables(scope: Scope) -> Dict[str, str]:
    tables: Dict[str, str] = {}
    for alias, (_node, source) in scope.selected_sources.items():
        if isinstance(source, exp.Table):
            tables[alias.lower()] = source.name.lower()
    return tables


def _iter_scopes(expression: exp.Expression) -> Iterable[Scope]:
    scopes = traverse_scope(expression)
    if not scopes:
        raise SqlSafetyError("Query must contain a SELECT statement")
    return scopes


def _validate_columns(scope: Scope) -> None:
    physical = _physical_tables(scope)
    projection_aliases = {
        projection.alias.lower()
        for projection in getattr(scope.expression, "expressions", [])
        if projection.alias
    }
    for column in scope.columns:
        name = column.name.lower()
        if name in BLOCKED_COLUMNS:
            raise SqlSafetyError(f"Column '{name}' is not available to chat")

        qualifier = column.table.lower() if column.table else ""
        if qualifier:
            table_name = physical.get(qualifier)
            # A CTE/derived-table output is safe only because its underlying
            # physical columns are checked in that child scope.
            if table_name and name not in TABLE_POLICIES[table_name].columns:
                raise SqlSafetyError(
                    f"Column '{qualifier}.{name}' is not available to chat"
                )
            continue

        # ORDER BY/GROUP BY may legally refer to a safe SELECT alias. The
        # aliased expression itself is still inspected separately above.
        if name in projection_aliases:
            continue

        candidates = [
            table_name
            for table_name in physical.values()
            if name in TABLE_POLICIES[table_name].columns
        ]
        if physical and not candidates:
            raise SqlSafetyError(f"Column '{name}' is not available to chat")
        if len(set(candidates)) > 1:
            raise SqlSafetyError(
                f"Column '{name}' is ambiguous; qualify it with a table alias"
            )


def _validate_ast(expression: exp.Expression) -> list[Scope]:
    if not isinstance(expression, exp.Query):
        raise SqlSafetyError("Only SELECT queries are allowed")
    if expression.find(exp.Star):
        raise SqlSafetyError("SELECT * is not allowed; request explicit safe columns")
    if expression.find(exp.Into):
        raise SqlSafetyError("SELECT INTO is not allowed")
    if expression.find(exp.Lock):
        raise SqlSafetyError("Locking clauses are not allowed")
    if any(
        expression.find(node_type)
        for node_type in (exp.Insert, exp.Update, exp.Delete, exp.Merge, exp.Command)
    ):
        raise SqlSafetyError("Data-changing statements are not allowed")
    if any(with_.args.get("recursive") for with_ in expression.find_all(exp.With)):
        raise SqlSafetyError("Recursive CTEs are not allowed")
    if len(list(expression.find_all(exp.Join))) > MAX_JOINS:
        raise SqlSafetyError(f"Queries may use at most {MAX_JOINS} joins")

    scopes = list(_iter_scopes(expression))
    if max((scope.expression.depth for scope in scopes), default=0) > MAX_NESTING_DEPTH:
        raise SqlSafetyError("Query nesting is too deep")

    cte_names = {cte.alias_or_name.lower() for cte in expression.find_all(exp.CTE)}
    for table in expression.find_all(exp.Table):
        if table.catalog or table.db:
            raise SqlSafetyError("Schema-qualified table names are not allowed")
        if (
            table.name.lower() not in TABLE_POLICIES
            and table.name.lower() not in cte_names
        ):
            raise SqlSafetyError(f"Table '{table.name}' is not available to chat")

    for function in expression.find_all(exp.Func):
        name = (
            function.name.lower()
            if isinstance(function, exp.Anonymous)
            else function.sql_name().lower()
        )
        if name in BLOCKED_FUNCTIONS:
            raise SqlSafetyError(f"Function '{name}' is not allowed")
        if (
            isinstance(function, exp.Anonymous)
            and name not in ALLOWED_ANONYMOUS_FUNCTIONS
        ):
            raise SqlSafetyError(f"Function '{name}' is not allowed")

    for scope in scopes:
        _validate_columns(scope)
    return scopes


def _scope_predicate(table_name: str, alias: str) -> exp.Expression:
    sql = TABLE_POLICIES[table_name].scope_sql.format(alias=alias)
    return parse(sql, read="postgres")[0]


def _replace_with_scoped_subquery(
    table: exp.Table, table_name: str, outer_alias: str, sequence: int
) -> None:
    """Scope one physical source without changing outer-join semantics."""

    inner_alias = f"__rw_scope_{sequence}"
    projections = [
        exp.column(column, table=inner_alias)
        for column in sorted(TABLE_POLICIES[table_name].columns)
    ]
    inner_table = exp.Table(this=exp.to_identifier(table_name)).as_(inner_alias)
    inner = (
        exp.select(*projections)
        .from_(inner_table)
        .where(_scope_predicate(table_name, inner_alias), copy=False)
    )
    table.replace(
        exp.Subquery(
            this=inner,
            alias=exp.TableAlias(this=exp.to_identifier(outer_alias)),
        )
    )


def validate_and_scope_sql(sql: str) -> str:
    """Return canonical, user-scoped PostgreSQL SQL or raise SqlSafetyError.

    ``:user_id`` remains a bind parameter. The future executor must bind the
    authenticated server-side user ID and must never interpolate it into SQL.
    """

    if not isinstance(sql, str) or not sql.strip():
        raise SqlSafetyError("SQL is required")
    if len(sql) > MAX_SQL_LENGTH:
        raise SqlSafetyError(f"SQL exceeds the {MAX_SQL_LENGTH}-character limit")
    try:
        statements = parse(sql, read="postgres")
    except ParseError as exc:
        raise SqlSafetyError("SQL could not be parsed") from exc
    if len(statements) != 1:
        raise SqlSafetyError("Exactly one SQL statement is allowed")

    expression = statements[0]
    scopes = _validate_ast(expression)
    sequence = 0
    for scope in scopes:
        for alias, (_node, source) in list(scope.selected_sources.items()):
            if not isinstance(source, exp.Table):
                continue
            table_name = source.name.lower()
            if table_name not in TABLE_POLICIES:
                continue
            sequence += 1
            _replace_with_scoped_subquery(source, table_name, alias, sequence)

    # The outer cap applies after ordering/aggregation and cannot be weakened by
    # an LLM-supplied larger LIMIT.
    current_limit = expression.args.get("limit")
    if current_limit is None:
        expression.set("limit", exp.Limit(expression=exp.Literal.number(MAX_ROWS)))
    else:
        limit_expr = current_limit.expression
        if not isinstance(limit_expr, exp.Literal) or not limit_expr.is_int:
            raise SqlSafetyError("LIMIT must be an integer literal")
        if int(limit_expr.this) > MAX_ROWS:
            current_limit.set("expression", exp.Literal.number(MAX_ROWS))

    return expression.sql(dialect="postgres")
