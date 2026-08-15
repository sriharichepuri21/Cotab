# OCR v2.2 — corpus measurement (merchant packs enabled)

**Date:** 2026-08-15 01:15 UTC  
**Algorithm:** row-reconstruction + typo-tolerant labels + merchant packs (`ocr_packs.py`)  
**Corpus:** 6 receipts (Costco, Courtyard by Marriott, Kmart, The Willow Fork Bistro, Walmart merchants)

## Per-field accuracy

| Field | Pass | Total | % |
|---|---|---|---|
| merchant | 6 | 6 | 100% |
| total | 5 | 6 | 83% |
| subtotal | 6 | 6 | 100% |
| tax | 6 | 6 | 100% |
| currency | 6 | 6 | 100% |
| line_count | 1 | 6 | 17% |

## Per-receipt breakdown

- **Courtyard by Marriott**: ✓ merchant  ✗ total  ✓ subtotal  ✓ tax  ✓ currency  ✗ items(0/5)
- **Kmart**: ✓ merchant  ✓ total  ✓ subtotal  ✓ tax  ✓ currency  ✓ items(3/3)
- **The Willow Fork Bistro**: ✓ merchant  ✓ total  ✓ subtotal  ✓ tax  ✓ currency  ✗ items(4/6)
- **Walmart**: ✓ merchant  ✓ total  ✓ subtotal  ✓ tax  ✓ currency  ✗ items(2/4)
- **Costco**: ✓ merchant  ✓ total  ✓ subtotal  ✓ tax  ✓ currency  ✗ items(0/10)
- **Walmart**: ✓ merchant  ✓ total  ✓ subtotal  ✓ tax  ✓ currency  ✗ items(0/12)

## Failures

- `335a2cfe… total: expected=42.24 got=50.24`
