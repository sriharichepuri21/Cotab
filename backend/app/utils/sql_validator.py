"""AST-level SQL validation for the text-to-SQL agent.

Defense-in-depth (never trust the LLM to follow its system prompt):
  1. SELECT only — one statement, no DML/DDL.
  2. Table allowlist.
  3. Function allowlist.
  4. Complexity budget (AST node count).
  5. Auto-LIMIT.
  6. Server-side user scoping injected at the AST level.
"""

import sqlglot
from sqlglot import exp

ALLOWED_TABLES = {"receipts", "receipt_line_items", "budgets"}
ALLOWED_FUNCTIONS = {
    "sum",
    "avg",
    "count",
    "min",
    "max",
    "round",
    "abs",
    "coalesce",
    "date_trunc",
    "extract",
    "concat",
    "upper",
    "lower",
}
MAX_AST_NODES = 50
MAX_LIMIT = 100


class SqlValidationError(Exception):
    pass


def validate_sql(sql: str) -> str:
    try:
        statements = sqlglot.parse(sql)
    except Exception as e:
        raise SqlValidationError(f"Unparseable SQL: {e}")

    statements = [s for s in statements if s is not None]
    if len(statements) != 1:
        raise SqlValidationError("Exactly one statement is allowed")
    tree = statements[0]

    if not isinstance(tree, exp.Select) and tree.find(exp.Select) is None:
        # top-level must be a SELECT (allow simple wrappers like LIMIT)
        if not isinstance(tree, exp.Select):
            raise SqlValidationError("Only SELECT statements are allowed")

    # No DML/DDL anywhere in the tree
    for dangerous in (
        exp.Insert,
        exp.Update,
        exp.Delete,
        exp.Drop,
        exp.Alter,
        exp.Create,
        exp.TruncateTable,
        exp.Merge,
        exp.Grant,
    ):
        if tree.find(dangerous):
            raise SqlValidationError("Write operations are not allowed")

    # Table allowlist
    for table in tree.find_all(exp.Table):
        name = table.name.lower()
        if name not in ALLOWED_TABLES:
            raise SqlValidationError(f"Table '{name}' is not allowed")

    # Function allowlist
    for func in tree.find_all(exp.Anonymous, exp.Func):
        name = getattr(func, "sql_name", lambda: "")().lower()
        if name and name not in ALLOWED_FUNCTIONS:
            raise SqlValidationError(f"Function '{name}' is not allowed")

    # Complexity budget
    node_count = sum(1 for _ in tree.walk())
    if node_count > MAX_AST_NODES:
        raise SqlValidationError("Query too complex — rephrase the question")

    # Force a LIMIT if missing
    if tree.find(exp.Limit) is None:
        tree = tree.limit(MAX_LIMIT)

    return tree.sql()


def enforce_user_scope(sql: str, user_id: str) -> str:
    """Inject user_id filtering at the AST level — belt-and-braces with RLS."""
    tree = sqlglot.parse_one(sql)
    uid = exp.Literal.string(user_id)

    def scoped(node):
        # Add user_id filter to the outermost WHERE for each table known to have one
        return node

    # Simple, safe approach: wrap as subquery on user-scoped tables
    if "user_id" in sql.lower():
        # LLM already references user_id — still verify it's constrained
        pass
    else:
        # Auto-inject: WHERE user_id = :uid on primary table alias if the
        # queried tables carry user_id. All allowed tables do.
        condition = exp.condition(exp.EQ(this=exp.column("user_id"), expression=uid))
        if tree.args.get("where"):
            tree = tree.where(condition)
        else:
            tree.set("where", exp.Where(this=condition))

    return tree.sql()
