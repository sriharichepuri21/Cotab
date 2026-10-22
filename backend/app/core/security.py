from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Cookie, Depends, Header, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from app.config.settings import get_settings
from app.db.session import get_db
from app.models import User

settings = get_settings()

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)

# Dev-only headers for local testing without registering a user
DEV_USER_HEADER = "x-dev-user"

# The browser flow authenticates via this httponly cookie; the Authorization
# header still works for curl/scripts (scripts/smoke.sh relies on it).
ACCESS_COOKIE = "rw_access"


def set_auth_cookie(response: Response, token: str) -> None:
    """Attach the session cookie.

    A new account gets a session straight away, but until its email is
    confirmed `get_current_user` only lets it reach the verification endpoints.

    Cross-site (vercel.app -> onrender.com) requires SameSite=None AND Secure.
    Browsers reject SameSite=None without Secure, and Secure cookies aren't
    stored over plain http — so localhost dev must use Lax/insecure instead.
    """
    cross_site = settings.is_production()
    response.set_cookie(
        key=ACCESS_COOKIE,
        value=token,
        httponly=True,
        secure=cross_site,
        samesite="none" if cross_site else "lax",
        max_age=settings.access_token_expire_minutes * 60,
        path="/",
    )


def clear_auth_cookie(response: Response) -> None:
    cross_site = settings.is_production()
    response.delete_cookie(
        key=ACCESS_COOKIE,
        path="/",
        httponly=True,
        secure=cross_site,
        samesite="none" if cross_site else "lax",
    )


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return pwd_context.verify(plain, hashed)
    except ValueError:
        # Unrecognised hash (e.g. the unusable marker on a deleted account):
        # treat as a non-match rather than a 500.
        return False


def create_access_token(user_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=settings.access_token_expire_minutes
    )
    return jwt.encode(
        {"sub": user_id, "exp": expire, "type": "access"},
        settings.secret_key,
        algorithm=settings.algorithm,
    )


def _user_from_token(token: str, db: Session) -> User:
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(
            token, settings.secret_key, algorithms=[settings.algorithm]
        )
        user_id: Optional[str] = payload.get("sub")
        if not user_id:
            raise credentials_exc
        # Only short-lived access tokens authenticate requests. Any other
        # token type (e.g. a long-lived refresh token) must never be accepted
        # here, or it becomes a 30-day session credential.
        if payload.get("type") != "access":
            raise credentials_exc
    except JWTError:
        raise credentials_exc
    user = db.query(User).filter(User.id == user_id, User.deleted_at.is_(None)).first()
    if not user:
        raise credentials_exc
    return user


# What an account that hasn't confirmed its email may still do: see who it is,
# confirm, ask for a new code, sign out, or delete itself.
UNVERIFIED_ALLOWED = (
    "/auth/me",
    "/auth/verify-email",
    "/auth/verify-email/resend",
    "/auth/logout",
    "/auth/delete-account",
    "/auth/delete-account/code",
)


def _require_verified(request: Optional[Request], user: User) -> User:
    if (
        user.email_verified
        or not settings.require_email_verification
        or request is None
        or request.url.path.rstrip("/").endswith(UNVERIFIED_ALLOWED)
    ):
        return user
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Confirm your email first. Tabby sent you a code.",
        headers={"X-Verify-Email": "1"},
    )


def get_current_user(
    request: Request,
    token: Optional[str] = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
    x_dev_user: Optional[str] = Header(default=None),
    rw_access: Optional[str] = Cookie(default=None),
) -> User:
    # Bearer header wins when present (curl/scripts); otherwise use the cookie.
    token = token or rw_access
    # Local-dev escape hatch: pass X-Dev-User header instead of a JWT.
    # Allowed only when ENVIRONMENT is exactly "development" (fail closed).
    if settings.is_development() and x_dev_user:
        user = (
            db.query(User)
            .filter(User.email == x_dev_user, User.deleted_at.is_(None))
            .first()
        )
        if not user:
            user = User(
                email=x_dev_user,
                hashed_password=hash_password("dev"),
                full_name="Dev User",
                email_verified=True,
            )
            db.add(user)
            db.commit()
            db.refresh(user)
        return user
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return _require_verified(request, _user_from_token(token, db))
