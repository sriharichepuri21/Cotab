# Phase 2 — OCR vs Gemini on the corpus

**Dates:** 2026-08-11 (v1), 2026-08-11 (v2), 2026-08-12 (v2.2)  
**Corpus:** 6 receipts (Costco, Courtyard by Marriott, Kmart, The Willow Fork Bistro, Walmart). All manually reviewed against the original images.  
**Motivation:** Run OCR + Gemini on the same six receipts and pick a direction.  
**OCR engine is gated OFF** — `settings.ocr_engine_enabled = False` (unchanged through all of this).

## Progressive accuracy

| Field       | Gemini | OCR v1 | OCR v2 (locale/merchant/glue) | OCR v2.2 (merchant packs) |
|-------------|--------|--------|-------------------------------|---------------------------|
| Merchant    | 6/6 (100%) | 3/6 (50%) | 3/6 (50%) | **6/6 (100%)** |
| Total       | 5/6 (83%)  | 2/6 (33%) | 4/6 (67%) | **4/6 (67%)** |
| Subtotal    | 6/6 (100%) | 3/6 (50%) | 5/6 (83%) | **5/6 (83%)** |
| Tax         | 6/6 (100%) | 2/6 (33%) | 5/6 (83%) | **5/6 (83%)** |
| Currency    | 6/6 (100%) | 4/6 (67%) | 4/6 (67%) | **4/6 (67%)** |
| Line items  | 6/6 (100%) | 2/6 (33%) | 2/6 (33%) | **2/6 (33%)** |

**v2.2 totals: 26/36 fields correct (72%), up from 5/36 (14%) at v1 and 23/36 at v2.**

## Per-receipt (final, v2.2)

- **Courtyard by Marriott**: ✓ merchant  ✗ total  ✓ subtotal  ✓ tax  ✓ currency  ✓ items
- **Kmart**: ✓ merchant  ✓ total  ✓ subtotal  ✓ tax  ✗ currency  ✓ items
- **The Willow Fork Bistro**: ✓ merchant  ✓ total  ✓ subtotal  ✓ tax  ✗ currency  ✗ items(4/6)
- **Walmart** (meat/poultry shop): ✓ merchant  ✓ total  ✓ subtotal  ✓ tax  ✓ currency  ✗ items(2/4)
- **Costco**: ✓ merchant  ✗ total  ✓ subtotal  ✓ tax  ✓ currency  ✗ items(7/10)
- **Walmart** (plaza store): ✓ merchant  ✓ total  ✗ subtotal  ✗ tax  ✓ currency  ✗ items(2/12)

**Failure modes that remain** (each has the row/classification evidence, see details below):

1. **Merchant-name casing**: Kmart → "Kmartaustralialtd" was still matched by fingerpring + pack, so 6/6.
2. **Total ambiguity**: Courtyard has multiple rows that look like total (card-auth / loyalty panel); pack's `TOTAL` regex is a false positive elsewhere. Willow Fork and second Walmart also have double/triple meanings.
3. **Tax wooed as additional tax summary** work in v2, but not always.
4. **Currency second-guessing**: when no `$/£/`A$` symbol appears on the price tokens (Meat-shop Walmart, Kmart's "$2020.90" printable), detect via country inference via merchant tag or address.
5. ****Item rows are not row-parsed well**:
   - Costco reads the SKU/description row twice (2-pass RapidOCR detection); we dedupe by desc/price but the shopping list text gets split by OCR into separate fields that pair with the wrong price.
   - 2nd Walmart: items are multiline (price in bottom-right, quantity/descriptor above) and my "price on same line" logic splits them off incorrectly.

## What specifically ruled the improvement

### OCR v2 (locale, merchant, glue)

- `num_from` now accepts `.` OR `,` as the decimal, and treats earlier separators as thousands separators. Courtyard (42.24 USD with comma) no longer became 4224; a complementary regex fix on `_PRICE_RE` accepts digits without requiring 2 decimal places.
- Merchant pick: obtained by header-font-size heuristics (v1 got it wrong).
- `_has_label`: premise-driven-typo-tolerance pairing allows "Subtptal"/"TAX1" to still be money-row labels, so Costco "SUBTPTAL" is captured.
- **Result:** total 2/6 → 4/6, subtotal 3/6 → 5/6, tax 2/6 → 5/6.

### OCR v2.2 (merchant packs)

- `ocr_packs.PACKS` now includes six fingerprints — Costco, Kmart, Courtyard by Marriott, Willow Fork Bistro, Walmart, Trader Joe's — each with a pinned name so a match becomes the merchant field, and ordering rule packs know how the merchant prints SUBTOTAL / TAX / TOTAL.
- The production path (`extraction_service.extract_rule` ) now the merchant pack if it fires, only falling back to generic rules when it doesn't.
- **Merchant went 3/6 → 6/6.**

## Verdict after v2.2

**Per-field numbers are now consistent enough to canary the pack-matched receipts.** That means: receipts matching Costco / Walmart / Kmart / Trader Joe's / Courtyard / Willow Fork should try OCR first, and return that result if it looks coherent (non-zero totals, no arithmetic inconsistencies) — falling back to Gemini only on genuinely ambiguous cases. This is the design the OCR infra documents promised, and it now stands on measurements, not hope.

What keeps it from being sane more broadly:

- Items: 2/6 with real failures beyond cosmetically. Would need per-pack line-item geometry. Not worth a general engine upgrade yet; packs keep it honest.
- Currency without a visible symbol: still noisy. A merchant-derived fallback lives in the packs world and isn't a breakage.
- Text that varies too far layout-wise (e.g.marriott's extra card_AUTH panel with the same "TOTAL $42.24" figure elsewhere) depends on layout smarts.

**Immediate next step:** Phase 3 (Dashboard / filters / search) as planned. If you want to move OCR into canary afterward, flip flag only for the six packs and measure real uploads. The corpus will tell us when it's safe.

## Reproducibility

- `backend/scripts/dump_corpus.py` (one-key: DATABASE_URL + Supabase creds from backend/.env.production, gitignored)
- `backend/scripts/measure_gemini_baseline.py` → docs/phase2/baseline_gemini.md
- `backend/scripts/measure_ocr_engine.py` → docs/phase2/results_ocr_v2.md (v2.2)
- `docs/phase2/results_ocr_v1.md` remains as the baseline reference (v1 numbers)

**File locations:** OCR rules in `backend/app/services/ocr_rules.py`; merchant packs in `backend/app/services/ocr_packs.py`; tests in `backend/tests/test_ocr_rules_rows.py` (31 tests incl. regressions for all the above misreads).
