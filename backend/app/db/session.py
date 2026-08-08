from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from app.config.settings import get_settings
from app.utils.db_url import is_sqlite_url, normalize_db_url

settings = get_settings()
db_url = normalize_db_url(settings.database_url)

engine_kwargs = {}
if is_sqlite_url(db_url):
    engine_kwargs["connect_args"] = {"check_same_thread": False}
else:
    # Postgres: recycle dropped connections; Render/Supabase idle-close them.
    engine_kwargs["pool_pre_ping"] = True
    engine_kwargs["pool_recycle"] = 300

engine = create_engine(db_url, **engine_kwargs)

# Read-only engine used for text-to-SQL queries. Points at the same DB in dev;
# override DATABASE_URL_READONLY with a read-role DSN in production hardening.
readonly_url = normalize_db_url(settings.database_url_readonly or db_url)
engine_readonly = create_engine(readonly_url, **engine_kwargs)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
SessionLocalReadOnly = sessionmaker(
    autocommit=False, autoflush=False, bind=engine_readonly
)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_db_readonly():
    db = SessionLocalReadOnly()
    try:
        yield db
    finally:
        db.close()
