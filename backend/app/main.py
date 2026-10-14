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
    receipts,
    reminders,
    saved_views,
    splits,
)
from app.config.settings import get_settings
from app.services.rate_limiter import verify_rate_limiter_backend

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.is_production():
        settings.validate_production()  # fail fast on insecure prod config
    verify_rate_limiter_backend()
    # Schema is managed by Alembic — apply migrations with `alembic upgrade head`
    # (Render does this in startCommand). No create_all() here: it silently
    # creates missing tables but never alters existing ones, and masks drift.
    try:
        from app.db.s3 import ensure_bucket_exists

        ensure_bucket_exists()
    except Exception:
        pass  # object store optional locally
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
app.add_middleware(GZipMiddleware, minimum_size=1000)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Server-Timing", "X-Total-Count"],
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


@app.get("/health")
async def health():
    return {"status": "healthy", "version": settings.version, "app": settings.app_name}
