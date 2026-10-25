"""Which receipt lines are charges on the order rather than things bought.

Delivery and service fees, tips, tax and discounts are their own lines on app
orders (Uber Eats, DoorDash, Amazon). They aren't products: nobody "had" the
delivery fee, so a split shares them like tax, and they never build a price
history or count toward an item budget.
"""

import re

_CHARGE = re.compile(
    r"\b(fees?|tip|gratuity|tax(es)?|discounts?|promo(tion)?s?|coupons?|"
    r"savings?|credits?|surcharges?)\b",
    re.IGNORECASE,
)


def is_charge(description: str, total_price: float = 0.0) -> bool:
    """A fee, tip, tax or discount line (any negative line is a discount)."""
    return (total_price or 0.0) < 0 or bool(_CHARGE.search(description or ""))
