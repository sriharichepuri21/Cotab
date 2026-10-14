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

from functools import lru_cache
from typing import Any, Iterator, Optional

from google import genai
from google.genai import errors, types

from app.config.settings import get_settings

APIError = errors.APIError


@lru_cache
def _client() -> genai.Client:
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
    return _client().models.generate_content(
        model=model, contents=contents, config=config
    )


def stream(
    model: str, contents: Any, config: Optional[types.GenerateContentConfig] = None
) -> Iterator[Any]:
    return _client().models.generate_content_stream(
        model=model, contents=contents, config=config
    )


def is_quota_error(exc: BaseException) -> bool:
    """Google's own rate limit or quota (HTTP 429), not ours."""
    return isinstance(exc, APIError) and getattr(exc, "code", None) == 429
