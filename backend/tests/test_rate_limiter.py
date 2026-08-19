from unittest.mock import Mock

import pytest
from redis.exceptions import ConnectionError

from app.config.settings import get_settings
from app.services import rate_limiter


@pytest.fixture(autouse=True)
def reset_limiter(monkeypatch):
    rate_limiter._reset_for_tests()
    monkeypatch.setattr(get_settings(), "redis_url", None)
    monkeypatch.setattr(get_settings(), "rate_limit_fail_closed", True)
    yield
    with rate_limiter._memory_lock:
        rate_limiter._memory_windows.clear()


def test_memory_sliding_window_rejects_after_limit():
    rate_limiter.check_rate_limit("chat", "user-1", 2)
    rate_limiter.check_rate_limit("chat", "user-1", 2)
    with pytest.raises(rate_limiter.RateLimitExceeded):
        rate_limiter.check_rate_limit("chat", "user-1", 2)


def test_buckets_and_users_are_isolated():
    rate_limiter.check_rate_limit("chat", "user-1", 1)
    rate_limiter.check_rate_limit("chat", "user-2", 1)
    rate_limiter.check_rate_limit("execute-sql", "user-1", 1)


def test_startup_check_reports_memory_fallback(monkeypatch, caplog):
    monkeypatch.setattr(rate_limiter, "_redis_client", lambda: None)

    with caplog.at_level("WARNING"):
        backend = rate_limiter.verify_rate_limiter_backend()

    assert backend == "memory"
    assert "Rate limiter backend: memory fallback" in caplog.text


def test_startup_check_pings_and_reports_shared_redis(monkeypatch, caplog):
    client = Mock()
    monkeypatch.setattr(rate_limiter, "_redis_client", lambda: client)

    with caplog.at_level("WARNING"):
        backend = rate_limiter.verify_rate_limiter_backend()

    assert backend == "redis"
    client.ping.assert_called_once_with()
    assert "Rate limiter backend: redis (shared)" in caplog.text


def test_startup_check_sanitizes_redis_failure(monkeypatch, caplog):
    client = Mock()
    client.ping.side_effect = ConnectionError("redis://user:secret@private-host")
    monkeypatch.setattr(rate_limiter, "_redis_client", lambda: client)

    with caplog.at_level("ERROR"):
        backend = rate_limiter.verify_rate_limiter_backend()

    assert backend == "unavailable"
    assert "Rate limiter backend: redis unavailable" in caplog.text
    assert "secret" not in caplog.text
    assert "private-host" not in caplog.text


def test_redis_backend_uses_atomic_script(monkeypatch):
    client = Mock()
    client.eval.return_value = [1, 1, 0]
    monkeypatch.setattr(rate_limiter, "_redis_client", lambda: client)

    rate_limiter.check_rate_limit("chat", "user-1", 20)

    args = client.eval.call_args.args
    assert args[1] == 1
    assert args[2] == "receiptwise:rate-limit:chat:user-1"
    assert args[5] == "20"


def test_redis_limit_response_is_enforced(monkeypatch):
    client = Mock()
    client.eval.return_value = [0, 20, 30_000]
    monkeypatch.setattr(rate_limiter, "_redis_client", lambda: client)

    with pytest.raises(rate_limiter.RateLimitExceeded) as exc:
        rate_limiter.check_rate_limit("chat", "user-1", 20)
    assert exc.value.retry_after_seconds == 30


def test_redis_failure_fails_closed_by_default(monkeypatch):
    client = Mock()
    client.eval.side_effect = ConnectionError("secret host details")
    monkeypatch.setattr(rate_limiter, "_redis_client", lambda: client)

    with pytest.raises(rate_limiter.RateLimitUnavailable):
        rate_limiter.check_rate_limit("chat", "user-1", 20)


def test_redis_failure_can_fall_back_for_low_risk_environments(monkeypatch):
    client = Mock()
    client.eval.side_effect = ConnectionError("offline")
    monkeypatch.setattr(rate_limiter, "_redis_client", lambda: client)
    monkeypatch.setattr(get_settings(), "rate_limit_fail_closed", False)

    rate_limiter.check_rate_limit("chat", "user-1", 1)
    with pytest.raises(rate_limiter.RateLimitExceeded):
        rate_limiter.check_rate_limit("chat", "user-1", 1)
