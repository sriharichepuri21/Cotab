from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, EmailStr, Field

# Onboarding intents. Literal so FastAPI rejects anything else with a 422
# rather than persisting a junk value.
Intent = Literal["personal", "splits", "business"]

# Ben.Carter@gmail.com and ben.carter@gmail.com are one mailbox: one account.
Email = Annotated[EmailStr, AfterValidator(str.lower)]


class RegisterRequest(BaseModel):
    email: Email
    password: str = Field(min_length=6, max_length=128)
    full_name: str = ""


class ForgotPasswordRequest(BaseModel):
    email: Email


class ResetPasswordRequest(BaseModel):
    email: Email
    code: str = Field(min_length=6, max_length=12)
    new_password: str = Field(min_length=6, max_length=128)


class IntentRequest(BaseModel):
    intent: Intent


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    # False until the emailed code is entered; the app shows the code screen.
    email_verified: bool = True
    new_account: bool = False


class VerifyEmailRequest(BaseModel):
    code: str = Field(min_length=1, max_length=12)


class GoogleSignIn(BaseModel):
    credential: str = Field(min_length=20, max_length=8192)
    nonce: str | None = Field(default=None, max_length=128)


class AppleSignIn(BaseModel):
    id_token: str = Field(min_length=20, max_length=8192)
    nonce: str | None = Field(default=None, max_length=128)
    # Apple gives the name to the browser only on the very first sign-in.
    name: str = Field(default="", max_length=255)


class DeleteAccountRequest(BaseModel):
    # Re-entering the password (or, for Google / Apple accounts, a code from
    # email) stops a stolen session token, or a click from someone else at an
    # unlocked screen, from erasing the account.
    password: str | None = None
    code: str | None = Field(default=None, max_length=12)


class PhoneUpdate(BaseModel):
    # Any way people type a US number; the server tidies it (app/utils/phone.py).
    phone: str = Field(min_length=1, max_length=32)


class UserOut(BaseModel):
    id: str
    email: str
    # "+14155550123", or None until they add it (the app then asks for it).
    phone: str | None = None
    full_name: str
    timezone: str
    telegram_chat_id: str | None = None
    intent: str | None = None
    email_verified: bool = True
    has_password: bool = True
    avatar_look: str | None = None
    avatar_mood: str | None = None
    avatar_bg: str | None = None
    tabby_reacts: bool | None = None

    class Config:
        from_attributes = True


AvatarLook = Literal["hoodie", "headphones", "beanie"]
AvatarMood = Literal[
    "hi",
    "cool",
    "hmm",
    "over-budget",
    "payday",
    "need-money",
    "out-of-cash",
    "bill-shock",
    "love",
    "salute",
    "working",
    "done",
    "oops",
    "remember",
    "autopilot",
    "morning",
    "celebrate",
    "thinking",
]


class ProfileUpdate(BaseModel):
    """Only the fields sent are changed."""

    full_name: str | None = Field(default=None, max_length=255)
    avatar_look: AvatarLook | None = None
    avatar_mood: AvatarMood | None = None
    avatar_bg: Literal["mood", "sage"] | None = None
    tabby_reacts: bool | None = None
