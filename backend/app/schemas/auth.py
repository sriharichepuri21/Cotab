from typing import Literal

from pydantic import BaseModel, EmailStr

# Onboarding intents. Literal so FastAPI rejects anything else with a 422
# rather than persisting a junk value.
Intent = Literal["personal", "splits", "business"]


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    full_name: str = ""


class IntentRequest(BaseModel):
    intent: Intent


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    id: str
    email: str
    full_name: str
    timezone: str
    telegram_chat_id: str | None = None
    intent: str | None = None

    class Config:
        from_attributes = True
