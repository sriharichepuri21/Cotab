"""Sign in with Google and Sign in with Apple.

The browser gets a signed ID token straight from Google or Apple and sends it
here. We check it ourselves before trusting anything in it:

* the signature, against the provider's published keys (cached for an hour);
* the issuer, and that the audience is *our* client id, so a token minted for
  another app is useless here;
* expiry (with a minute of clock slack), and the nonce the page generated, so
  a captured token can't be replayed.

Only then do we read the account id (`sub`), the email and whether the
provider has verified that email.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Callable, Dict, Optional

import httpx
from jose import JWTError, jwt

from app.config.settings import get_settings

GOOGLE_KEYS = "https://www.googleapis.com/oauth2/v3/certs"
GOOGLE_ISSUERS = ("accounts.google.com", "https://accounts.google.com")
APPLE_KEYS = "https://appleid.apple.com/auth/keys"
APPLE_ISSUER = "https://appleid.apple.com"


class SocialAuthError(Exception):
    pass


@dataclass
class Identity:
    provider: str  # google | apple
    sub: str
    email: Optional[str]
    email_verified: bool
    name: str = ""


_cache: Dict[str, tuple[float, Dict[str, Any]]] = {}


def _fetch_keys(url: str) -> Dict[str, Any]:
    response = httpx.get(url, timeout=10)
    response.raise_for_status()
    return response.json()


# Swapped in tests for locally generated keys.
fetch_keys: Callable[[str], Dict[str, Any]] = _fetch_keys


def _keys(url: str, refresh: bool = False) -> Dict[str, Any]:
    hit = _cache.get(url)
    if hit and not refresh and time.time() - hit[0] < 3600:
        return hit[1]
    keys = fetch_keys(url)
    _cache[url] = (time.time(), keys)
    return keys


def _key_for(url: str, token: str) -> Dict[str, Any]:
    try:
        kid = jwt.get_unverified_header(token).get("kid")
    except JWTError as exc:
        raise SocialAuthError("That sign-in token isn't readable.") from exc
    for refresh in (False, True):  # providers rotate keys: retry once on a miss
        for key in _keys(url, refresh=refresh).get("keys", []):
            if key.get("kid") == kid:
                return key
    raise SocialAuthError("That sign-in token was signed with an unknown key.")


def _decode(
    token: str, url: str, audience: str, issuers: tuple[str, ...], nonce: Optional[str]
) -> Dict[str, Any]:
    key = _key_for(url, token)
    try:
        claims = jwt.decode(
            token,
            key,
            algorithms=[key.get("alg", "RS256")],
            audience=audience,
            options={"verify_iss": False, "verify_at_hash": False, "leeway": 60},
        )
    except JWTError as exc:
        raise SocialAuthError("That sign-in didn't check out. Try again.") from exc
    if claims.get("iss") not in issuers:
        raise SocialAuthError("That sign-in came from the wrong place.")
    if nonce is not None and claims.get("nonce") != nonce:
        raise SocialAuthError("That sign-in has expired. Try again.")
    if not claims.get("sub"):
        raise SocialAuthError("That sign-in had no account id.")
    return claims


def _truthy(value: Any) -> bool:
    return value is True or str(value).lower() == "true"


def verify_google(credential: str, nonce: Optional[str] = None) -> Identity:
    client_id = get_settings().google_client_id
    if not client_id:
        raise SocialAuthError("Sign in with Google isn't set up.")
    claims = _decode(credential, GOOGLE_KEYS, client_id, GOOGLE_ISSUERS, nonce)
    return Identity(
        provider="google",
        sub=str(claims["sub"]),
        email=(claims.get("email") or "").lower() or None,
        email_verified=_truthy(claims.get("email_verified")),
        name=claims.get("given_name") or claims.get("name") or "",
    )


def verify_apple(
    id_token: str, nonce: Optional[str] = None, name: str = ""
) -> Identity:
    client_id = get_settings().apple_client_id
    if not client_id:
        raise SocialAuthError("Sign in with Apple isn't set up.")
    claims = _decode(id_token, APPLE_KEYS, client_id, (APPLE_ISSUER,), nonce)
    # Apple sends the name only the very first time, from the browser, never
    # inside the token. The email may be a private relay address; it still
    # delivers, so the verification code reaches the person.
    return Identity(
        provider="apple",
        sub=str(claims["sub"]),
        email=(claims.get("email") or "").lower() or None,
        email_verified=_truthy(claims.get("email_verified")),
        name=name.strip()[:255],
    )
