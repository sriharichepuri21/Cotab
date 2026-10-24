import secrets

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.exc import IntegrityError
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
    AppleSignIn,
    DeleteAccountRequest,
    ForgotPasswordRequest,
    GoogleSignIn,
    IntentRequest,
    PhoneUpdate,
    ProfileUpdate,
    RegisterRequest,
    ResetPasswordRequest,
    TokenResponse,
    UserOut,
    VerifyEmailRequest,
)
from app.services import email_verification, invites, notify, pay_links, social_auth
from app.services.account_service import delete_account
from app.services.rate_limiter import (
    RateLimitExceeded,
    RateLimitUnavailable,
    check_rate_limit,
)
from app.utils.phone import PhoneError, normalize_us_phone

settings = get_settings()
router = APIRouter(prefix="/auth", tags=["auth"])


def _check_login_rate_limit(email: str, bucket: str = "login") -> None:
    try:
        check_rate_limit(
            bucket,
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


def _send_first_code(db: Session, user: User) -> None:
    """Email a brand-new account its code. A failed send doesn't undo the
    account: the code screen offers "Send a new code"."""
    if not settings.require_email_verification:
        return
    try:
        email_verification.send_code(db, user, force=True)
    except email_verification.VerifyError:
        pass


def _signed_in(
    response: Response, user: User, new_account: bool = False
) -> TokenResponse:
    access = create_access_token(user.id)
    set_auth_cookie(response, access)
    return TokenResponse(
        access_token=access,
        email_verified=bool(user.email_verified)
        or not settings.require_email_verification,
        new_account=new_account,
    )


@router.post("/register", response_model=TokenResponse)
def register(body: RegisterRequest, response: Response, db: Session = Depends(get_db)):
    _check_login_rate_limit(body.email, bucket="register")
    existing = db.query(User).filter(User.email == body.email).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Email already registered"
        )
    user = User(
        email=body.email,
        hashed_password=hash_password(body.password),
        full_name=body.full_name,
        email_verified=not settings.require_email_verification,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    _send_first_code(db, user)
    return _signed_in(response, user, new_account=True)


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
    return _signed_in(response, user)


@router.post("/password/forgot")
def forgot_password(body: ForgotPasswordRequest, db: Session = Depends(get_db)):
    """Email a code for choosing a new password.

    Always answers the same way, whether or not the email has an account, so
    this can't be used to find out who uses Cotab."""
    _check_login_rate_limit(body.email, bucket="reset")
    user = (
        db.query(User)
        .filter(User.email == body.email, User.deleted_at.is_(None))
        .first()
    )
    if user is not None:
        try:
            email_verification.send_code(db, user, purpose="reset")
        except email_verification.VerifyError as error:
            if error.code != "too_soon":
                raise _verify_error(error)
    return {"sent": True, "email": body.email}


@router.post("/password/reset", response_model=TokenResponse)
def reset_password(
    body: ResetPasswordRequest, response: Response, db: Session = Depends(get_db)
):
    """Check the emailed code, set the new password and sign in."""
    _check_login_rate_limit(body.email, bucket="reset-check")
    user = (
        db.query(User)
        .filter(User.email == body.email, User.deleted_at.is_(None))
        .first()
    )
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="That code isn't right."
        )
    try:
        email_verification.check_action_code(db, user, body.code, "reset")
    except email_verification.VerifyError as error:
        raise _verify_error(error)
    user.hashed_password = hash_password(body.new_password)
    user.has_password = True
    # Getting the code proves they own the email.
    user.email_verified = True
    db.commit()
    return _signed_in(response, user)


@router.post("/logout")
def logout(response: Response):
    """Clear the session cookie. Safe to call when already logged out."""
    clear_auth_cookie(response)
    return {"ok": True}


def _verify_error(error: email_verification.VerifyError) -> HTTPException:
    codes = {
        "too_soon": status.HTTP_429_TOO_MANY_REQUESTS,
        "locked": status.HTTP_429_TOO_MANY_REQUESTS,
        "unavailable": status.HTTP_503_SERVICE_UNAVAILABLE,
    }
    headers = {"Retry-After": str(error.retry_after)} if error.retry_after else None
    return HTTPException(
        status_code=codes.get(error.code, status.HTTP_400_BAD_REQUEST),
        detail=error.message,
        headers=headers,
    )


@router.post("/verify-email", response_model=UserOut)
def verify_email(
    body: VerifyEmailRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Confirm the email with the 6-digit code Tabby sent."""
    try:
        email_verification.check_code(db, user, body.code)
    except email_verification.VerifyError as error:
        raise _verify_error(error)
    db.refresh(user)
    return user


@router.post("/verify-email/resend")
def resend_code(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Send a fresh code (at most once a minute, a few times an hour)."""
    if user.email_verified:
        return {"sent": False, "email_verified": True, "retry_after": 0}
    try:
        check_rate_limit("verify-resend", user.id, 6, window_seconds=60 * 60)
    except RateLimitExceeded as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="That's a lot of codes. Try again in a little while.",
            headers={"Retry-After": str(exc.retry_after_seconds)},
        )
    except RateLimitUnavailable:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Codes can't be sent right now. Please try again soon.",
        )
    try:
        wait = email_verification.send_code(db, user)
    except email_verification.VerifyError as error:
        raise _verify_error(error)
    return {"sent": True, "email": user.email, "retry_after": wait}


