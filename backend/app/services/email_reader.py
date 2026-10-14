"""Reading a forwarded receipt email with plain code.

Turns the email into readable text, finds the store that originally sent it
(not the person who forwarded it), and pulls out the total and date from
the labels stores use ("Order total", "Grand total", "Amount charged"...).

The AI reads the items afterwards; this code is what keeps a receipt's store,
total and date right even when the AI is unavailable, and lets Cotab tell a
real order email from a newsletter.
"""

from __future__ import annotations

import html as html_lib
import re
from dataclasses import dataclass
from datetime import date, datetime
from email.utils import parseaddr, parsedate_to_datetime
from typing import Optional

from app.services.capture_service import parse_amount

# --- email -> text ---------------------------------------------------------------

_BLOCK_END = re.compile(r"</(p|div|tr|li|h[1-6]|table|section|article)\s*>", re.I)
_BREAK = re.compile(r"<br\s*/?>", re.I)
_CELL_END = re.compile(r"</t[dh]\s*>", re.I)
_DROP = re.compile(r"<(script|style|head|title)[^>]*>.*?</\1\s*>", re.I | re.S)
_TAG = re.compile(r"<[^>]+>")


def html_to_text(html: str) -> str:
    """Readable text from an email's HTML, one visual line per line."""
    text = _DROP.sub(" ", html or "")
    text = _BREAK.sub("\n", text)
    text = _BLOCK_END.sub("\n", text)
    text = _CELL_END.sub("  ", text)
    text = _TAG.sub(" ", text)
    text = html_lib.unescape(text).replace("\xa0", " ")
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.splitlines()]
    out, blank = [], 0
    for line in lines:
        blank = blank + 1 if not line else 0
        if blank <= 1:
            out.append(line)
    return "\n".join(out).strip()


def email_text(message: dict) -> str:
    """The best text version of a fetched email."""
    text = (message.get("text") or "").strip()
    html = message.get("html") or ""
    from_html = html_to_text(html) if html else ""
    # Many order emails are HTML-only or have a stub text part.
    return from_html if len(from_html) > len(text) * 1.2 else text or from_html


# --- who the receipt is really from -------------------------------------------------

_FORWARD_FROM = re.compile(
    r"(?:-{2,}\s*Forwarded message\s*-{2,}|Begin forwarded message:|"
    r"Original Message|^_{5,})"
    r"[\s\S]{0,400}?^\s*\*?From:\*?\s*(?P<from>.+)$",
    re.I | re.M,
)
_FORWARD_DATE = re.compile(
    r"(?:Forwarded message|Begin forwarded message|Original Message)[\s\S]{0,600}?"
    r"^\s*\*?(?:Date|Sent):\*?\s*(?P<date>.+)$",
    re.I | re.M,
)
_NOISE_NAMES = re.compile(
    r"\b(no[-_. ]?reply|do[-_. ]?not[-_. ]?reply|orders?|receipts?|order confirmation|"
    r"notifications?|customer service|support|team|store|online|shop)\b",
    re.I,
)


def original_sender(text: str, fallback_from: str = "") -> tuple[str, str]:
    """(display name, address) of whoever sent the receipt before it was forwarded."""
    m = _FORWARD_FROM.search(text or "")
    if not m:
        # Not wrapped as a forward (some apps paste the original headers in).
        m = re.search(
            r"^\s*\*?From:\*?\s*(?P<from>.+)$", (text or "")[:2000], re.I | re.M
        )
    raw = m.group("from").strip() if m else fallback_from
    if m and "@" not in raw:
        # HTML emails can put the address on the next line: "Amazon.com\n<x@y>".
        after = (text or "")[m.end() : m.end() + 200].lstrip("\n").split("\n", 1)[0]
        if after.strip().startswith("<") and "@" in after:
            raw = f"{raw} {after.strip()}"
    name, address = parseaddr(raw)
    if "@" not in address:
        name, address = (name or raw), ""
    return name.strip().strip('"'), address.strip().lower()


_DOMAIN_NOISE = {
    "com",
    "net",
    "org",
    "co",
    "uk",
    "in",
    "ca",
    "mail",
    "email",
    "e",
    "m",
    "info",
    "orders",
    "shop",
    "em",
    "messaging",
    "notifications",
}


def store_name(name: str, address: str) -> str:
    """'Amazon.com' / 'auto-confirm@amazon.com' -> 'Amazon'."""
    # "Blue Bottle Coffee via Square" is from Blue Bottle Coffee.
    name = re.sub(r"\s+via\s+.+$", "", name or "", flags=re.I)
    cleaned = _NOISE_NAMES.sub("", name).strip(" -|:,.")
    cleaned = re.sub(r"\.(com|net|org|co\.uk|in|ca)$", "", cleaned, flags=re.I).strip()
    if len(cleaned) >= 2:
        return cleaned[:255]
    domain = (address.split("@")[-1] if "@" in address else "").lower()
    parts = [p for p in domain.split(".") if p and p not in _DOMAIN_NOISE]
    return (parts[-1].replace("-", " ").title() if parts else "Email receipt")[:255]


