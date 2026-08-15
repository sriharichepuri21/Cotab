import json
import re
from typing import Optional

import google.generativeai as genai
from pydantic import BaseModel, model_validator

from app.config.settings import get_settings

settings = get_settings()

if settings.gemini_api_key:
    genai.configure(api_key=settings.gemini_api_key)

CATEGORIES = [
    "groceries",
    "dining",
    "transport",
    "utilities",
    "rent",
    "entertainment",
    "health",
    "shopping",
    "travel",
    "other",
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
""" % ", ".join(
    CATEGORIES
)


class LineItem(BaseModel):
    description: str = ""
    quantity: float = 1
    unit_price: float = 0
    total_price: float = 0

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


# ---------------------------------------------------------------------------
# Function-calling chat — Phase 1 replacement for text-to-SQL
# ---------------------------------------------------------------------------
# The model never sees receipts schema, never writes SQL. It picks a tool and
# fills typed arguments; the actual query is pre-built in chat_tools.py.
#
# TODO(Phase 2): migrate to google-genai 2.x SDK. The shape of the tools list
# below uses the legacy 0.8.x API (genai.protos.FunctionDeclaration). The new
# SDK takes plain dicts — swap only this block when we migrate.
#
# Tool results come back as {"status": "ok|empty|error", "data"|"hint"}, and
# are passed back to the model via genai.protos.Part(function_response=...).

CHAT_SYSTEM_PROMPT = """You are the ReceiptWise assistant. You help users understand their receipts, budgets, and shared expenses.

STRICT RULES:
- NEVER write SQL. You don't have access to the database directly.
- To answer questions about the user's data, you MUST call one of the provided tools.
- If the user's question doesn't fit any tool, say so politely and suggest what you CAN help with
  (spend summaries, budget checks, listing receipts, finding receipts, splitting with friends, setting budgets).
- If a tool returns status="empty", relay the hint to the user in friendly language and suggest a next step.
- If a tool returns status="error", explain the hint and ask a clarifying question.
- Be concise. Cite specific numbers from tool data when possible.
- Treat bill, purchase, transaction and scan as receipt synonyms. Treat stuff/items/products as line items.
- Category aliases include coffee/eating out→dining, supermarket/food shopping→groceries, gas/rideshare→transport.
- The input may include trusted PAGE CONTEXT. Use its receipt_id/group_id when the user says this/it/here.
- Mutation tools NEVER execute immediately. If they return pending_confirmation, explain the proposal and wait.
- Today's date is known to you; for relative dates ("this month", "last week"), pick reasonable absolute dates.
"""

REFORMULATION_PROMPT = """Rewrite the user request into concise ReceiptWise vocabulary for tool selection.
Keep every amount, name, date, negation, and intent unchanged. Resolve synonyms: bill/purchase/scan=receipt;
stuff/products=items; coffee/eating out=dining; supermarket=groceries. Use supplied page context to resolve
'this', 'it', or 'here'. Return only the rewritten request, never an answer."""


def reformulate_question(message: str, context: Optional[dict] = None) -> str:
    """A separate constrained model pass; safely falls back to the original."""
    if not settings.gemini_api_key:
        return message
    try:
        model = genai.GenerativeModel(
            settings.gemini_model, system_instruction=REFORMULATION_PROMPT
        )
        prompt = f"PAGE CONTEXT: {json.dumps(context or {}, sort_keys=True)}\nUSER: {message}"
        rewritten = (model.generate_content(prompt).text or "").strip()
        return rewritten[:1000] or message
    except Exception:
        return message


def _chat_tool_declarations():
    """Build the legacy-SDK tool declaration. Kept in one place for SDK migration."""
    return [
        genai.protos.Tool(
            function_declarations=[
                genai.protos.FunctionDeclaration(
                    name="get_spend_summary",
                    description=(
                        "Get total spend, receipt count, and category breakdown "
                        "for a date range. Defaults to the last 30 days. Category is optional."
                    ),
                    parameters=genai.protos.Schema(
                        type=genai.protos.Type.OBJECT,
                        properties={
                            "start_date": genai.protos.Schema(
                                type=genai.protos.Type.STRING,
                                description="ISO date YYYY-MM-DD, inclusive. Optional.",
                            ),
                            "end_date": genai.protos.Schema(
                                type=genai.protos.Type.STRING,
                                description="ISO date YYYY-MM-DD, inclusive. Optional.",
                            ),
                            "category": genai.protos.Schema(
                                type=genai.protos.Type.STRING,
                                description="Optional. Category name (e.g. 'groceries', 'dining').",
                            ),
                        },
                        required=[],
                    ),
                ),
                genai.protos.FunctionDeclaration(
                    name="get_budget_status",
                    description=(
                        "Check spending vs the user's monthly budget for a category. "
                        "Requires the category name. Month is optional (defaults to current)."
                    ),
                    parameters=genai.protos.Schema(
                        type=genai.protos.Type.OBJECT,
                        properties={
                            "category": genai.protos.Schema(
                                type=genai.protos.Type.STRING,
                                description="Category name (e.g. 'groceries', 'dining').",
                            ),
                            "month": genai.protos.Schema(
                                type=genai.protos.Type.STRING,
                                description="Optional. 'YYYY-MM'. Defaults to current month.",
                            ),
                        },
                        required=["category"],
                    ),
                ),
                genai.protos.FunctionDeclaration(
                    name="list_receipts",
                    description=(
                        "List the user's most recent receipts (newest first). "
                        "Optional filters: merchant name substring, status "
                        "('uploaded'|'processing'|'extracted'|'reviewed'|'failed')."
                    ),
                    parameters=genai.protos.Schema(
                        type=genai.protos.Type.OBJECT,
                        properties={
                            "limit": genai.protos.Schema(
                                type=genai.protos.Type.INTEGER,
                                description="Max receipts to return (1-50, default 10).",
                            ),
                            "merchant": genai.protos.Schema(
                                type=genai.protos.Type.STRING,
                                description="Optional. Merchant name substring.",
                            ),
                            "status": genai.protos.Schema(
                                type=genai.protos.Type.STRING,
                                description="Optional. Receipt status filter.",
                            ),
                        },
                        required=[],
                    ),
                ),
                genai.protos.FunctionDeclaration(
                    name="find_receipts",
                    description=(
                        "Search receipts by merchant name or line-item description. "
                        "Use this for 'did I buy X?' or 'show my Trader Joe's trips'."
                    ),
                    parameters=genai.protos.Schema(
                        type=genai.protos.Type.OBJECT,
                        properties={
                            "search_text": genai.protos.Schema(
                                type=genai.protos.Type.STRING,
                                description="Search term (merchant or item).",
                            ),
                            "limit": genai.protos.Schema(
                                type=genai.protos.Type.INTEGER,
                                description="Max receipts to return (1-50, default 10).",
                            ),
                        },
                        required=["search_text"],
                    ),
                ),
                genai.protos.FunctionDeclaration(
                    name="create_split",
                    description=(
                        "Split a receipt evenly with named friends. Members don't need accounts. "
                        "Only 'even' splits are supported. Receipt must have been extracted."
                    ),
                    parameters=genai.protos.Schema(
                        type=genai.protos.Type.OBJECT,
                        properties={
                            "receipt_id": genai.protos.Schema(
                                type=genai.protos.Type.STRING,
                                description="Receipt UUID (from list_receipts or find_receipts).",
                            ),
                            "member_names": genai.protos.Schema(
                                type=genai.protos.Type.ARRAY,
                                items=genai.protos.Schema(
                                    type=genai.protos.Type.STRING
                                ),
                                description="Names of friends to split with (excluding the current user).",
                            ),
                            "style": genai.protos.Schema(
                                type=genai.protos.Type.STRING,
                                description="Optional. Only 'even' supported today.",
                            ),
                        },
                        required=["receipt_id", "member_names"],
                    ),
                ),
                genai.protos.FunctionDeclaration(
                    name="add_budget",
                    description=(
                        "Create or update the user's monthly budget for a category."
                    ),
                    parameters=genai.protos.Schema(
                        type=genai.protos.Type.OBJECT,
                        properties={
                            "category": genai.protos.Schema(
                                type=genai.protos.Type.STRING,
                                description="Category name.",
                            ),
                            "amount": genai.protos.Schema(
                                type=genai.protos.Type.NUMBER,
                                description="Monthly limit as a number.",
                            ),
                            "currency": genai.protos.Schema(
                                type=genai.protos.Type.STRING,
                                description="Optional ISO currency code, e.g. 'USD'.",
                            ),
                        },
                        required=["category", "amount"],
                    ),
                ),
            ]
        )
    ]


def start_chat_with_tools(history: Optional[list] = None):
    """Return a chat session bound to the tools. Caller drives the tool loop."""
    if not settings.gemini_api_key:
        raise RuntimeError("GEMINI_API_KEY not configured")
    model = genai.GenerativeModel(
        settings.gemini_model,
        system_instruction=CHAT_SYSTEM_PROMPT,
        tools=_chat_tool_declarations(),
    )
    return model.start_chat(history=history or [])
