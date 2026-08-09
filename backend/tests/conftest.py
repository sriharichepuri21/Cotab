"""Shared fixtures.

`db_session` was originally defined inside test_chat_tools.py; it lives here now
so every test module can use it without duplicating the engine setup.

Note this builds the schema with `create_all` rather than by running migrations.
That's intentional — it keeps unit tests fast and independent of Alembic. The
migrations themselves are covered separately in test_migrations.py, which asserts
that `upgrade head` reproduces this same metadata.
"""

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.session import Base
from app.models import User


@pytest.fixture()
def db_session() -> Session:
    # StaticPool keeps every connection on the SAME in-memory database. Without
    # it, each new connection gets a fresh empty DB — which breaks TestClient,
    # since it serves requests on a different thread and would see no tables.
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)
    db = TestingSession()
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def user(db_session: Session) -> User:
    u = User(email="t@example.com", hashed_password="x")
    db_session.add(u)
    db_session.commit()
    db_session.refresh(u)
    return u
