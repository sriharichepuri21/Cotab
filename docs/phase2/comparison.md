# Phase 2 v1 — OCR vs Gemini on the corpus

**Date:** 2026-08-11  
**Corpus:** 6 receipts, 4 merchant types, 3 currencies (AUD, GBP, USD)  
**OCR engine:** commit `1e04b65` (row reconstruction, generic rules, no merchant packs), gated OFF  
**Gemini model:** `gemini-3.1-flash-lite`

Both engines were run against the same reviewed ground truth (`backend/corpus/*/expected.json`).

## Per-field accuracy

| Field       | Gemini | OCR v1 | Delta |
|-------------|--------|--------|-------|
| Merchant    | 6/6 (100%) | 3/6 (50%) | −50pts |
| Total       | 5/6 (83%)  | 2/6 (33%) | −50pts |
| Subtotal    | 6/6 (100%) | 3/6 (50%) | −50pts |
| Tax         | 6/6 (100%) | 2/6 (33%) | −67pts |
| Currency    | 6/6 (100%) | 4/6 (67%) | −33pts |
| Line count  | 6/6 (100%) | 2/6 (33%) | −67pts |

**Gemini was flawless on 4 of 6 receipts; OCR v1 was flawless on 0, and cleanly wrong on several.** The margin is large and consistent.

## Per-receipt breakdown

| Receipt | Merchant | Total | Subtotal | Tax | Currency | Items | Gemini | OCR |
|---|---|---|---|---|---|---|---|---|
| Courtyard by Marriott | ✓/✗* | ✗ both | ✓/✓ | ✓/✗ | ✓/✓ | 5/5 ✓✓ | got a *different* total 50.24 vs reviewed 42.24 (true extraction disagreement — possibly tax-inclusive math) | merchant read as the address line "`11010 Ne Bthst`", not the restaurant name; total mismatched the reviewed value |
| Kmart (2020.90 AUD) | ✗ | ✗ | ✗ | ✗ | ✗ (USD vs AUD) | 3/3 ✓✓ | ✓ all | OCR produced all zeros for totals — did not recognize the AU layout; "KmartAustraliaLtd" as one blob; currency not detected |
| The Willow Fork Bistro (GBP, comma decimals) | ✓ | ✗ (7944 vs 79.44 — reads `79,44` as integer 7944) | ✗ same scale | ✗ same scale | ✗ (USD vs GBP) | 4/6 | ✓ all | fraction lost: UK receipt uses `,` as decimal separator; our price regex only matches `.` so `79,44`→`7944` (100× inflation); currency symbol `£` unhandled → defaults USD |
| Walmart (35.05) | ✗ | ✓ | ✓ | ✓ | ✓ | 0/4 | ✓ all | OCR got **zero line items** despite 4 expected; "Walmart*" merchant had trailing OCR artifact |
| Costco (81.02) | ✓ | ✗ (0.0 vs 81.02 — TOTAL printed as `81F02`, OCR confused the decimal point) | ✓ (78.88) | ✗ (0.0 — "TAX_A 8.25% TOTAL TAX OF" row obscured the actual 2.14 value) | ✓ | 7/10 | ✓ all | total mis-OCR'd as `81F02`; the real tax line `TAX 2.14` read fine but a second "total tax" row shadowed it; SKU/description merged ("1778788***KSWTR40PK") creating duplicate/unreadable items |
| Walmart (90.32) | ✓ | ✓ | ✗ | ✗ | ✓ | 2/12 | ✓ all | subtotal+tax missed (layout put values on separate/misclassified rows); only 2 of 12 line items captured |

\* left column = Gemini result, right column = OCR result, read as `Gemini/OCR`.

## Failure modes observed in OCR v1 (specific, and why each happened)

1. **Locale/decimal misunderstanding (GBP + AUD).** Two receipts use `,` as the decimal separator (`79,44`) or `.` as the thousands separator (`2.020.90`). Our `_PRICE_RE` only accepts `.` as decimal, so:
   - Willow Fork `Total 79,44` → `7944.0` (100× too big).
   - Kmart `$2.020.90` → regex fails entirely → 0.0.  
   **Root cause:** currency + number-format rules are not locale-aware. This is an algorithm gap, not a merchant-pack gap.

2. **Header/merchant confusion.** Courtyard read the *address* line ("`11010 Ne Bthst`") as the merchant because the largest-font non-numeric header row was the street address, not the restaurant name. Merchant selection currently picks the topmost high-confidence header row; restaurant receipts lead with the name but this one led with location. Needs a smarter merchant heuristic (prefer a header row that contains only letters/spaces, or known-name matching against the pack set).

3. **Tax shadowing (Costco).** Two tax-ish rows exist: `TAX 2.14` and `TAX_A 8.25% TOTAL TAX OF`. The classifier picks a tax row and the numeric pairing landed on the wrong one (the summary row). Tax extraction needs to prefer the row whose *value* is a plain money amount and whose label is a bare "TAX"/"GST"/"VAT", not a "total tax of N%" summary line.

4. **SKU-prefix line items (Costco).** RapidOCR emits `1778788***KSWTR40PK 3.99` as a single line-item fragment; the engine treats "1778788" as part of the description. It also produced duplicate rows ("1778788***KSWTR40PK 3.99" appears twice from two detection passes). Line-item extraction needs to (a) strip numeric SKUs from the description, (b) de-dupe identical (description,total) pairs.

5. **Line-item undercounting (Walmart ×2).** Walmart receipts put the price on the same row as the description but the price token matches the price-regex only when cleanly bounded; several item rows got classified `unknown` (e.g. "1908636PINKMULTI 5.97 A" has a trailing OCR artifact that broke the price token). Only 2/12 and 0/4 items captured. Suggests the row classifier is too strict about what counts as a price token.

## Verdict

**OCR v1 needs algorithm work — not merchant packs yet.** The failures are systematic and locale/format-driven: decimal-separator handling, merchant header selection, tax-row disambiguation, SKU stripping, and price-token leniency. A merchant pack would fix Costco's specific layout but not the underlying GBP/AUD/decimal problems that hit every non-US receipt. The generic engine must be locale-aware before it's trustworthy on real receipts.

## Recommended next step

Before any canary, fix in order:
1. Locale-aware number parsing — accept both `.` and `,` as decimal separators and disambiguate thousands vs. decimal by position (e.g. `2.020.90` → thousands; `79,44` → cents).
2. Currency symbol → ISO mapping (`£`→GBP, `A$`/`AU$`/`AUD`→AUD).
3. Smarter merchant header pick — favor a header row that is mostly letters and matches a known merchant pack name over one containing digits/addresses.
4. Tax disambiguation — prefer the bare `TAX`/rate-row, not the "% TOTAL TAX OF" summary line.
5. Line-item cleanup — strip leading SKU digits from descriptions, de-dupe (desc,total) repeats, relax the price-token boundary so trailing OCR artifacts don't sink the row.

Re-run this corpus after those land. If merchant reaches ~5/6 and total/tax/subtotal ≥4/6 with correct currencies, then it's worth merchant-pack tuning; until then OCR would mis-charge users and must stay gated OFF.

**OCR_ENGINE_ENABLED stays `false`.** No production impact from this measurement.
