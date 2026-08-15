from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1 import (
    analytics,
    auth,
    chat,
    exports,
    receipts,
    reminders,
    saved_views,
    splits,
)
from app.config.settings import get_settings

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.is_production():
        settings.validate_production()  # fail fast on insecure prod config
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

api_prefix = "/api/v1"
app.include_router(auth.router, prefix=api_prefix)
app.include_router(analytics.router, prefix=api_prefix)
app.include_router(saved_views.router, prefix=api_prefix)
app.include_router(receipts.router, prefix=api_prefix)
app.include_router(chat.router, prefix=api_prefix)
app.include_router(reminders.router, prefix=api_prefix)
app.include_router(splits.router, prefix=api_prefix)
app.include_router(exports.router, prefix=api_prefix)


@app.get("/health")
async def health():
    return {"status": "healthy", "version": settings.version, "app": settings.app_name}
