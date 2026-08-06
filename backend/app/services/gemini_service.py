import json
import re
from typing import Any, Dict, Optional

import google.generativeai as genai
from pydantic import BaseModel

from app.config.settings import get_settings

settings = get_settings()

if settings.gemini_api_key:
    genai.configure(api_key=settings.gemini_api_key)

CATEGORIES = [
    "groceries", "dining", "transport", "utilities", "rent",
    "entertainment", "health", "shopping", "travel", "other",
]

EXTRACTION_PROMPT = """You are a receipt parsing engine. Extract data from this receipt image.
Return ONLY a JSON object (no prose) with this exact schema:
{
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
    {"description": "...", "quantity": 1, "unit_price": 0.00, "total_price": 0.00}
  ]
}
Rules: numbers must be numbers (not strings); unknown values null; confidence 0..1.
""" % ", ".join(CATEGORIES)

SQL_PROMPT = """You convert natural-language spending questions into a SINGLE read-only SELECT statement for this schema:

Table receipts(id, user_id, merchant, category, total, subtotal, tax, currency, purchased_at, status)
Table receipt_line_items(id, receipt_id, user_id, description, quantity, unit_price, total_price)
Table budgets(id, user_id, category, monthly_limit)

Strict rules:
- SELECT only. No other statement types.
- Only the three tables above.
- Output ONLY the SQL, no markdown fences, no commentary.
- Always reference only columns that exist above.
"""


class LineItem(BaseModel):
    description: str = ""
    quantity: float = 1
    unit_price: float = 0
    total_price: float = 0


class ReceiptExtraction(BaseModel):
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


def _strip_markdown(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(json|sql)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return text.strip()


def _model():
    return genai.GenerativeModel(settings.gemini_model)


def extract_receipt_from_image(image_bytes: bytes, mime: str) -> ReceiptExtraction:
    if not settings.gemini_api_key:
        raise RuntimeError("GEMINI_API_KEY not configured")
    resp = _model().generate_content(
        [
            EXTRACTION_PROMPT,
            {"mime_type": mime, "data": image_bytes},
        ]
    )
    data = json.loads(_strip_markdown(resp.text))
    if data.get("category") not in CATEGORIES:
        data["category"] = "other"
    return ReceiptExtraction(**data)


def generate_sql_from_question(question: str) -> str:
    if not settings.gemini_api_key:
        raise RuntimeError("GEMINI_API_KEY not configured")
    resp = _model().generate_content(f"{SQL_PROMPT}\nQuestion: {question}")
    return _strip_markdown(resp.text)


def generate_answer(question: str, rows: list[Dict[str, Any]]) -> str:
    """Second Gemini call. NOTE: never pass raw DB errors here (schema leaks)."""
    if not settings.gemini_api_key:
        raise RuntimeError("GEMINI_API_KEY not configured")
    prompt = (
        "You are a friendly personal-finance assistant. Answer the user's question "
        "using ONLY the data provided. Be concise, cite numbers.\n\n"
        f"Question: {question}\n\nData (JSON):\n{json.dumps(rows, default=str)[:4000]}"
    )
    resp = _model().generate_content(prompt)
    return resp.text.strip()
