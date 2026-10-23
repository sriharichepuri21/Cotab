"""Phone numbers: one stored shape for every way people type them.

"(415) 555-0123", "415.555.0123" and "+1 415 555 0123" are the same number,
so they're all stored as "+14155550123" (E.164) and compared in that shape.
Cotab is US-only for now, so only US numbers are accepted.
"""

from __future__ import annotations

import phonenumbers


class PhoneError(ValueError):
    pass


def normalize_us_phone(raw: str) -> str:
    """The number as "+1XXXXXXXXXX", or PhoneError saying what's wrong."""
    text = (raw or "").strip()
    if not text:
        raise PhoneError("Add your mobile number.")
    try:
        number = phonenumbers.parse(text, "US")
    except phonenumbers.NumberParseException:
        raise PhoneError("That doesn't look like a phone number.")
    if not phonenumbers.is_valid_number(number):
        raise PhoneError("That doesn't look like a real US number. Check the digits.")
    if phonenumbers.region_code_for_number(number) != "US":
        raise PhoneError("Cotab only works with US numbers for now.")
    return phonenumbers.format_number(number, phonenumbers.PhoneNumberFormat.E164)


def pretty(e164: str | None) -> str:
    """ "+14155550123" as "(415) 555-0123", for showing to people."""
    if not e164:
        return ""
    number = phonenumbers.parse(e164, "US")
    return phonenumbers.format_number(number, phonenumbers.PhoneNumberFormat.NATIONAL)
