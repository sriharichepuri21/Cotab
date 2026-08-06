from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1 import auth, chat, exports, receipts, reminders, splits
from app.config.settings import get_settings
from app.db.session import Base, engine

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Dev convenience: create tables if missing (Alembic in prod)
    Base.metadata.create_all(bind=engine)
    try:
        from app.db.s3 import ensure_bucket_exists
        ensure_bucket_exists()
    except Exception:
        pass  # object store optional locally
    yield


app = FastAPI(
    title=settings.app_name,
    version=settings.version,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

api_prefix = "/api/v1"
app.include_router(auth.router, prefix=api_prefix)
app.include_router(receipts.router, prefix=api_prefix)
app.include_router(chat.router, prefix=api_prefix)
app.include_router(reminders.router, prefix=api_prefix)
app.include_router(splits.router, prefix=api_prefix)
app.include_router(exports.router, prefix=api_prefix)


@app.get("/health")
async def health():
    return {"status": "healthy", "version": settings.version, "app": settings.app_name}
