"""Scripted stand-ins for Gemini, built from the SDK's real response types so
the code under test reads them exactly as it reads the real thing."""

from __future__ import annotations

from typing import Any, List, Optional

from google.genai import types


def usage(prompt: int = 1000, output: int = 200, thoughts: int = 0):
    return types.GenerateContentResponseUsageMetadata(
        prompt_token_count=prompt,
        candidates_token_count=output,
        thoughts_token_count=thoughts,
        total_token_count=prompt + output + thoughts,
    )


def _response(parts: List[types.Part], meta=None, finish=None):
    return types.GenerateContentResponse(
        candidates=[
            types.Candidate(
                content=types.Content(role="model", parts=parts), finish_reason=finish
            )
        ],
        usage_metadata=meta,
    )


def text(t: str, meta=None):
    """A chunk of answer text."""
    return _response([types.Part(text=t)], meta)


def call(name: str, signature: bytes = b"sig-1", meta=None, **args):
    """A chunk asking for a tool, carrying a thought signature like Gemini 3."""
    return _response(
        [
            types.Part(
                function_call=types.FunctionCall(name=name, args=args),
                thought_signature=signature,
            )
        ],
        meta,
    )


class Stream:
    """Replaces ai_client.stream. Each step is the list of chunks one model
    round trip returns; every request is recorded for inspection."""

    def __init__(self, *steps: List[Any]):
        self.steps = list(steps)
        self.requests: List[dict] = []

    def __call__(self, model: str, contents, config=None):
        self.requests.append(
            {"model": model, "contents": list(contents), "config": config}
        )
        if not self.steps:
            raise AssertionError("the model was asked more times than scripted")
        step = self.steps.pop(0)
        if isinstance(step, Exception):
            raise step
        yield from step


class Generate:
    """Replaces ai_client.generate: answers per model name."""

    def __init__(self, answers: dict, meta: Optional[Any] = None):
        self.answers = answers
        self.calls: List[tuple] = []
        self.meta = meta

    def __call__(self, model: str, contents, config=None):
        import json

        self.calls.append((model, config))
        return types.GenerateContentResponse(
            candidates=[
                types.Candidate(
                    content=types.Content(
                        role="model",
                        parts=[types.Part(text=json.dumps(self.answers[model]))],
                    )
                )
            ],
            usage_metadata=self.meta or usage(),
        )
