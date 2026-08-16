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


SAFE_SQL_TOOL_DESCRIPTION = """Run a read-only analytical SELECT when the specialized tools cannot answer.
The server enforces ownership and a 500-row limit. Use explicit columns; SELECT * is forbidden.
Safe schema:
- receipts: id text, user_id text, merchant text, merchant_raw text, purchased_at timestamptz,
  total float, subtotal float, tax float, currency varchar(3), category text, status text,
  confidence float, extraction_method text, created_at/updated_at/deleted_at timestamptz.
- receipt_line_items: id text, receipt_id text, user_id text, description text, quantity float,
  unit_price float, total_price float, created_at/updated_at/deleted_at timestamptz.
- budgets: id text, user_id text, level text, target text, period text, amount float,
  alert_thresholds text, created_at/updated_at/deleted_at timestamptz.
- split_groups: id text, owner_id text, name text, timestamps.
- split_members: id text, group_id text, name text, user_id text nullable, timestamps.
- receipt_splits: id text, group_id text, receipt_id text, paid_by_member_id text,
  mode text, tax_mode text, timestamps.
- split_shares: id text, split_id text, member_id text, amount float, settled boolean, timestamps.
- split_item_assignments: id text, split_id text, line_item_id text, member_id text, timestamps.
Common joins:
receipt_line_items.receipt_id = receipts.id;
split_members.group_id = split_groups.id;
receipt_splits.group_id = split_groups.id;
receipt_splits.receipt_id = receipts.id;
split_shares.split_id = receipt_splits.id;
split_item_assignments.split_id = receipt_splits.id;
split_item_assignments.line_item_id = receipt_line_items.id.
Line items are normalized rows, not JSON/JSONB. Search descriptions with LOWER(description) LIKE '%term%'.
"""


def _schema_query_tool_declarations():
    return [
        genai.protos.FunctionDeclaration(
            name="execute_sql",
            description=SAFE_SQL_TOOL_DESCRIPTION,
            parameters=genai.protos.Schema(
                type=genai.protos.Type.OBJECT,
                properties={
                    "sql": genai.protos.Schema(
                        type=genai.protos.Type.STRING,
                        description="One PostgreSQL SELECT using only the documented safe schema.",
                    )
                },
                required=["sql"],
            ),
        ),
        genai.protos.FunctionDeclaration(
            name="line_items_search",
            description=(
                "Fast path to list normalized receipt line items whose description "
                "contains a phrase, with merchant, receipt, price, date, category, and currency."
            ),
            parameters=genai.protos.Schema(
                type=genai.protos.Type.OBJECT,
                properties={
                    "search_text": genai.protos.Schema(
                        type=genai.protos.Type.STRING,
                        description="Case-insensitive item-description substring, e.g. 'paneer'.",
                    ),
                    "limit": genai.protos.Schema(
                        type=genai.protos.Type.INTEGER,
                        description="Maximum matching line items (1-100, default 50).",
                    ),
                },
                required=["search_text"],
            ),
        ),
    ]


def _chat_tool_declarations(user_id: Optional[str] = None):
    """Build the legacy-SDK tool declaration. Kept in one place for SDK migration."""
    declarations = [
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
    ]
    # Keep the remaining legacy declarations in their existing wrapper, then
    # flatten all declarations into one Tool below.
    legacy = [
        genai.protos.Tool(
            function_declarations=[
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
    declarations.extend(legacy[0].function_declarations)
    if settings.execute_sql_is_enabled_for(user_id):
        declarations.extend(_schema_query_tool_declarations())
    return [genai.protos.Tool(function_declarations=declarations)]


def start_chat_with_tools(
    history: Optional[list] = None, user_id: Optional[str] = None
):
    """Return a chat session bound to the tools. Caller drives the tool loop."""
    if not settings.gemini_api_key:
        raise RuntimeError("GEMINI_API_KEY not configured")
    model = genai.GenerativeModel(
        settings.gemini_model,
        system_instruction=CHAT_SYSTEM_PROMPT,
        tools=_chat_tool_declarations(user_id=user_id),
    )
    return model.start_chat(history=history or [])
