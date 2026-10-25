import json
import logging
import re
from typing import Optional

from google.genai import types
from pydantic import BaseModel, model_validator

from app.config.settings import get_settings
from app.services import ai_client, ai_usage
from app.services.categories import CANONICAL_CATEGORIES

settings = get_settings()
logger = logging.getLogger(__name__)

# Defined once in categories.py; kept under this name for existing callers.
CATEGORIES = list(CANONICAL_CATEGORIES)

EXTRACTION_PROMPT = """You are a receipt parsing engine. First decide whether the image (or PDF) is a
purchase receipt at all, then extract it.

A receipt is any proof of purchase that lists what was bought or paid: a till receipt, a restaurant
bill, an invoice, a fuel or parking receipt, an order confirmation or e-receipt. That includes a
screenshot of an app or website showing an order that was placed or delivered (Amazon, Uber Eats,
DoorDash, Instacart, Target, Walmart and the like): read it like any receipt.
NOT receipts: a cart or checkout that wasn't placed yet, money sent to or requested from a person
(Venmo, Zelle, Cash App, PayPal friends: that is paying someone back, not buying something), bank
statements and card activity lists, menus, price tags, shopping lists, people, pets, food, rooms
and documents that show no purchase.

Return ONLY a JSON object (no prose) with this exact schema:
{
  "is_receipt": true,
  "screenshot": false,
  "readability": "good | partial | unreadable",
  "problem": "null, or one of: not_a_receipt, blurry, too_dark, glare, cut_off, too_far",
  "merchant": "normalized merchant name",
  "merchant_raw": "merchant name exactly as printed",
  "date": "YYYY-MM-DD or null",
  "total": 0.00,
  "subtotal": 0.00,
  "tax": 0.00,
  "currency": "USD",
  "category": "one of: %s",
  "confidence": 0.0,
  "line_items": [
    {"description": "...", "quantity": 1, "unit_price": 0.00, "total_price": 0.00,
     "item_code": "null or the product number printed on this line",
     "item_name": "plain name of the product",
     "size": "null or the pack size / weight printed on this line"}
  ]
}
Rules:
- If it is not a receipt: is_receipt false, problem "not_a_receipt", and leave every other field null.
- readability "unreadable" means you cannot reliably read the total; say why in "problem".
  "partial" means the total is readable but some lines are not. Never guess a total you cannot see.
- screenshot: true when the image is a screenshot of a phone or computer screen (an app or web
  page), false for a photo of paper or a PDF.
- date: only a date you can read in full. If it shows no year ("Oct 22"), only "Today" or
  "Yesterday", or no date at all, return null. Never guess a year.
- category: coffee shops, tea, matcha, boba, juice and smoothie places are drinks; bars, pubs,
  breweries and liquor or wine stores are bars; a restaurant meal that includes a drink is
  still dining. Food delivery (Uber Eats, DoorDash, Grubhub, Postmates) is dining; Instacart is
  groceries; Amazon, Target and Walmart orders are shopping unless they're clearly groceries.
- total is what was charged in the end: after discounts and promos, including delivery and
  service fees, bag fees and the tip. Fees and the tip are their own line_items ("Delivery fee",
  "Service fee", "Tip"); discounts, promos and credits are their own entries with a negative
  total_price.
- numbers must be numbers (not strings); unknown values null; confidence 0..1.
- line_items: one entry per printed line, in order, even when the same item repeats. Copy
  "description" exactly as printed, without the product number. Discount and coupon lines are
  their own entries with a negative total_price.
- item_code: the barcode or store item number printed on that line (e.g. Walmart's 12-digit
  number, Costco's item number), digits only. For a discount line, the number of the item it
  applies to. null when the line has none.
- item_name: a short readable name, expanding store abbreviations only when you are sure
  ("KSWTR40PK" -> "Kirkland water, 40 pack"; "ORG ATAULFO" -> "Organic Ataulfo mangoes").
  If unsure, repeat the printed text.
- size: only a size or count that is printed on the line ("40 ct", "18 ct", "2 lb", "32 oz").
  Never guess a size that is not printed.
- Never copy membership numbers, card numbers, phone numbers or names of people into any field.
""" % ", ".join(
    CATEGORIES
)


class LineItem(BaseModel):
    description: str = ""
    quantity: float = 1
    unit_price: float = 0
    total_price: float = 0
    # Price memory: the printed product number, a readable name and a printed size.
    item_code: Optional[str] = None
    item_name: Optional[str] = None
    size: Optional[str] = None

    @model_validator(mode="before")
    @classmethod
    def _drop_nulls(cls, data):
        # Same null handling as the parent: an item with no unit price shouldn't
        # take the whole receipt down.
        if isinstance(data, dict):
            return {k: v for k, v in data.items() if v is not None}
        return data


