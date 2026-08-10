from functools import lru_cache
from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # App
    app_name: str = "ReceiptWise API"
    version: str = "0.1.0"
    environment: str = "development"
    debug: bool = True

    # CORS — comma-separated list, e.g. "https://app.vercel.app,https://receiptwise.app"
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    # Database — sqlite default for dev; env-driven Postgres DSN in prod (normalized by db_url helpers)
    database_url: str = "sqlite:///./receiptwise.db"

    # Storage — set s3_endpoint_url="" in prod to use real AWS S3,
    # or a Supabase S3-compatible endpoint w/ real keys (see docs/DEPLOYMENT.md).
    s3_endpoint_url: str = "http://localhost:4566"
    aws_access_key_id: str = "test"
    aws_secret_access_key: str = "test"
    aws_default_region: str = "us-east-1"
    s3_bucket: str = "receiptwise-uploads"

    # Optional read-role DSN for the text-to-SQL engine (defaults to DATABASE_URL)
    database_url_readonly: Optional[str] = None

    # Gemini AI
    gemini_api_key: Optional[str] = None
    gemini_model: str = "gemini-3.5-flash"

    # OCR-primary extraction (Phase 2). DISABLED by default: the rule engine still
    # needs row-reconstruction to work on real receipts (see ARCHITECTURE.md).
    # When disabled, extraction is exclusively Gemini. Flip via env to preview OCR.
    ocr_engine_enabled: bool = False
    # Thresholds used only when ocr_engine_enabled is true.
    ocr_total_threshold: float = 0.8
    ocr_merchant_threshold: float = 0.7

    # Security — dev placeholder, but Settings refuses to boot in production with it
    secret_key: str = "dev-secret-change-me-in-prod"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60
    refresh_token_expire_days: int = 30

    # Rate limits & policy
    rate_limit_chat_per_hour: int = 20
    soft_delete_grace_days: int = 30
    max_upload_bytes: int = 300 * 1024  # 300KB post client-side compression

    # Cron endpoints
    cron_secret: str = "dev-cron-secret"

    def is_production(self) -> bool:
        return self.environment == "production"

    def validate_production(self) -> None:
        """Called by app/main.py at startup — fail fast on insecure prod config."""
        from app.utils.db_url import is_sqlite_url

        if self.secret_key == "dev-secret-change-me-in-prod":
            raise RuntimeError(
                "SECRET_KEY must be set to a strong random value in production"
            )
        if not self.gemini_api_key:
            raise RuntimeError("GEMINI_API_KEY must be set in production")
        if is_sqlite_url(self.database_url):
            raise RuntimeError(
                "DATABASE_URL must point at Postgres in production (refusing sqlite)"
            )


@lru_cache
def get_settings() -> Settings:
    return Settings()
