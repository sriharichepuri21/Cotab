import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from app.api.v1 import (
    admin,
    analytics,
    auth,
    budgets,
    capture,
    chat,
    exports,
    inbox,
    insights,
    meta,
    push,
    receipts,
    reminders,
    saved_views,
    splits,
    tabby,
)
from app.config.settings import get_settings
from app.services.rate_limiter import verify_rate_limiter_backend

settings = get_settings()

if settings.sentry_dsn:
    import sentry_sdk

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.environment,
        release=f"{settings.app_name}@{settings.version}",
        traces_sample_rate=settings.sentry_traces_sample_rate,
        profiles_sample_rate=settings.sentry_profiles_sample_rate,
        send_default_pii=False,
        enable_tracing=True,
    )


class StreamFriendlyGZip(GZipMiddleware):
    """GZip, except for streamed chat answers.

    Compressing a stream holds its pieces back until a large block has built
    up, so the answer would arrive all at once at the end instead of word by
    word. The chat stream is small text, so sending it uncompressed costs
    little.
    """

    async def __call__(self, scope, receive, send):
        if scope.get("type") == "http" and scope.get("path", "").endswith(
            "/chat/stream"
        ):
            await self.app(scope, receive, send)
            return
        await super().__call__(scope, receive, send)


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.is_deployed():
        settings.validate_production()  # fail fast on insecure deployed config
    limiter_backend = verify_rate_limiter_backend()
    if settings.is_deployed() and limiter_backend != "redis":
        raise RuntimeError("deployed Redis rate limiter is unavailable")
    # Schema is managed by Alembic — apply migrations with `alembic upgrade head`
    # (Render does this in startCommand). No create_all() here: it silently
    # creates missing tables but never alters existing ones, and masks drift.
    from app.db.s3 import ensure_bucket_exists

    try:
        ensure_bucket_exists()
    except Exception:
        if settings.is_deployed():
            raise
        logging.getLogger(__name__).warning(
            "object store unavailable; local development will use disk",
            exc_info=True,
        )
    # Scans that were being read when the server last stopped: read them again.
    if settings.scan_in_background:
        import threading

        from app.services import scan_service

        threading.Thread(target=scan_service.resume_stuck, daemon=True).start()
    # Work a previous process left part-way (Tabby plans, forwarded emails).
    if settings.recover_on_startup:
        import threading

        from app.services import recovery

        threading.Thread(target=recovery.on_startup, daemon=True).start()
    yield


# The OCR extraction engine is gated off by default (settings.ocr_engine_enabled);
# extraction goes through Gemini until the flag is on. See extraction_service.
app = FastAPI(
    title=settings.app_name,
    version=settings.version,
    lifespan=lifespan,
)

# Compress JSON bigger than ~1 KB. Receipt lists and dashboard summaries shrink
# by 70-85%, which matters most on phones on cellular.
app.add_middleware(StreamFriendlyGZip, minimum_size=1000)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Server-Timing", "X-Total-Count", "X-Verify-Email", "Retry-After"],
    # The app sends a Bearer token, so every request needs a CORS "preflight"
    # check first: two round trips instead of one. Let browsers remember the
    # answer for 2 hours (Chrome's maximum) so the check happens once.
    max_age=7200,
)

timing_log = logging.getLogger("cotab.timing")
SLOW_REQUEST_MS = 800


@app.middleware("http")
async def server_timing(request: Request, call_next):
    """Report how long the server spent on each request.

    The browser's network panel shows it as Server-Timing, and anything slower
    than SLOW_REQUEST_MS is logged so slow endpoints show up in Render's logs.
    """
    start = time.perf_counter()
    response = await call_next(request)
    ms = (time.perf_counter() - start) * 1000
    response.headers["Server-Timing"] = f"app;dur={ms:.1f}"
    if ms > SLOW_REQUEST_MS:
        timing_log.warning(
            "slow request %s %s %.0fms", request.method, request.url.path, ms
        )
    return response


api_prefix = "/api/v1"
app.include_router(auth.router, prefix=api_prefix)
app.include_router(analytics.router, prefix=api_prefix)
app.include_router(budgets.router, prefix=api_prefix)
app.include_router(saved_views.router, prefix=api_prefix)
app.include_router(receipts.router, prefix=api_prefix)
app.include_router(chat.router, prefix=api_prefix)
app.include_router(reminders.router, prefix=api_prefix)
app.include_router(splits.router, prefix=api_prefix)
app.include_router(exports.router, prefix=api_prefix)
app.include_router(insights.router, prefix=api_prefix)
app.include_router(meta.router, prefix=api_prefix)
app.include_router(capture.router, prefix=api_prefix)
app.include_router(inbox.router, prefix=api_prefix)
app.include_router(admin.router, prefix=api_prefix)
app.include_router(tabby.router, prefix=api_prefix)
app.include_router(push.router, prefix=api_prefix)


@app.get("/health")
async def health():
    return {"status": "healthy", "version": settings.version, "app": settings.app_name}
