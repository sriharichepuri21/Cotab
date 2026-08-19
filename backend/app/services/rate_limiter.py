"""Shared sliding-window rate limits with an optional Redis backend.

Redis is authoritative whenever ``REDIS_URL`` is configured. If that backend
fails, expensive AI/SQL operations fail closed by default instead of silently
becoming unlimited. Local development remains zero-setup through the bounded
in-process fallback used when no Redis URL is configured.
"""

import logging
import threading
import time
import uuid
from collections import defaultdict, deque
from functools import lru_cache
from typing import Deque, Dict, Optional, cast

import redis
from redis import Redis
from redis.exceptions import RedisError

from app.config.settings import get_settings

logger = logging.getLogger(__name__)

_SLIDING_WINDOW_LUA = """
local key = KEYS[1]
local now = tonumber(ARGV[1])
local cutoff = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, '-inf', cutoff)
local count = redis.call('ZCARD', key)
if count >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retry_ms = 0
  if oldest[2] then retry_ms = math.max(0, tonumber(oldest[2]) + (now - cutoff) - now) end
  return {0, count, retry_ms}
end
redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, now - cutoff)
return {1, count + 1, 0}
"""

_memory_windows: Dict[str, Deque[float]] = defaultdict(deque)
_memory_lock = threading.Lock()


class RateLimitExceeded(Exception):
    def __init__(self, retry_after_seconds: int = 3600):
        self.retry_after_seconds = max(1, retry_after_seconds)
        super().__init__("Rate limit exceeded")


class RateLimitUnavailable(Exception):
    pass


@lru_cache(maxsize=1)
def _redis_client() -> Optional[Redis]:
    url = get_settings().redis_url
    if not url:
        return None
    return redis.Redis.from_url(
        url,
        decode_responses=True,
        socket_connect_timeout=2,
        socket_timeout=2,
        health_check_interval=30,
    )


def _check_memory(key: str, limit: int, window_seconds: int) -> None:
    now = time.time()
    cutoff = now - window_seconds
    with _memory_lock:
        window = _memory_windows[key]
        while window and window[0] <= cutoff:
            window.popleft()
        if len(window) >= limit:
            retry = int(max(1, window[0] + window_seconds - now))
            raise RateLimitExceeded(retry)
        window.append(now)


def check_rate_limit(
    bucket: str,
    subject: str,
    limit: int,
    window_seconds: int = 3600,
) -> None:
    """Consume one slot or raise a typed rate-limit exception."""
    if limit < 1:
        raise ValueError("limit must be positive")
    settings = get_settings()
    key = f"{settings.rate_limit_key_prefix}:{bucket}:{subject}"
    client = _redis_client()
    if client is None:
        _check_memory(key, limit, window_seconds)
        return

    now_ms = int(time.time() * 1000)
    window_ms = window_seconds * 1000
    try:
        allowed, _count, retry_ms = cast(
            list[int],
            client.eval(
                _SLIDING_WINDOW_LUA,
                1,
                key,
                str(now_ms),
                str(now_ms - window_ms),
                str(limit),
                f"{now_ms}:{uuid.uuid4().hex}",
            ),
        )
    except RedisError as exc:
        logger.exception("Redis rate limiter unavailable (bucket=%s)", bucket)
        if settings.rate_limit_fail_closed:
            raise RateLimitUnavailable("Rate limiter unavailable") from exc
        _check_memory(key, limit, window_seconds)
        return

    if not int(allowed):
        raise RateLimitExceeded(max(1, int(retry_ms) // 1000))


def _reset_for_tests() -> None:
    _redis_client.cache_clear()
    with _memory_lock:
        _memory_windows.clear()
