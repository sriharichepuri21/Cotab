"""Amounts as people read them: "$12.50", "€8.00", "CHF 3.00"."""

SYMBOLS = {"USD": "$", "EUR": "€", "GBP": "£", "INR": "₹", "JPY": "¥", "CAD": "CA$"}


def money(amount: float, currency: str | None = "USD") -> str:
    code = (currency or "USD").upper()
    symbol = SYMBOLS.get(code)
    return f"{symbol}{amount:,.2f}" if symbol else f"{code} {amount:,.2f}"
