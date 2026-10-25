"""Category normalization shared by every chat tool.

LLM tool-calls come in with free-form strings like "food", "groceries",
"Trader Joe's", "eating out". Every tool routes through _normalize_category
so we never miss a receipt because the user said "food" but we stored "dining".

Not LLM-driven — pure deterministic aliasing so it's testable and cheap.
"""

from typing import Optional

# The single source of truth for categories. The extraction prompt, the chat
# tools, budget validation and the frontend (via GET /api/v1/meta/categories)
# all read this. Order is the display order.
CATEGORY_META = (
    {
        "id": "groceries",
        "label": "Groceries",
        "icon": "shopping-basket",
        "color": "#2B8A57",
    },
    {"id": "dining", "label": "Dining", "icon": "utensils", "color": "#D9711C"},
    {"id": "drinks", "label": "Drinks", "icon": "coffee", "color": "#8C5A3C"},
    {"id": "bars", "label": "Bars & alcohol", "icon": "wine", "color": "#9B2F5B"},
    {"id": "transport", "label": "Transport", "icon": "car", "color": "#2F6FB5"},
    {"id": "utilities", "label": "Utilities", "icon": "zap", "color": "#B88A00"},
    {"id": "rent", "label": "Rent", "icon": "home", "color": "#4F4DB0"},
    {
        "id": "entertainment",
        "label": "Entertainment",
        "icon": "clapperboard",
        "color": "#C23B7A",
    },
    {"id": "health", "label": "Health", "icon": "heart-pulse", "color": "#C9372C"},
    {"id": "shopping", "label": "Shopping", "icon": "shopping-bag", "color": "#7A45C2"},
    {"id": "travel", "label": "Travel", "icon": "plane", "color": "#16808A"},
    {"id": "other", "label": "Other", "icon": "receipt", "color": "#5A6B64"},
)

CANONICAL_CATEGORIES = tuple(c["id"] for c in CATEGORY_META)

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
    "fast food": "dining",
    "barbecue": "dining",
    "bbq": "dining",
    "lunch": "dining",
    "dinner": "dining",
    "breakfast": "dining",
    "brunch": "dining",
    # drinks: coffee, tea, boba, juice (alcohol is bars)
    "drinks": "drinks",
    "drink": "drinks",
    "coffee": "drinks",
    "coffee shop": "drinks",
    "starbucks": "drinks",
    "dunkin": "drinks",
    "latte": "drinks",
    "espresso": "drinks",
    "matcha": "drinks",
    "boba": "drinks",
    "bubble tea": "drinks",
    "smoothie": "drinks",
    "smoothies": "drinks",
    "juice": "drinks",
    # bars & alcohol
    "bars": "bars",
    "bars & alcohol": "bars",
    "alcohol": "bars",
    "booze": "bars",
    "brewery": "bars",
    "beer": "bars",
    "wine": "bars",
    "cocktails": "bars",
    "cocktail": "bars",
    "liquor": "bars",
    "liquor store": "bars",
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


# Too short to look for inside other words ("tea" in "steakhouse", "pub" in
# "Publix"): these only count when they're the whole input.
_WHOLE_WORDS = {"tea": "drinks", "bar": "bars", "pub": "bars"}


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
    if s in _WHOLE_WORDS:
        return _WHOLE_WORDS[s]
    # Substring match — longest alias in input wins, so "whole foods market"
    # resolves to groceries, "uber" inside "uber eats" is disambiguated by
    # trying longer aliases first.
    for alias in sorted(_ALIASES.keys(), key=len, reverse=True):
        if alias in s:
            return _ALIASES[alias]
    return None
