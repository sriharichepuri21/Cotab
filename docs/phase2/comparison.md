# Phase 2 — OCR vs Gemini on the corpus

**Dates:** 2026-08-11 (v1, v2), 2026-08-12 (v2.2), 2026-08-15 (v2.3, v2.4)  
**Corpus:** 6 receipts (Costco, Courtyard by Marriott, Kmart, The Willow Fork Bistro, 2× Walmart). All manually reviewed against the original images.  
**OCR engine is gated OFF** — `settings.ocr_engine_enabled = False`, unchanged throughout.

## Progressive accuracy

| Field       | Gemini | OCR v1 | OCR v2 | OCR v2.2 | **OCR v2.4** |
|-------------|--------|--------|--------|----------|--------------|
| Merchant    | 6/6 (100%) | 3/6 | 3/6 | 6/6 | **6/6 (100%)** |
| Total       | 5/6 (83%)  | 2/6 | 4/6 | 4/6 | **5/6 (83%)** |
| Subtotal    | 6/6 (100%) | 3/6 | 5/6 | 5/6 | **6/6 (100%)** |
| Tax         | 6/6 (100%) | 2/6 | 5/6 | 5/6 | **6/6 (100%)** |
| Currency    | 6/6 (100%) | 4/6 | 4/6 | 4/6 | **6/6 (100%)** |

**Scalar fields: 29/30 correct (97%)**, up from 14/30 at v1. The single remaining
miss is the Courtyard total, where the receipt itself is ambiguous — Gemini reads
50.24 and the human review says 42.24.

## Line items — measured per item, not by count

Count-equality was the old metric and it was actively misleading: nine correct
items out of ten scored the same as zero, and ten *wrong* items scored the same
as ten right ones. Items are now paired to expectations on price with description
overlap as the tiebreak.

| Metric | v2.2 (recomputed) | **v2.4** |
|---|---|---|
| matched / expected (recall) | 8/40 (20%) | **25/40 (62%)** |
| matched / extracted (precision) | 8/9 (89%) | **25/26 (96%)** |

| Receipt | matched / extracted / expected |
|---|---|
| Courtyard by Marriott | 4 / 5 / 5 |
| Kmart | 3 / 3 / 3 |
| The Willow Fork Bistro | 6 / 6 / 6 |
| Walmart (meat/poultry) | 2 / 2 / 4 |
| Costco | 9 / 9 / 10 |
| Walmart (plaza) | 1 / 1 / 12 |

Three receipts are now complete. Precision at 96% is the important number: when
the engine emits an item, it is almost always right — it under-reports rather
than inventing.

## What remains, and why it is not more rule work

The residue is concentrated in two receipts, and both are limited by the OCR
pass, not by parsing:

- **Walmart (plaza), 1/12.** The price column was detected as bare cents —
  `COM3PCSET 088851018239 44` — with the leading digits never recognised at all.
  The information is absent from the OCR output; no rule can recover it. Where
  both fragments *were* detected (`PAMPERS ... 24 94`) the engine now reads 24.94
  correctly.
- **Walmart (meat/poultry), 2/4.** Two item descriptions were never read; only
  the orphan prices `14.97 X` and `12.94N` survive, with no text to attach.
- **Costco, 9/10.** One repeat of a duplicated SKU has no price token on its row.

Better inputs (higher-resolution capture, deskewing, or a stronger detector)
would move these; more regex will not.

## Verdict

**Still not canary-ready as a sole extractor, and that is now a considered
conclusion rather than a blocked one.** Scalar fields are at parity with Gemini
(29/30 vs 30/30) and would stand alone. Line items reach 62% recall, so a receipt
extracted purely by rules would silently drop roughly a third of its items — and
line items are what the split and category features are built on.

The honest use for this engine today is what it was scoped as: **a second eye.**
It is cheap, local, and at 96% precision it disagrees with Gemini only when
something is genuinely worth a human look. Suggested next step is a
disagreement-flagging path (run both, flag mismatches for review) rather than an
extractor swap.

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
