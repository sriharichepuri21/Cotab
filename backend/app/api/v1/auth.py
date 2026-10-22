from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.api.v1.split_schemas import PayHandles
from app.config.settings import get_settings
from app.core.security import (
    clear_auth_cookie,
    create_access_token,
    get_current_user,
    hash_password,
    set_auth_cookie,
    verify_password,
)
from app.db.session import get_db
from app.models import User
from app.schemas.auth import (
    DeleteAccountRequest,
    IntentRequest,
    ProfileUpdate,
    RegisterRequest,
    TokenResponse,
    UserOut,
)
from app.services import pay_links
from app.services.account_service import delete_account
from app.services.rate_limiter import (
    RateLimitExceeded,
    RateLimitUnavailable,
    check_rate_limit,
)

settings = get_settings()
router = APIRouter(prefix="/auth", tags=["auth"])


def _check_login_rate_limit(email: str) -> None:
    try:
        check_rate_limit(
            "login",
            email.strip().lower(),
            settings.rate_limit_login_per_15min,
            window_seconds=15 * 60,
        )
    except RateLimitExceeded as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many sign-in attempts. Please wait a few minutes.",
            headers={"Retry-After": str(exc.retry_after_seconds)},
        )
    except RateLimitUnavailable:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Sign-in is temporarily unavailable. Please try again soon.",
        )


@router.post("/register", response_model=TokenResponse)
def register(body: RegisterRequest, response: Response, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.email == body.email).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Email already registered"
        )
    user = User(
        email=body.email,
        hashed_password=hash_password(body.password),
        full_name=body.full_name,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    access = create_access_token(user.id)
    set_auth_cookie(response, access)
    return TokenResponse(access_token=access)


@router.post("/login", response_model=TokenResponse)
def login(
    response: Response,
    form: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    _check_login_rate_limit(form.username)
    user = (
        db.query(User)
        .filter(User.email == form.username, User.deleted_at.is_(None))
        .first()
    )
    if not user or not verify_password(form.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
        )
    access = create_access_token(user.id)
    set_auth_cookie(response, access)
    return TokenResponse(access_token=access)


@router.post("/logout")
def logout(response: Response):
    """Clear the session cookie. Safe to call when already logged out."""
    clear_auth_cookie(response)
    return {"ok": True}


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user


@router.post("/set-intent", response_model=UserOut)
def set_intent(
    body: IntentRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Record the onboarding answer. Validated against a fixed set so the
    frontend can't write arbitrary values into the column."""
    user.intent = body.intent
    db.commit()
    db.refresh(user)
    return user


@router.post("/delete-account")
def delete_my_account(
    body: DeleteAccountRequest,
    response: Response,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Permanently close the caller's account. Requires the current password."""
    if not verify_password(body.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Password is incorrect"
        )
    delete_account(db, user)
    clear_auth_cookie(response)
    return {"ok": True}


@router.patch("/me", response_model=UserOut)
def update_profile(
    body: ProfileUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Change your name or your Tabby. Fields left out stay as they are."""
    changes = body.model_dump(exclude_unset=True)
    if "full_name" in changes:
        name = (changes["full_name"] or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Add your first name.")
        changes["full_name"] = name
    for field, value in changes.items():
        setattr(user, field, value)
    db.commit()
    db.refresh(user)
    return user


@router.get("/me/pay-handles")
def get_pay_handles(user: User = Depends(get_current_user)):
    """Where friends can pay you: Venmo, PayPal, Cash App and Zelle."""
    return pay_links.load(user.pay_handles)


@router.put("/me/pay-handles")
def set_pay_handles(
    body: PayHandles,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    try:
        handles = pay_links.clean_handles(body.model_dump())
    except pay_links.HandleError as error:
        raise HTTPException(status_code=400, detail=str(error))
    user.pay_handles = pay_links.dump(handles)
    db.commit()
    return handles
