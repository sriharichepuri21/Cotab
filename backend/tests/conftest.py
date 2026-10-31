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

from app.config.settings import get_settings
from app.db.session import Base
from app.models import User
from app.services import ai_usage, rate_limiter, scan_service


@pytest.fixture(autouse=True)
def _fresh_rate_limits():
    """In-memory rate-limit windows are process-global; without a reset, tests
    that log in or upload would consume each other's budgets and fail in an
    order-dependent way."""
    rate_limiter._reset_for_tests()
    yield
    rate_limiter._reset_for_tests()


@pytest.fixture(autouse=True)
def _scans_read_inline():
    """Scans are read inside the upload request in tests, so its answer is the
    finished receipt; tests of background reading turn this back on."""
    settings = get_settings()
    before = settings.scan_in_background
    settings.scan_in_background = False
    scan_service.session_factory = None
    # Never reach for a real object store from a test.
    real_delete = scan_service.s3_mod.delete_file
    scan_service.s3_mod.delete_file = lambda key: None
    yield
    scan_service.s3_mod.delete_file = real_delete
    settings.scan_in_background = before
    scan_service.session_factory = None


@pytest.fixture(autouse=True)
def _email_codes_off_by_default():
    """Most tests sign up and get straight to work. The verification flow has
    its own tests (test_email_verification.py), which switch it back on and
    read codes from an in-memory outbox instead of sending email."""
    from app.services import email_verification

    settings = get_settings()
    before = settings.require_email_verification
    settings.require_email_verification = False
    email_verification.outbox = []
    from app.services import push_service

    push_service.sent = []
    from app.services import notify

    notify.emailed = []
    yield
    settings.require_email_verification = before
    email_verification.outbox = None
    push_service.sent = None
    notify.emailed = None


@pytest.fixture(autouse=True)
def _no_startup_recovery():
    """Start-up recovery would reach for the app database from a thread."""
    settings = get_settings()
    before = settings.tabby_recover_on_startup
    settings.tabby_recover_on_startup = False
    yield
    settings.tabby_recover_on_startup = before


@pytest.fixture(autouse=True)
def _no_ai_usage_log():
    """AI usage is logged to the app database by default. Tests leave it out
    unless they use `db_session`, which points it at the test database."""
    ai_usage._factory = False
    yield
    ai_usage._factory = False


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
    ai_usage._factory = TestingSession
    scan_service.session_factory = TestingSession
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


@pytest.fixture()
def other_user(db_session: Session) -> User:
    """A second account, for asserting one user never sees another's data."""
    u = User(email="other@example.com", hashed_password="x")
    db_session.add(u)
    db_session.commit()
    db_session.refresh(u)
    return u
