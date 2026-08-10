"""Merchant rule packs for top US grocers (Phase 2).

Each pack knows one merchant's printed-layout fingerprint and, on match, anchors
the merchant name and category with near-certain confidence and tightens the
TOTAL detection to that merchant's phrasing. Packs compose on top of the generic
rule engine rather than replacing it — the generic engine still extracts date,
subtotal, tax, and line items.

Detection is a cheap text fingerprint; a pack only activates when its marker is
present, so an unknown merchant just falls through to the generic engine.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List, Optional

from app.services.ocr_rules import (
    _PRICE_RE,
    OcrLine,
    RuleExtraction,
    extract_with_rules,
    num_from,
)


@dataclass
class MerchantPack:
    name: str  # canonical merchant display name
    category: str  # default category for this merchant
    detect: re.Pattern  # fingerprint matched against the OCR text blob
    total_re: re.Pattern  # merchant's TOTAL-line phrasing


PACKS: List[MerchantPack] = [
    MerchantPack(
        name="Costco",
        category="groceries",
        detect=re.compile(r"\bCOSTCO\b", re.I),
        total_re=re.compile(r"\bTOTAL\b", re.I),
    ),
    MerchantPack(
        name="Walmart",
        category="groceries",
        detect=re.compile(r"\bWAL\W?MART\b|SAVE MONEY\.?\s*LIVE BETTER", re.I),
        total_re=re.compile(r"\bTOTAL\b", re.I),
    ),
    MerchantPack(
        name="Target",
        category="groceries",
        detect=re.compile(r"\bTARGET\b", re.I),
        total_re=re.compile(r"\bTOTAL\b", re.I),
    ),
    MerchantPack(
        name="Trader Joe's",
        category="groceries",
        detect=re.compile(r"TRADER\s+JOE'?S", re.I),
        total_re=re.compile(r"\bTOTAL\b", re.I),
    ),
]


def detect_pack(lines: List[OcrLine]) -> Optional[MerchantPack]:
    blob = "\n".join(l.text for l in lines)
    for pack in PACKS:
        if pack.detect.search(blob):
            return pack
    return None


def extract_with_pack(pack: MerchantPack, lines: List[OcrLine]) -> RuleExtraction:
    # Generic engine anchors the merchant on the detected pack (high confidence).
    ex = extract_with_rules(lines, known_merchant=pack.name)
    ex.category = pack.category
    # Pack-pinned total: prefer this merchant's TOTAL phrasing near the bottom,
    # since a matched pack makes that total near-certain.
    for ln in reversed(lines):
        if pack.total_re.search(ln.text):
            m = _PRICE_RE.search(ln.text)
            if m:
                ex.total = num_from(m.group(1))
                ex.total_conf = min(1.0, ln.conf + 0.2)
                break
    return ex
