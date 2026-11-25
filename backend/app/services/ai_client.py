"""The one place Cotab talks to Gemini, through Google's current SDK
(`google-genai`).

The retired `google-generativeai` SDK dropped the "thought signatures" that
Gemini 3 models attach to function calls, so every chat question that needed
a lookup failed on its second step. This SDK keeps them on the response
parts, and passing the parts back as-is is all it takes.

Tests replace `generate` and `stream` with fakes; nothing else imports the SDK
client directly.
"""

from __future__ import annotations

import threading
import time
from functools import lru_cache
from typing import Any, Iterator, Optional

from google import genai
from google.genai import errors, types

from app.config.settings import get_settings

APIError = errors.APIError


_client_lock = threading.Lock()


def _client() -> genai.Client:
    # Parallel scans used to race here and each build a client; the spare ones
    # were garbage-collected mid-request, which closes their connection.
    with _client_lock:
        return _new_client()


@lru_cache
def _new_client() -> genai.Client:
    settings = get_settings()
    if not settings.gemini_api_key:
        raise RuntimeError("GEMINI_API_KEY not configured")
    # 60s covers a long receipt PDF; anything slower is better retried.
    return genai.Client(
        api_key=settings.gemini_api_key,
        http_options=types.HttpOptions(timeout=60_000),
    )


def generate(
    model: str, contents: Any, config: Optional[types.GenerateContentConfig] = None
):
    # A burst of scans (several screenshots at once) trips Google's rate limit;
    # a short wait clears it, where giving up leaves a blank $0 receipt.
    for attempt in range(3):
        try:
            return _client().models.generate_content(
                model=model, contents=contents, config=config
            )
        except APIError as exc:
            if attempt == 2 or not _is_transient(exc):
                raise
            time.sleep(2 * (attempt + 1))


def stream(
    model: str, contents: Any, config: Optional[types.GenerateContentConfig] = None
) -> Iterator[Any]:
    return _client().models.generate_content_stream(
        model=model, contents=contents, config=config
    )


def is_quota_error(exc: BaseException) -> bool:
    """Google's own rate limit or quota (HTTP 429), not ours."""
    return isinstance(exc, APIError) and getattr(exc, "code", None) == 429


def _is_transient(exc: APIError) -> bool:
    """Rate limit or a Google-side hiccup: worth one more try."""
    code = getattr(exc, "code", None) or 0
    return code == 429 or code >= 500
