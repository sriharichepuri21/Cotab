# Gemini Baseline — corpus measurement

**Date:** 2026-08-11 07:08 UTC  
**Model:** gemini-3.1-flash-lite  
**Corpus:** 6 receipts (Costco, Courtyard by Marriott, Kmart, The Willow Fork Bistro, Walmart merchants)  
**Engine:** `gemini_service.extract_receipt_from_image` (direct call, not HTTP)

> Note: 1 API call per receipt (6 total calls this run).

## Per-field accuracy

| Field | Pass | Total | % |
|---|---|---|---|
| merchant | 6 | 6 | 100% |
| total | 5 | 6 | 83% |
| subtotal | 6 | 6 | 100% |
| tax | 6 | 6 | 100% |
| currency | 6 | 6 | 100% |
| line_count | 6 | 6 | 100% |

## Per-receipt breakdown

- **Courtyard by Marriott**: ✓ merchant  ✗ total  ✓ subtotal  ✓ tax  ✓ currency  ✓ items(5/5)
- **Kmart**: ✓ merchant  ✓ total  ✓ subtotal  ✓ tax  ✓ currency  ✓ items(3/3)
- **The Willow Fork Bistro**: ✓ merchant  ✓ total  ✓ subtotal  ✓ tax  ✓ currency  ✓ items(6/6)
- **Walmart**: ✓ merchant  ✓ total  ✓ subtotal  ✓ tax  ✓ currency  ✓ items(4/4)
- **Costco**: ✓ merchant  ✓ total  ✓ subtotal  ✓ tax  ✓ currency  ✓ items(10/10)
- **Walmart**: ✓ merchant  ✓ total  ✓ subtotal  ✓ tax  ✓ currency  ✓ items(12/12)

## Failures

- `335a2cfe… total: expected=42.24 got=50.24`
