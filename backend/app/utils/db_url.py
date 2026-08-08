"""Shared DB URL helpers — keep pure so both Settings and db.session can use them."""

SQLITE_PREFIX = "sqlite"


def is_sqlite_url(url: str) -> bool:
    return url.startswith(SQLITE_PREFIX)


def normalize_db_url(url: str) -> str:
    """Supabase/Render hand out postgres:// URIs; SQLAlchemy wants the driver scheme."""
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+psycopg2://", 1)
    return url
