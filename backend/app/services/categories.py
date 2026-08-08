"""Category normalization shared by every chat tool.

LLM tool-calls come in with free-form strings like "food", "groceries",
"Trader Joe's", "eating out". Every tool routes through _normalize_category
so we never miss a receipt because the user said "food" but we stored "dining".

Not LLM-driven — pure deterministic aliasing so it's testable and cheap.
"""

from typing import Optional

# Canonical categories — mirrors gemini_service.CATEGORIES. Keep in sync.
CANONICAL_CATEGORIES = (
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
)

# Map of lowercase alias → canonical category. Longest match wins.
_ALIASES = {
    # groceries
    "groceries": "groceries",
    "grocery": "groceries",
    "supermarket": "groceries",
    "trader joe": "groceries",
    "trader joes": "groceries",
    "whole foods": "groceries",
    "safeway": "groceries",
    "kroger": "groceries",
    "costco": "groceries",
    "aldi": "groceries",
    "food shopping": "groceries",
    # dining
    "dining": "dining",
    "restaurant": "dining",
    "restaurants": "dining",
    "food": "dining",
    "eating out": "dining",
    "takeout": "dining",
    "take out": "dining",
    "delivery": "dining",
    "doordash": "dining",
    "ubereats": "dining",
    "uber eats": "dining",
    "grubhub": "dining",
    "coffee": "dining",
    "starbucks": "dining",
    "fast food": "dining",
    "lunch": "dining",
    "dinner": "dining",
    "breakfast": "dining",
    "brunch": "dining",
    "bar": "dining",
    "drinks": "dining",
    # transport
    "transport": "transport",
    "transportation": "transport",
    "gas": "transport",
    "fuel": "transport",
    "petrol": "transport",
    "uber": "transport",
    "lyft": "transport",
    "taxi": "transport",
    "rideshare": "transport",
    "parking": "transport",
    "tolls": "transport",
    "toll": "transport",
    "transit": "transport",
    "subway": "transport",
    "metro": "transport",
    "train": "transport",
    "bus": "transport",
    # utilities
    "utilities": "utilities",
    "utility": "utilities",
    "electric": "utilities",
    "electricity": "utilities",
    "water bill": "utilities",
    "internet": "utilities",
    "wifi": "utilities",
    "phone bill": "utilities",
    "phone": "utilities",
    "cable": "utilities",
    # rent
    "rent": "rent",
    "rent payment": "rent",
    "landlord": "rent",
    "lease": "rent",
    # entertainment
    "entertainment": "entertainment",
    "movies": "entertainment",
    "movie": "entertainment",
    "netflix": "entertainment",
    "spotify": "entertainment",
    "hulu": "entertainment",
    "disney": "entertainment",
    "streaming": "entertainment",
    "concert": "entertainment",
    "concerts": "entertainment",
    "games": "entertainment",
    "gaming": "entertainment",
    "video games": "entertainment",
    "steam": "entertainment",
    # health
    "health": "health",
    "pharmacy": "health",
    "cvs": "health",
    "walgreens": "health",
    "doctor": "health",
    "dentist": "health",
    "medical": "health",
    "hospital": "health",
    "gym": "health",
    "fitness": "health",
    # shopping
    "shopping": "shopping",
    "amazon": "shopping",
    "target": "shopping",
    "walmart": "shopping",
    "clothes": "shopping",
    "clothing": "shopping",
    "apparel": "shopping",
    "electronics": "shopping",
    # travel
    "travel": "travel",
    "flight": "travel",
    "flights": "travel",
    "airline": "travel",
    "hotel": "travel",
    "hotels": "travel",
    "airbnb": "travel",
    "vacation": "travel",
    "trip": "travel",
    # other / uncategorized
    "other": "other",
    "misc": "other",
    "miscellaneous": "other",
    "uncategorized": "other",
}


def _normalize_category(user_input: Optional[str]) -> Optional[str]:
    """Map user free-text to a canonical category, else None.

    Used by EVERY chat tool that takes a category arg — never trust the LLM
    to guess the canonical form on its own. Returns None if no match so the
    caller can decide whether to error or treat as "no filter".
    """
    if not user_input:
        return None
    s = user_input.strip().lower()
    if not s:
        return None
    # Direct canonical hit first (most common case)
    if s in CANONICAL_CATEGORIES:
        return s
    # Exact alias hit
    if s in _ALIASES:
        return _ALIASES[s]
    # Substring match — longest alias in input wins, so "whole foods market"
    # resolves to groceries, "uber" inside "uber eats" is disambiguated by
    # trying longer aliases first.
    for alias in sorted(_ALIASES.keys(), key=len, reverse=True):
        if alias in s:
            return _ALIASES[alias]
    return None
