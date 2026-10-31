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
    # The everyday model for scans, emails and chat: the cheapest current one
    # that reads receipts well. "gemini-3.5-flash" now routes to 3.6 Flash,
    # which costs about 2.5x as much per token (and doubles again in 2027).
    gemini_model: str = "gemini-3.5-flash-lite"
    # A second read with a stronger model, only for receipts the everyday
    # model found hard (faded, long, crumpled). Empty turns it off.
    gemini_upgrade_model: str = "gemini-3.8-flash"

    # AI spending caps, in US dollars, estimated from tokens at paid-tier
    # prices (the free tier costs nothing, so these are a ceiling, not a bill).
    # Per person per day, so one heavy user can't use up everyone's share...
    ai_user_daily_budget_usd: float = 0.25
    # ...and for the whole app per day, so a bug or abuse can't run up a bill.
    ai_daily_budget_usd: float = 3.00

    # Read scans on worker threads after the upload has answered. Off in tests,
    # where the read happens inside the upload request instead.
    scan_in_background: bool = True

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

    # Rate limits & policy
    # Chat questions per person per hour that need the AI (quick answers from
    # the database don't count). The daily AI budget is the real cost cap.
    rate_limit_chat_per_hour: int = 60
    # Password-guessing guard: login attempts per email address per 15 minutes.
    # Keyed on the account, not the client IP: behind Render's proxy every
    # request can appear to come from the same address.
    rate_limit_login_per_15min: int = 10
    rate_limit_login_per_ip_15min: int = 50
    # Every upload is a paid Gemini vision call.
    rate_limit_upload_per_hour: int = 60
    redis_url: Optional[str] = None
    rate_limit_key_prefix: str = "receiptwise:rate-limit"
    rate_limit_fail_closed: bool = True
    # Lets chat answer long-tail questions ("coffee on weekends since June")
    # with one read-only, validated, user-scoped SELECT. The canary lists only
    # matter if this is turned off.
    execute_sql_enabled: bool = True
    execute_sql_canary_user_ids: str = ""
    execute_sql_canary_emails: str = ""
    rate_limit_execute_sql_per_hour: int = 60
    soft_delete_grace_days: int = 30
    # Upload ceiling: generous (5MB) so phone photos are never rejected on size.
    # Frontend still light-compresses (~1MB target) for upload speed and to stay
    # well under Gemini's ~20MB inline-request limit. This is a hard cap, not a
    # "please crop" gate.
    max_upload_bytes: int = 5 * 1024 * 1024  # 5MB

    # Cron endpoints
    cron_secret: str = "dev-cron-secret"

    # Where operator alerts go (a Tabby undo that failed, a step interrupted
    # part-way, AI spend nearing its daily cap). Alerts are always logged at
    # ERROR; with this and email sending set up they are emailed too.
    ops_alert_email: Optional[str] = None
    # Share of the app-wide AI daily budget at which to warn the operator.
    ai_budget_alert_ratio: float = 0.8
    # On start-up, put back Tabby plans a previous process left part-way.
    tabby_recover_on_startup: bool = True

    # Email forwarding through Resend's inbound email. All three must be set
    # for the feature to switch on; until then the app hides it.
    resend_api_key: Optional[str] = None
    # The webhook's signing secret from the Resend dashboard (starts whsec_).
    resend_webhook_secret: Optional[str] = None
    # The receiving domain Resend gives you, e.g. "abc123.resend.app".
    inbound_email_domain: Optional[str] = None

    # Sending mail (verification codes) through Resend. EMAIL_FROM must be an
    # address on a domain verified in Resend, e.g. "Tabby at Cotab
    # <hello@cotab.app>". Without both, codes are written to the server log
    # in development and sign-up can't finish elsewhere.
    email_from: Optional[str] = None
    # New accounts must confirm their email with a code before using the app.
    require_email_verification: bool = True
    verify_code_minutes: int = 15
    verify_max_attempts: int = 5
    verify_resend_seconds: int = 60
    # Only numbers proved by a texted code link to an account (joining tabs
    # put on that number, being found by it). Off while Cotab is private and
    # has no SMS codes; turn on together with them before a public launch.
    require_phone_verification: bool = False
    # The app's web address, e.g. "https://www.cotab.center", for links in
    # notification emails. Empty: emails just say to open Cotab.
    app_url: str = ""

    # Sign in with Google: the OAuth web client id from Google Cloud.
    google_client_id: Optional[str] = None
    # Sign in with Apple: the Services ID from Apple Developer, e.g.
    # "app.cotab.signin". Its return URL must be the frontend's /login page.
    apple_client_id: Optional[str] = None

    def email_sending_enabled(self) -> bool:
        return bool(self.resend_api_key and self.email_from)

    def email_forwarding_enabled(self) -> bool:
        return bool(
            self.resend_api_key
            and self.resend_webhook_secret
            and self.inbound_email_domain
        )

    def is_production(self) -> bool:
        return self.environment == "production"

    def allowed_origins(self) -> list:
        """The sites the app runs on (CORS_ORIGINS)."""
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    def is_development(self) -> bool:
        """True only for an explicit local-dev environment.

        Dev-only conveniences (the X-Dev-User header) key off this rather than
        `not is_production()`, so a typo such as ENVIRONMENT=Production or
        ENVIRONMENT=prod fails closed instead of opening an unauthenticated
        account-creation endpoint.
        """
        return self.environment == "development"

    def execute_sql_is_enabled_for(
        self,
        user_id: Optional[str] = None,
        user_email: Optional[str] = None,
    ) -> bool:
        """Global gate plus explicit authenticated user canary allowlists."""
        if self.execute_sql_enabled:
            return True
        canary_ids = {
            value.strip()
            for value in self.execute_sql_canary_user_ids.split(",")
            if value.strip()
        }
        canary_emails = {
            value.strip().lower()
            for value in self.execute_sql_canary_emails.split(",")
            if value.strip()
        }
        return bool(
            (user_id and user_id in canary_ids)
            or (user_email and user_email.strip().lower() in canary_emails)
        )

    def validate_production(self) -> None:
        """Called by app/main.py at startup — fail fast on insecure prod config."""
        from app.utils.db_url import is_sqlite_url

        if self.secret_key == "dev-secret-change-me-in-prod":
            raise RuntimeError(
                "SECRET_KEY must be set to a strong random value in production"
            )
        if self.cron_secret in ("", "dev-cron-secret"):
            raise RuntimeError(
                "CRON_SECRET must be set to a strong random value in production"
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