@router.get("/providers")
def providers():
    """Which sign-in options this server offers, and the public ids the
    browser needs to start them. Client ids are public by design."""
    return {
        "google_client_id": settings.google_client_id,
        "apple_client_id": settings.apple_client_id,
    }


def _social_sign_in(
    db: Session, response: Response, identity: social_auth.Identity
) -> TokenResponse:
    """Find the account for a Google or Apple identity, link it to an
    existing account with the same email, or create one (which then gets a
    code like any new account)."""
    _check_login_rate_limit(f"{identity.provider}:{identity.sub}", bucket="social")
    column = User.google_sub if identity.provider == "google" else User.apple_sub
    field = "google_sub" if identity.provider == "google" else "apple_sub"
    user = (
        db.query(User).filter(column == identity.sub, User.deleted_at.is_(None)).first()
    )
    if user:
        return _signed_in(response, user)
    if not identity.email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="We need your email to make an account. Share it and try again.",
        )
    user = (
        db.query(User)
        .filter(User.email == identity.email, User.deleted_at.is_(None))
        .first()
    )
    if user:
        # Linking by email is only safe when the provider vouches for it.
        if not identity.email_verified:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This email already has a Cotab account. Log in with your password.",
            )
        if not user.email_verified:
            # Someone may have signed up with this address without owning it.
            # The real owner has just proved it, so their password stops working.
            user.hashed_password = hash_password(secrets.token_urlsafe(32))
            user.has_password = False
        setattr(user, field, identity.sub)
        db.commit()
        return _signed_in(response, user)
    user = User(
        email=identity.email,
        hashed_password=hash_password(secrets.token_urlsafe(32)),
        has_password=False,
        full_name=identity.name,
        email_verified=not settings.require_email_verification,
    )
    setattr(user, field, identity.sub)
    db.add(user)
    db.commit()
    db.refresh(user)
    _send_first_code(db, user)
    return _signed_in(response, user, new_account=True)


@router.post("/google", response_model=TokenResponse)
def sign_in_with_google(
    body: GoogleSignIn, response: Response, db: Session = Depends(get_db)
):
    try:
        identity = social_auth.verify_google(body.credential, body.nonce)
    except social_auth.SocialAuthError as error:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(error))
    return _social_sign_in(db, response, identity)


@router.post("/apple", response_model=TokenResponse)
def sign_in_with_apple(
    body: AppleSignIn, response: Response, db: Session = Depends(get_db)
):
    try:
        identity = social_auth.verify_apple(body.id_token, body.nonce, body.name)
    except social_auth.SocialAuthError as error:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(error))
    return _social_sign_in(db, response, identity)


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


@router.post("/delete-account/code")
def send_delete_code(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Email a code that confirms deleting this account."""
    try:
        check_rate_limit("delete-code", user.id, 6, window_seconds=60 * 60)
    except (RateLimitExceeded, RateLimitUnavailable):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="That's a lot of codes. Try again in a little while.",
        )
    try:
        wait = email_verification.send_code(db, user, force=True, purpose="delete")
    except email_verification.VerifyError as error:
        raise _verify_error(error)
    return {"sent": True, "email": user.email, "retry_after": wait}


@router.post("/delete-account")
def delete_my_account(
    body: DeleteAccountRequest,
    response: Response,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Permanently close the caller's account. Needs the current password,
    or a code from /delete-account/code for accounts without one."""
    if body.code:
        try:
            email_verification.check_action_code(db, user, body.code, "delete")
        except email_verification.VerifyError as error:
            raise _verify_error(error)
    elif not body.password or not verify_password(body.password, user.hashed_password):
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


@router.put("/me/phone", response_model=UserOut)
def set_phone(
    body: PhoneUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Add or change your mobile number, so friends can find you by it.

    Limited per hour: "already on another account" tells whether a number
    uses Cotab, and that shouldn't be something to check in bulk."""
    try:
        check_rate_limit("phone", user.id, 10, window_seconds=60 * 60)
    except (RateLimitExceeded, RateLimitUnavailable):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="That's a lot of tries. Try again in a little while.",
        )
    try:
        phone = normalize_us_phone(body.phone)
    except PhoneError as error:
        raise HTTPException(status_code=400, detail=str(error))
    if phone == user.phone:
        return user
    taken = HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="That number is already on another Cotab account. "
        "If it's yours, contact support.",
    )
    if db.query(User.id).filter(User.phone == phone, User.id != user.id).first():
        raise taken
    user.phone = phone
    user.phone_verified_at = None  # a new number hasn't been proved yet
    try:
        db.flush()
        # Tabs friends put this number (or email) on before they signed up.
        joined = invites.claim(db, user)
        db.commit()
    except IntegrityError:  # someone else saved it a moment ago
        db.rollback()
        raise taken
    notify.joined_cotab(db, joined)
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
