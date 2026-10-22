"""Payment handles (Venmo, PayPal, Cash App, Zelle) and one-tap pay links.

Cotab never moves money. It stores where a person can be paid and builds a
link that opens their payment app with the amount filled in.
"""

import json
import re
from typing import Dict, List, Optional
from urllib.parse import quote, urlencode

METHODS = ("venmo", "paypal", "cashapp", "zelle")

_RULES = {
    # Venmo usernames: letters, digits, - and _, 5 to 30 long.
    "venmo": re.compile(r"^[A-Za-z0-9_-]{5,30}$"),
    # paypal.me names: letters and digits, up to 20.
    "paypal": re.compile(r"^[A-Za-z0-9]{1,20}$"),
    # $Cashtags: a letter first, up to 20 characters.
    "cashapp": re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,19}$"),
}
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_PHONE = re.compile(r"^\+?[0-9 ().-]{7,20}$")


class HandleError(ValueError):
    pass


def clean_handles(raw: Optional[Dict[str, Optional[str]]]) -> Dict[str, str]:
    """Normalise user input: strip @ and $, drop blanks, reject bad values."""
    out: Dict[str, str] = {}
    for method in METHODS:
        value = ((raw or {}).get(method) or "").strip()
        if not value:
            continue
        if method == "venmo":
            value = value.lstrip("@")
        elif method == "cashapp":
            value = value.lstrip("$")
        elif method == "paypal":
            value = re.sub(r"^(https?://)?(www\.)?paypal\.me/", "", value).strip("/")
        if method == "zelle":
            if not (_EMAIL.match(value) or _PHONE.match(value)):
                raise HandleError(
                    "Zelle needs the email or phone number you use with Zelle"
                )
        elif not _RULES[method].match(value):
            names = {
                "venmo": "Venmo username",
                "paypal": "PayPal.me name",
                "cashapp": "$Cashtag",
            }
            raise HandleError(f"That {names[method]} doesn't look right")
        out[method] = value
    return out


def load(text: Optional[str]) -> Dict[str, str]:
    if not text:
        return {}
    try:
        data = json.loads(text)
    except ValueError:
        return {}
    return {k: v for k, v in data.items() if k in METHODS and isinstance(v, str) and v}


def dump(handles: Dict[str, str]) -> Optional[str]:
    return json.dumps(handles, sort_keys=True) if handles else None


def links(
    handles: Dict[str, str], amount: float, note: str, currency: str = "USD"
) -> List[Dict]:
    """One entry per method the payee accepts; Zelle has no link, only a value to copy."""
    value = f"{amount:.2f}"
    out: List[Dict] = []
    if handles.get("venmo") and currency == "USD":
        query = urlencode({"txn": "pay", "amount": value, "note": note})
        out.append(
            {
                "method": "venmo",
                "label": "Venmo",
                "url": f"https://venmo.com/{quote(handles['venmo'])}?{query}",
            }
        )
    if handles.get("paypal"):
        out.append(
            {
                "method": "paypal",
                "label": "PayPal",
                "url": f"https://paypal.me/{quote(handles['paypal'])}/{value}{currency}",
            }
        )
    if handles.get("cashapp") and currency == "USD":
        out.append(
            {
                "method": "cashapp",
                "label": "Cash App",
                "url": f"https://cash.app/${quote(handles['cashapp'])}/{value}",
            }
        )
    if handles.get("zelle"):
        out.append(
            {"method": "zelle", "label": "Zelle", "url": None, "copy": handles["zelle"]}
        )
    return out
