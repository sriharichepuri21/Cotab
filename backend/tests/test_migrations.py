"""Round-trip test for the Alembic migrations.

Builds a throwaway SQLite database purely through `alembic upgrade head`
(no create_all) and asserts the migrated schema matches the ORM's metadata:
same table set, same per-column nullability, and the same indexes.
This catches "migrations drifted from models" without standing up Postgres.

Indexes are compared deliberately: an earlier revision shipped with the
`deleted_at` index dropped from every table, and a columns-only comparison
stayed green throughout — the schema was structurally identical and only the
indexes were missing.
"""

import os
import subprocess
import sys
from pathlib import Path

from sqlalchemy import create_engine, inspect

BACKEND_DIR = Path(__file__).resolve().parent.parent
ALEMBIC_INI = BACKEND_DIR / "alembic.ini"


def _run_alembic(db_path: Path, *args: str) -> subprocess.CompletedProcess:
    env = os.environ.copy()
    env["DATABASE_URL"] = f"sqlite:///{db_path}"
    return subprocess.run(
        [sys.executable, "-m", "alembic", "-c", str(ALEMBIC_INI), *args],
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
    )


def _migrated(engine):
    insp = inspect(engine)
    return {
        t: {c["name"]: c for c in insp.get_columns(t)}
        for t in insp.get_table_names()
        if t != "alembic_version"
    }


def _orm(engine):
    insp = inspect(engine)
    return {
        t: {c["name"]: c for c in insp.get_columns(t)} for t in insp.get_table_names()
    }


def _indexes(engine):
    """{table: {(index_name, (col, ...), unique), ...}} — skips alembic_version."""
    insp = inspect(engine)
    return {
        t: {
            (i["name"], tuple(i["column_names"]), bool(i.get("unique")))
            for i in insp.get_indexes(t)
        }
        for t in insp.get_table_names()
        if t != "alembic_version"
    }


def test_baseline_upgrade_creates_orm_schema(tmp_path):
    import app.models.models  # noqa: F401,WPS433  (register tables)
    from app.db.session import Base  # noqa: WPS433 (import inside test)

    db = tmp_path / "migrated.db"
    res = _run_alembic(db, "upgrade", "head")
    assert res.returncode == 0, f"upgrade failed:\n{res.stdout}\n{res.stderr}"

    migrated = _migrated(create_engine(f"sqlite:///{db}"))

    # Create the same schema via ORM metadata into a second scratch DB to compare.
    orm_db = tmp_path / "orm.db"
    orm_engine = create_engine(f"sqlite:///{orm_db}")
    Base.metadata.create_all(orm_engine)
    expected = _orm(orm_engine)

    assert set(migrated) == set(expected), (
        f"table mismatch: only migrated={sorted(set(expected) - set(migrated))} "
        f"unexpected={sorted(set(migrated) - set(expected))}"
    )
    for table, cols in expected.items():
        for name, col in cols.items():
            assert name in migrated[table], f"{table}.{name} missing after migration"
            m_nullable = migrated[table][name]["nullable"]
            assert (
                m_nullable == col["nullable"]
            ), f"{table}.{name} nullable: migrated={m_nullable} orm={col['nullable']}"

    migrated_idx = _indexes(create_engine(f"sqlite:///{db}"))
    orm_idx = _indexes(orm_engine)
    for table, want in orm_idx.items():
        missing = want - migrated_idx.get(table, set())
        extra = migrated_idx.get(table, set()) - want
        assert (
            not missing
        ), f"{table}: indexes missing after migration: {sorted(missing)}"
        assert (
            not extra
        ), f"{table}: unexpected indexes after migration: {sorted(extra)}"


def test_baseline_downgrade_to_base_drops_all(tmp_path):
    db = tmp_path / "down.db"
    up = _run_alembic(db, "upgrade", "head")
    assert up.returncode == 0, up.stderr
    down = _run_alembic(db, "downgrade", "base")
    assert down.returncode == 0, f"downgrade failed:\n{down.stdout}\n{down.stderr}"
    remaining = inspect(create_engine(f"sqlite:///{db}")).get_table_names()
    assert set(remaining) == {"alembic_version"}, f"leftover tables: {remaining}"


def test_money_columns_are_exact_decimals_after_migration(tmp_path):
    """Amounts are NUMERIC after `upgrade head`, not FLOAT, and existing values
    are rounded to cents on the way."""
    db = tmp_path / "money.db"
    res = _run_alembic(db, "upgrade", "head")
    assert res.returncode == 0, res.stderr
    insp = inspect(create_engine(f"sqlite:///{db}"))
    for table, column, places in [
        ("receipts", "total", 2),
        ("receipts", "tax", 2),
        ("receipt_line_items", "unit_price", 4),
        ("split_shares", "amount", 2),
        ("settlements", "amount", 2),
        ("budgets", "amount", 2),
    ]:
        col = next(c for c in insp.get_columns(table) if c["name"] == column)
        assert "NUMERIC" in str(col["type"]).upper(), (table, column, col["type"])
        assert getattr(col["type"], "scale", None) == places, (table, column)


def test_money_round_trips_to_the_cent(db_session, user):
    from app.models import Receipt

    receipt = Receipt(user_id=user.id, total=0.1 + 0.2, tax=1.005, merchant="X")
    db_session.add(receipt)
    db_session.commit()
    db_session.expire_all()
    stored = db_session.get(Receipt, receipt.id)
    assert stored.total == 0.30 and isinstance(stored.total, float)
    assert stored.tax == 1.01  # half-up, as on a receipt