# --- totals and dates ---------------------------------------------------------------

# A currency code only counts on the same line and in capitals ("USD 12.00",
# "12,00 EUR"), so the next line's first word can't be read as one.
_MONEY = (
    r"(?P<amount>(?:(?-i:[A-Z]{3})[ ]?)?[$€£₹¥]?[ ]?-?\d[\d.,]*"
    r"(?:[ ]?(?-i:[A-Z]{3})\b)?(?:[ ]?[$€£₹])?)"
)
# Ordered: the most specific labels first. "Total" alone is last and weakest.
_TOTAL_LABELS = [
    r"grand\s+total",
    r"order\s+total",
    r"total\s+charged",
    r"amount\s+charged",
    r"total\s+paid",
    r"amount\s+paid",
    r"you\s+paid",
    r"payment\s+total",
    r"total\s+amount",
    r"total\s+\(incl\.?[^)]*\)",
    r"total",
]
_STRONG = 9  # the first nine labels are specific enough to trust on their own


@dataclass
class CodeReading:
    merchant: str
    total: Optional[float]
    currency: Optional[str]
    when: Optional[date]
    strong_total: bool


def find_total(text: str) -> tuple[Optional[float], Optional[str], bool]:
    """The receipt total, its currency, and whether the label was specific."""
    for i, label in enumerate(_TOTAL_LABELS):
        pattern = re.compile(
            rf"(?:^|\b){label}\b[^\n\d$€£₹¥A-Z]{{0,24}}{_MONEY}", re.I | re.M
        )
        hits = [m for m in pattern.finditer(text or "")]
        # Skip "Total before tax" and similar sub-totals.
        hits = [
            h
            for h in hits
            if not re.search(r"before|excl|savings|items?\s*:", h.group(0), re.I)
        ]
        if not hits:
            continue
        # The last "Grand total" in a thread is the real one (earlier ones are
        # often quoted summaries); for a bare "Total", the largest wins.
        candidates = []
        for h in hits:
            amount, currency = parse_amount(h.group("amount"))
            if amount and amount > 0:
                candidates.append((amount, currency))
        if not candidates:
            continue
        amount, currency = max(candidates) if label == r"total" else candidates[-1]
        return amount, currency, i < _STRONG
    return None, None, False


_DATE_PATTERNS = [
    (re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b"), "%Y-%m-%d"),
    (re.compile(r"\b([A-Z][a-z]{2,8}\.? \d{1,2},? \d{4})\b"), None),
    (re.compile(r"\b(\d{1,2} [A-Z][a-z]{2,8}\.? \d{4})\b"), None),
    (re.compile(r"\b(\d{1,2}/\d{1,2}/\d{4})\b"), "%m/%d/%Y"),
]
_DATE_FORMATS = [
    "%B %d, %Y",
    "%b %d, %Y",
    "%B %d %Y",
    "%b %d %Y",
    "%d %B %Y",
    "%d %b %Y",
]


def _parse_date_text(s: str) -> Optional[date]:
    s = s.replace(".", "").strip()
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def find_date(text: str) -> Optional[date]:
    """The order date: the forwarded email's Date line, else the first date in it."""
    m = _FORWARD_DATE.search(text or "")
    if m:
        raw = m.group("date").strip()
        try:
            return parsedate_to_datetime(raw).date()
        except (TypeError, ValueError, IndexError):
            parsed = _parse_date_text(re.sub(r"\s+at\s+.*$", "", raw))
            if parsed:
                return parsed
            for rx, fmt in _DATE_PATTERNS:
                hit = rx.search(raw)
                if hit:
                    got = _try(hit, fmt)
                    if got:
                        return got
    for rx, fmt in _DATE_PATTERNS:
        for hit in rx.finditer(text or ""):
            got = _try(hit, fmt)
            if got and 2000 <= got.year <= 2100:
                return got
    return None


def _try(hit: re.Match, fmt: Optional[str]) -> Optional[date]:
    if fmt == "%Y-%m-%d":
        try:
            return date(int(hit.group(1)), int(hit.group(2)), int(hit.group(3)))
        except ValueError:
            return None
    if fmt:
        try:
            return datetime.strptime(hit.group(1), fmt).date()
        except ValueError:
            return None
    return _parse_date_text(hit.group(1))


def read(text: str, from_raw: str = "") -> CodeReading:
    name, address = original_sender(text, from_raw)
    total, currency, strong = find_total(text)
    return CodeReading(
        merchant=store_name(name, address),
        total=total,
        currency=currency,
        when=find_date(text),
        strong_total=strong,
    )
