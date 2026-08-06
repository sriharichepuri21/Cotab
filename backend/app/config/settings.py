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

    # Database
    database_url: str = "sqlite:///./receiptwise.db"

    # AWS / LocalStack
    aws_endpoint_url: Optional[str] = "http://localhost:4566"
    aws_access_key_id: str = "test"
    aws_secret_access_key: str = "test"
    aws_default_region: str = "us-east-1"
    s3_bucket: str = "receiptwise-uploads"

    # Gemini AI
    gemini_api_key: Optional[str] = None
    gemini_model: str = "gemini-1.5-flash"

    # Security
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


@lru_cache
def get_settings() -> Settings:
    return Settings()
