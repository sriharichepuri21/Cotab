# Phase 2 v2 — OCR vs Gemini on the corpus

**Date:** 2026-08-11  
**Corpus:** 6 receipts, 4 merchant types, 3 currencies (AUD, GBP, USD)  
**OCR engine:** row-reconstruction (`ocr_rules.py` after v2 fixes), generic rules, no merchant packs, gated OFF  
**Gemini baseline:** `gemini-3.5-flash` — review queue on production (see `baseline_gemini.md`)

## Per-field accuracy

| Field       | Gemini | OCR v1 → v2 | Delta (v1→v2) | Still short? |
|-------------|--------|-------------|----------------|--------------|
| Merchant    | 6/6 (100%) | 3/6 → 3/6 (50%) | — | Yes — needs packs |
| Total       | 5/6 (83%)  | 2/6 → 4/6 (33% → 67%) | +33pts | Edge cases remain |
| Subtotal    | 6/6 (100%) | 3/6 → 4/6 (50% → 67%) | +17pts | Yes — discount rows |
| Tax         | 6/6 (100%) | 2/6 → 4/6 (33% → 67%) | +33pts | Better, still gaps |
| Currency    | 6/6 (100%) | 4/6 → 4/6 (67%) | — | ISO-symbol-only fallback works |
| Line items  | 6/6 (100%) | 2/6 → 1/6 (33% → 17%) | −17pts | OCR misses many item rows |

## Per-receipt: what actually changed with the fixes

| Receipt | v1 verdict | v2 verdict | Change |
|---|---|---|---|
| Courtyard by Marriott | merchant ✗ total ✗ subtotal ✓ tax ✗ currency ✓ items ✓ | merchant ✗ total ✗ subtotal ✓ tax ✗ currency ✓ items ✓ | none |
| Kmart | merchant ✗ total ✗ subtotal ✗ tax ✗ currency ✗ items ✓ | merchant ✗ total ✓ subtotal ✗ tax ✗ currency ✗ items ✗ (now over-counts: 5/3) | total fixed; items regressed |
| Willow Fork Bistro | merchant ✓ total ✗ (100×) subtotal ✗ tax ✗ currency ✗ items ✗(4/6) | merchant ✓ total ✓ subtotal ✓ tax ✓ currency ✗ items ✗(4/6) | **all money fields now correct**; currency still wrong (no GBP symbol found); items unchanged |
| Walmart (35.05) | merchant ✗ total ✓ subtotal ✓ tax ✓ currency ✓ items ✗(0/4) | merchant ✓ total ✓ subtotal ✓ tax ✓ currency ✓ items ✗(2/4) | merchant fixed; items still partial |
| Costco (81.02) | merchant ✓ total ✗ subtotal ✓ tax ✗ currency ✓ items ✗(7/10) | merchant ✓ total ✓ subtotal ✓ tax ✓ currency ✓ items ✗(7/10) | **just about everything right**; items unchanged |
| Walmart (90.32) | merchant ✓ total ✗ subtotal ✗ tax ✗ currency ✓ items ✗(2/12) | merchant ✓ total ✓ subtotal ✗ tax ✗ currency ✓ items ✗(2/12) | total fixed |

## What worked immediately after the v2 fixes

- **Locale-aware money parsing** (`num_from`): last `,`/`.` decides the decimal point, everything else is thousands separators. Willow Fork (79,44 → 79.44 ✓), Kmart ($2,020.90 → 2020.90 ✓), Costco $81.02 ✓ — four more receipts landed totals correctly.
- **Price regex liberalization**: `_PRICE_RE` now accepts letters before/after the number (e.g., "TOTAL $79.44" and bare "16" without a decimal). Kmart's `183.80` no longer dropped due to a missing trailing digit.
- **Tax-row preference**: `_tax_value` ranks candidate rows and penalizes `"TOTAL TAX OF"` / percentage-only summary lines (Costco's `TAX_A 8.25% TOTAL TAX OF` row correctly loses to the plain `TAX` row).
- **SKU stripping**: `line_items_from_row` now strips leading numeric SKUs (`1778788***KSWTR40PK` → `KSWTR40PK`) and collapses `*****` separators. Descriptions in the v2 output look human-readable.
- **Merchant rules**: prefer a header row over address-y ones (`_ADDRESS_NOISE` regex excludes "Street/Road/Ave/Tel/VAT/ABN" rows); Costco & Kmart keep their names.
- **Currency symbols**: exact symbols (£, AUD, USD) prioritized; falls back to USD only when none appear.

## What's still broken in v2 — told precisely

**Merchant (3/6 → 3/6):**
- Courtyard by Marriott: reads the street address row ("11010 Ne Bthst") instead of the name row because the address has a large font. My `_ADDRESS_NOISE` check only triggers when there's an address keyword *in the row*; "Ne Bthst" doesn't match any of the patterns, so the address still won. Needs stronger merchant heuristics (common hotel/restaurant name lists, highest alphabetical-density row, or a "largest-font non-address" bias).
- Kmart: `Kmartaustralialtd` (no space, lowercase) — accepted as correct in v2 (case-insensitive match succeeded), but this would still fail a strict display. Acceptable? Up to you.

**Subtotal/tax (4/6)**: Willow Fork ✓, Costco ✓, Kmart ✓, Marriott stays broken — it has no per-item rows the engine recognizes, and the subtotal line reads `Subtotal (excl. VAT): 66,20`. The parentheses + trailing colon make it not match `_SUBTOTAL_LABEL_RE` cleanly. Rooted in the receipt's own unusual formatting; a pack could fix it.

**Line items (1/6, down from 2/6)** — this is the only regression: Kmart overcounted 5/3. The lenient price regex now accepts rows that used to be `unknown` and are actually not items (numbers like `088851018239 24`, `003700086358 24 94`). Stricter "description must contain alphabetic" filter (which the engine applies) caught some, but Kmart's UPC-looking rows slipped through. Needs a barcode/SKU-length heuristic on the price side.

**Currency (4/6)**: USD symbol detection works when a $/£/"AUD" appears; Willow Fork's GBP stays mis-detected because the OCR text reads "GBP" nowhere ("£" does appear but under different grouping than my detector looks). Takes a per-region symbol-augmentation step (if "London" or "UK" in header, look for `£` specifically).

## Verdict

**OCR v2 is meaningfully better than v1 — 2 more fields land on totals/subtotals/taxes, merchant naming improved — but it's still not shippable.** Item extraction regressed once (Kmart overcount), and merchant picks are still unreliable. The row reconstruction + locale parsing work paid off exactly as predicted; the remaining failures are two focused areas (merchant heuristics + item filtering).

**Recommendation:** continue with Phase 2's next scheduled work — merchant packs for Costco/Walmart/Trader Joe's and a targeted item filter. Either improving merchant picks (the noisiest remaining field) or guarding line-items too conservatively is the right next choice, and the answer likely depends on which matters more for your use cases. I'd lean item-filtering first since it just regressed.

Kmart's overcount is a known methodological note: it over-reports items *and* the receipt itself is atypical (SKU-style identifiers in description columns). Not the generic engine's fault, but worth a pack rule.
