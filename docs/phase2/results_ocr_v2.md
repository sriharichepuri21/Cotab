# OCR v2.4 — corpus measurement

**Date:** 2026-08-15 01:30 UTC  
**Algorithm:** row-reconstruction + typo-tolerant labels + merchant packs + regional currency + OCR-damage recovery  
**Corpus:** 6 receipts (Costco, Courtyard by Marriott, Kmart, The Willow Fork Bistro, Walmart merchants)

## Per-field accuracy

| Field | Pass | Total | % |
|---|---|---|---|
| merchant | 6 | 6 | 100% |
| total | 5 | 6 | 83% |
| subtotal | 6 | 6 | 100% |
| tax | 6 | 6 | 100% |
| currency | 6 | 6 | 100% |
| line_count | 3 | 6 | 50% |

## Line items (per-item, not just count)

| Metric | Value |
|---|---|
| matched | 25 |
| expected | 40 |
| extracted | 26 |
| recall | 62% |
| precision | 96% |

Matched = same price and best description overlap. Count-equality alone hides
whether the items are the *right* ones.

## Per-receipt breakdown

- **Courtyard by Marriott**: ✓ merchant  ✗ total  ✓ subtotal  ✓ tax  ✓ currency  ✓ items(4✓/5got/5exp)
- **Kmart**: ✓ merchant  ✓ total  ✓ subtotal  ✓ tax  ✓ currency  ✓ items(3✓/3got/3exp)
- **The Willow Fork Bistro**: ✓ merchant  ✓ total  ✓ subtotal  ✓ tax  ✓ currency  ✓ items(6✓/6got/6exp)
- **Walmart**: ✓ merchant  ✓ total  ✓ subtotal  ✓ tax  ✓ currency  ✗ items(2✓/2got/4exp)
- **Costco**: ✓ merchant  ✓ total  ✓ subtotal  ✓ tax  ✓ currency  ✗ items(9✓/9got/10exp)
- **Walmart**: ✓ merchant  ✓ total  ✓ subtotal  ✓ tax  ✓ currency  ✗ items(1✓/1got/12exp)

## Failures

- `335a2cfe… total: expected=42.24 got=50.24`