class ReceiptExtraction(BaseModel):
    """Parsed receipt fields.

    The extraction prompt tells the model to use null for unknown values, and it
    does — a receipt with no visible tax line comes back `"tax": null`. Without
    the validator below that null fails float validation and the ENTIRE receipt
    is marked failed, which is how a perfectly readable receipt with no tax line
    ended up as a total loss. Nulls fall back to the field default instead.
    """

    merchant: str = "Unknown"
    merchant_raw: str = ""
    date: Optional[str] = None
    total: float = 0
    subtotal: float = 0
    tax: float = 0
    currency: str = "USD"
    category: str = "other"
    confidence: float = 0
    line_items: list[LineItem] = []
    # Which extractor produced this: "ocr" (Phase 2 rules) or "gemini" (LLM).
    extraction_method: str = "gemini"
    # The model's verdict on the image itself, checked before anything is saved.
    is_receipt: bool = True
    # A screenshot of an app or web page (an order confirmation), not paper.
    screenshot: bool = False
    readability: str = "good"  # good | partial | unreadable
    problem: Optional[str] = None

    @model_validator(mode="before")
    @classmethod
    def _drop_nulls(cls, data):
        """Remove null keys so the field defaults apply.

        `date` keeps its None: it is Optional, and None there is a real answer
        ("no date printed") rather than a missing value.
        """
        if isinstance(data, dict):
            return {k: v for k, v in data.items() if v is not None or k == "date"}
        return data


def _strip_markdown(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(json|sql)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return text.strip()


# Ask for bare JSON: no markdown fences, fewer output tokens to pay for.
_JSON_OUTPUT = types.GenerateContentConfig(response_mime_type="application/json")

# Photo problems a stronger model can't fix: a second read would only cost more.
_UNFIXABLE = {"not_a_receipt", "blurry", "too_dark", "glare", "cut_off", "too_far"}


def _read(
    contents: list, feature: str, model: Optional[str] = None
) -> ReceiptExtraction:
    """One extraction call, within the AI budget and logged."""
    name = model or settings.gemini_model
    resp = ai_usage.guarded(
        feature, name, lambda: ai_client.generate(name, contents, _JSON_OUTPUT)
    )
    data = json.loads(_strip_markdown(resp.text or ""))
    if data.get("category") not in CATEGORIES:
        data["category"] = "other"
    return ReceiptExtraction(**data)


def needs_second_look(first: ReceiptExtraction) -> bool:
    """The everyday model read a receipt but wasn't sure of it.

    A stronger model is worth paying for here: faded thermal paper, long
    receipts, crumpled ones. Not for photos that are simply unusable, and not
    for things that aren't receipts.
    """
    problem = (first.problem or "").strip().lower()
    if not first.is_receipt or problem in _UNFIXABLE:
        return False
    return first.readability != "good" or (first.confidence or 0) < 0.6


def extract_receipt_from_text(text: str) -> ReceiptExtraction:
    """Read a receipt from an email's text. Text costs far less than an image."""
    if not settings.gemini_api_key:
        raise RuntimeError("GEMINI_API_KEY not configured")
    return _read(
        [
            EXTRACTION_PROMPT,
            "The receipt is this email (forwarded by the customer). Ignore the "
            "forwarding header, signatures, ads and links:\n\n" + text[:40000],
        ],
        "email",
    )


def extract_receipt_from_image(image_bytes: bytes, mime: str) -> ReceiptExtraction:
    """Read a receipt photo or PDF with the everyday model, and give it to the
    stronger model only if the first read was unsure."""
    if not settings.gemini_api_key:
        raise RuntimeError("GEMINI_API_KEY not configured")
    contents = [
        EXTRACTION_PROMPT,
        types.Part.from_bytes(data=image_bytes, mime_type=mime),
    ]
    first = _read(contents, "scan")
    upgrade = settings.gemini_upgrade_model
    if not upgrade or upgrade == settings.gemini_model or not needs_second_look(first):
        return first
    try:
        second = _read(contents, "scan", model=upgrade)
    except ai_usage.AILimitReached:
        return first  # out of budget for a second look; the first read stands
    except Exception:
        logger.exception("Second read with %s failed; keeping the first", upgrade)
        return first
    # Keep whichever read is more sure of itself. A second read that calls
    # the receipt "not a receipt" doesn't overrule a first one that read it.
    rank = {"good": 2, "partial": 1, "unreadable": 0}
    if second.is_receipt and (
        rank.get(second.readability, 0),
        second.confidence or 0,
    ) >= (
        rank.get(first.readability, 0),
        first.confidence or 0,
    ):
        return second
    return first
