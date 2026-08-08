"""Alembic environment.

Resolves the database URL from app config (DATABASE_URL env var or
backend/.env), normalizes it the same way the app does, and targets
app.models' metadata. Works for both `--autogenerate` (offline, from a
scratch DB) and online `upgrade` / `downgrade`.
"""

from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool

from alembic import context

# this is the Alembic Config object, which provides access to the values
# within the .ini file in use.
config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Import the app's metadata WITHOUT importing a live engine. settings comes
# from env/.env; the engine that db.session would build is irrelevant here.
from app.config.settings import get_settings  # noqa: E402
from app.db.session import Base  # noqa: E402
from app.models import models  # noqa: E402,F401  (registers all tables on Base)
from app.utils.db_url import normalize_db_url  # noqa: E402

target_metadata = Base.metadata


def _db_url() -> str:
    """CLI override (-x sqlalchemy.url=...) wins; otherwise app settings."""
    override = context.get_x_argument(as_dictionary=True).get("sqlalchemy.url")
    if override:
        return override
    ini_url = config.get_main_option("sqlalchemy.url")
    if ini_url:
        return ini_url
    return normalize_db_url(get_settings().database_url)


def run_migrations_offline() -> None:
    """Emit SQL without a DB connection (alembic upgrade --sql)."""
    context.configure(
        url=_db_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run against a live database."""
    section = config.get_section(config.config_ini_section, {})
    section["sqlalchemy.url"] = _db_url()
    connectable = engine_from_config(
        section,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
        )
        with context.begin_transaction():
            context.run_migrations()
    connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
