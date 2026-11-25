import pytest

from app.services import ai_client


class _Models:
    def __init__(self, failures):
        self.failures = list(failures)
        self.calls = 0

    def generate_content(self, **_):
        self.calls += 1
        if self.failures:
            raise ai_client.APIError(self.failures.pop(0), {"error": {"message": "x"}})
        return "ok"


def _patch(monkeypatch, models):
    monkeypatch.setattr(ai_client, "_client", lambda: type("C", (), {"models": models})())
    monkeypatch.setattr(ai_client.time, "sleep", lambda _s: None)


def test_rate_limit_is_retried(monkeypatch):
    models = _Models([429, 503])
    _patch(monkeypatch, models)
    assert ai_client.generate("m", []) == "ok"
    assert models.calls == 3


def test_bad_request_is_not_retried(monkeypatch):
    models = _Models([400])
    _patch(monkeypatch, models)
    with pytest.raises(ai_client.APIError):
        ai_client.generate("m", [])
    assert models.calls == 1


def test_gives_up_after_three_tries(monkeypatch):
    models = _Models([429, 429, 429])
    _patch(monkeypatch, models)
    with pytest.raises(ai_client.APIError):
        ai_client.generate("m", [])
    assert models.calls == 3


def test_parallel_callers_share_one_client(monkeypatch):
    import threading
    import time as _time

    built = []

    def slow_build():
        _time.sleep(0.05)  # widen the race window
        built.append(1)
        return object()

    monkeypatch.setattr(ai_client, "_new_client", ai_client.lru_cache(slow_build))
    threads = [threading.Thread(target=ai_client._client) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(built) == 1
