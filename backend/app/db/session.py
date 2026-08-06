from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from app.config.settings import get_settings

settings = get_settings()

connect_args = {}
if settings.database_url.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

engine = create_engine(settings.database_url, connect_args=connect_args)

# Read-only engine used for text-to-SQL queries (points at same DB locally;
# in production this would use a read-only role/connection string).
engine_readonly = create_engine(settings.database_url, connect_args=connect_args)

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
