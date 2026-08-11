# OCR v1 — corpus measurement

**Date:** 2026-08-11 16:06 UTC  
**Algorithm:** row-reconstruction (`app.services.ocr_rules`) — generic engine only, no merchant packs  
**Corpus:** 6 receipts (Costco, Courtyard by Marriott, Kmart, The Willow Fork Bistro, Walmart merchants)

## Per-field accuracy

| Field | Pass | Total | % |
|---|---|---|---|
| merchant | 3 | 6 | 50% |
| total | 4 | 6 | 67% |
| subtotal | 4 | 6 | 67% |
| tax | 4 | 6 | 67% |
| currency | 4 | 6 | 67% |
| line_count | 1 | 6 | 17% |

## Per-receipt breakdown

- **Courtyard by Marriott**: ✗ merchant  ✗ total  ✓ subtotal  ✓ tax  ✓ currency  ✓ items(5/5)
- **Kmart**: ✗ merchant  ✓ total  ✗ subtotal  ✗ tax  ✗ currency  ✗ items(5/3)
- **The Willow Fork Bistro**: ✓ merchant  ✓ total  ✓ subtotal  ✓ tax  ✗ currency  ✗ items(4/6)
- **Walmart**: ✗ merchant  ✓ total  ✓ subtotal  ✓ tax  ✓ currency  ✗ items(2/4)
- **Costco**: ✓ merchant  ✗ total  ✓ subtotal  ✓ tax  ✓ currency  ✗ items(7/10)
- **Walmart**: ✓ merchant  ✓ total  ✗ subtotal  ✗ tax  ✓ currency  ✗ items(2/12)

## Failures

- `335a2cfe… merchant: expected='Courtyard by Marriott' got='Seattle Bellevue'`
- `335a2cfe… total: expected=42.24 got=50.24`
- `66678720… merchant: expected='Kmart' got='Kmartaustralialtd'`
- `66678720… subtotal: expected=2020.9 got=0.0`
- `66678720… tax: expected=183.8 got=0.0`
- `66678720… currency: expected='AUD' got='USD'`
- `723382a0… currency: expected='GBP' got='USD'`
- `96373c33… merchant: expected='Walmart' got='Walmart*'`
- `97b54c69… total: expected=81.02 got=0.0`
- `e47b4312… subtotal: expected=84.16 got=0.0`
- `e47b4312… tax: expected=6.16 got=0.0`
