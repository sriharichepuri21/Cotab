# OCR v2.2 — corpus measurement (merchant packs enabled)

**Date:** 2026-08-12 01:53 UTC  
**Algorithm:** row-reconstruction + typo-tolerant labels + merchant packs (`ocr_packs.py`)  
**Corpus:** 6 receipts (Costco, Courtyard by Marriott, Kmart, The Willow Fork Bistro, Walmart merchants)

## Per-field accuracy

| Field | Pass | Total | % |
|---|---|---|---|
| merchant | 6 | 6 | 100% |
| total | 4 | 6 | 67% |
| subtotal | 5 | 6 | 83% |
| tax | 5 | 6 | 83% |
| currency | 4 | 6 | 67% |
| line_count | 2 | 6 | 33% |

## Per-receipt breakdown

- **Courtyard by Marriott**: ✓ merchant  ✗ total  ✓ subtotal  ✓ tax  ✓ currency  ✓ items(5/5)
- **Kmart**: ✓ merchant  ✓ total  ✓ subtotal  ✓ tax  ✗ currency  ✓ items(3/3)
- **The Willow Fork Bistro**: ✓ merchant  ✓ total  ✓ subtotal  ✓ tax  ✗ currency  ✗ items(4/6)
- **Walmart**: ✓ merchant  ✓ total  ✓ subtotal  ✓ tax  ✓ currency  ✗ items(2/4)
- **Costco**: ✓ merchant  ✗ total  ✓ subtotal  ✓ tax  ✓ currency  ✗ items(7/10)
- **Walmart**: ✓ merchant  ✓ total  ✗ subtotal  ✗ tax  ✓ currency  ✗ items(2/12)

## Failures

- `335a2cfe… total: expected=42.24 got=50.24`
- `66678720… currency: expected='AUD' got='USD'`
- `723382a0… currency: expected='GBP' got='USD'`
- `97b54c69… total: expected=81.02 got=0.0`
- `e47b4312… subtotal: expected=84.16 got=0.0`
- `e47b4312… tax: expected=6.16 got=0.0`
