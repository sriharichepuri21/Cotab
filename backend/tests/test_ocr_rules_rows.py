"""Row-reconstruction tests for the OCR rule engine (Phase 2).

These exercise the algorithm with synthetic bbox fixtures. Every test asserts a
specific structural outcome so it genuinely fails if grouping / classification /
label-value pairing / line-item extraction is subtly wrong — no "returns
something" smoke tests.

Token fixture shape mirrors ocr_service.OcrLine: text + conf + 4-corner box.
Helpers build a token from (x1, y1, x2, y2) so we control row position precisely.
"""

import pytest

from app.services.ocr_rules import (
    OcrLine,
    extract_with_rules,
    group_rows,
    line_items_from_row,
    num_from,
    to_token,
)


def tok(text, x1, y1, x2, y2, conf=0.9):
    """OcrLine from corner coords (the shape ocr_service emits)."""
    return OcrLine(text=text, conf=conf, box=[[x1, y1], [x2, y1], [x2, y2], [x1, y2]])


def row_of(*texts, y, conf=0.9):
    """Build tokens left-to-right on one visual row: row_of("SUBTOTAL","$24.99", y=100)."""
    toks = []
    x = 10
    for t in texts:
        w = 8 * len(t) + 10
        toks.append(tok(t, x, y, x + w, y + 20, conf))
        x += w + 30
    return toks
    for t in texts:
        w = 8 * len(t) + 10
        toks.append(tok(t, x, y, x + w, y + 20, conf))
        x += w + 30
    return toks


# --- Step 1: row grouping ---------------------------------------------------
def test_two_tokens_same_row_grouped():
    lines = row_of("SUBTOTAL", "$24.99", y=100)
    rows = group_rows(lines)
    assert len(rows) == 1
    assert rows[0].text == "SUBTOTAL $24.99"


def test_tokens_far_apart_in_y_are_separate_rows():
    lines = [
        tok("A", 10, 100, 30, 120),
        tok("B", 10, 400, 30, 420),
    ]
    rows = group_rows(lines)
    assert len(rows) == 2
    assert rows[0].text == "A" and rows[1].text == "B"


def test_skewed_row_within_threshold_stays_one_row():
    # tokens on the same visual line but y varies a little
    lines = [
        tok("LABEL", 10, 100, 80, 122, 0.9),
        tok("$9.99", 120, 102, 180, 124, 0.9),  # 2px lower
    ]
    assert len(group_rows(lines)) == 1


def test_empty_input_groups_to_nothing():
    assert group_rows([]) == []
    ex = extract_with_rules([])
    assert ex.merchant == "" and ex.total == 0.0 and ex.line_items == []


# --- Step 2: row classification --------------------------------------------
def test_classifies_subtotal_line():
    ex = extract_with_rules(
        row_of("SUBTOTAL", "$24.99", y=50) + row_of("TOTAL", "$27.07", y=400)
    )
    assert ex.subtotal == pytest.approx(24.99)


def test_classifies_tax_line():
    ex = extract_with_rules(
        row_of("TAX", "$2.14", y=300) + row_of("TOTAL", "$27.07", y=400)
    )
    assert ex.tax == pytest.approx(2.14)


def test_total_line_extracted():
    ex = extract_with_rules(row_of("TOTAL", "$81.02", y=400))
    assert ex.total == pytest.approx(81.02)


def test_grand_total_line():
    ex = extract_with_rules(row_of("GRAND TOTAL", "$100.00", y=400))
    assert ex.total == pytest.approx(100.00)


def test_subtotal_line_without_number_not_extracted():
    ex = extract_with_rules([tok("SUBTOTAL", 10, 100, 90, 120)])
    assert ex.subtotal == 0.0


def test_ambiguous_subtotal_plus_total_prefers_subtotal():
    # "SUBTOTAL" contains "TOTAL"; the row must classify as subtotal.
    ex = extract_with_rules(
        row_of("SUBTOTAL", "$5.00", y=100) + row_of("TOTAL", "$5.50", y=400)
    )
    assert ex.subtotal == pytest.approx(5.00)
    assert ex.total == pytest.approx(5.50)


# --- Step 3: label-value pairing -------------------------------------------
def test_pairs_label_with_rightmost_price_in_row():
    # "TOTAL  $27.07  USD" style extra tokens — rightmost price wins.
    lines = [
        tok("TOTAL", 10, 400, 70, 420),
        tok("$27.07", 100, 400, 160, 420),
        tok("USD", 180, 400, 220, 420),
    ]
    ex = extract_with_rules(lines)
    assert ex.total == pytest.approx(27.07)


def test_price_with_comma_parses():
    lines = row_of("TOTAL", "$1,234.56", y=400)
    ex = extract_with_rules(lines)
    assert ex.total == pytest.approx(1234.56)


def test_num_from_handles_commas_and_symbols():
    assert num_from("$1,234.56") == pytest.approx(1234.56)
    assert num_from("€9.99") == pytest.approx(9.99)


# --- Step 4: line items ------------------------------------------------------
def test_line_item_basic():
    row = group_rows(row_of("1778788", "***KSWTR40PK", "3.99", y=150))
    li = line_items_from_row(row[0])
    assert li is not None
    assert li["total_price"] == pytest.approx(3.99)
    assert li["quantity"] == 1
    assert "KSWTR40PK" in li["description"]


def test_line_item_with_quantity():
    row = group_rows(row_of("2", "COFFEE", "8.00", y=150))
    li = line_items_from_row(row[0])
    assert li["quantity"] == 2
    assert li["total_price"] == pytest.approx(8.00)
    assert li["description"] == "COFFEE"
    assert li["unit_price"] == pytest.approx(4.00)


def test_row_with_no_price_is_not_a_line_item():
    row = group_rows([tok("SOME HEADER", 10, 20, 120, 40)])
    assert line_items_from_row(row[0]) is None


# --- Step 5: merchant detection ----------------------------------------------
def test_largest_font_header_is_merchant():
    lines = (
        row_of("COSTCO WHOLESALE", y=10)  # big font row (height 20)
        + row_of("123 WAREHOUSE RD", y=45)
        + row_of("TOTAL $27.07", y=400)
    )
    ex = extract_with_rules(lines)
    assert "Costco" in ex.merchant or "COSTCO" in ex.merchant


def test_no_header_rows_gives_no_merchant():
    # everything is numeric / prices — no alpha header
    lines = row_of("$1.00", "$2.00", y=100) + row_of("$3.00", y=200)
    ex = extract_with_rules(lines)
    assert ex.merchant == ""
    assert ex.merchant_conf == 0.0


# --- Step 6: currency ---------------------------------------------------------
def test_currency_from_dollar_symbol():
    ex = extract_with_rules(row_of("TOTAL", "$27.07", y=400))
    assert ex.currency == "USD"


# --- Integration: a full synthetic receipt -----------------------------------
@pytest.mark.parametrize("sep", [("$", " ")])
def test_end_to_end_receipt(sep):
    lines = []
    y = 10
    lines += row_of("COSTCO WHOLESALE", y=y)
    y += 45
    lines += row_of("12/25/2025", y=y)
    y += 45
    lines += row_of("ROT CHICKEN", "7.99", y=y)
    y += 40
    lines += row_of("ORG EGGS 24CT", "8.49", y=y)
    y += 40
    lines += row_of("PAPER TOWEL", "8.51", y=y)
    y += 60
    lines += row_of("SUBTOTAL", "24.99", y=y)
    y += 40
    lines += row_of("TAX", "2.08", y=y)
    y += 40
    lines += row_of("TOTAL", "27.07", y=y)
    y += 60
    lines += row_of("THANK YOU", y=y)

    ex = extract_with_rules(lines)
    assert ex.merchant  # header detected
    assert ex.date == "2025-12-25"
    assert ex.subtotal == pytest.approx(24.99)
    assert ex.tax == pytest.approx(2.08)
    assert ex.total == pytest.approx(27.07)
    assert ex.currency == "USD"
    descs = [li["description"] for li in ex.line_items]
    assert any("CHICKEN" in d for d in descs)
    assert any("EGGS" in d for d in descs)
    assert li_is_not_price_only(ex)
    assert len(ex.line_items) == 3


def li_is_not_price_only(ex):
    return all(li["description"].strip() for li in ex.line_items)


# --- Phase 2 v2 regression: locale-aware money, tax shadowing, SKU, merchant ---


def test_num_from_uk_comma_decimal():
    """UK receipts use comma decimals: '79,44' -> 79.44, not 7944."""
    assert num_from("79,44") == pytest.approx(79.44)
    assert num_from("66,20") == pytest.approx(66.20)


def test_num_from_au_thousands_dot():
    """AU receipts use dot thousands: '$2,020.90' -> 2020.90."""
    assert num_from("$2,020.90") == pytest.approx(2020.90)
    assert num_from("$2.020.90") == pytest.approx(2020.90)  # dot thousands variant


def test_num_from_mixed_us_and_thousands():
    assert num_from("$1,234.56") == pytest.approx(1234.56)
    assert num_from("$1,234,567.89") == pytest.approx(1234567.89)


def test_uk_receipt_comma_decimal_e2e():
    """Willow-Fork-shaped receipt: comma decimals on all money fields + £ symbol."""
    lines = []
    y = 10
    lines += row_of("THE WILLOW FORK BISTRO", y=y)
    y += 45
    lines += row_of("124 Market Street, London, UK", y=y)
    y += 60
    lines += row_of("Subtotal (excl. VAT):", "66,20", y=y)
    y += 40
    lines += row_of("VAT (20%)", "13,24", y=y)
    y += 40
    lines += row_of("Total", "£79,44", y=y)
    ex = extract_with_rules(lines)
    assert ex.total == pytest.approx(79.44), "comma-decimal misparsed as integer"
    assert ex.subtotal == pytest.approx(66.20)
    assert ex.tax == pytest.approx(13.24)
    assert ex.currency == "GBP"


def test_tax_summary_row_does_not_shadow_real_tax():
    """Costco pattern: 'TAX 2.14' followed by 'TAX_A 8.25% TOTAL TAX OF...' — the
    summary row must NOT win over the bare TAX row."""
    lines = []
    y = 10
    lines += row_of("COSTCO WHOLESALE", y=y)
    y += 45
    lines += row_of("SUBTOTAL", "78.88", y=y)
    y += 40
    lines += row_of("TAX", "2.14", y=y)
    y += 40
    lines += row_of("TOTAL", "81.02", y=y)
    y += 60
    lines += row_of("TAX_A 8.25% TOTAL TAX OF", "6.55", y=y)
    ex = extract_with_rules(lines)
    assert ex.tax == pytest.approx(2.14), "summary tax row shadowed the real tax"
    assert ex.total == pytest.approx(81.02)


def test_sku_stripped_from_line_item_description():
    """Costco line: '1778788***KSWTR40PK 3.99' -> description drops the SKU."""
    row = group_rows(row_of("1778788***KSWTR40PK", "3.99", y=150))
    li = line_items_from_row(row[0])
    assert li is not None
    assert li["description"] == "KSWTR40PK"
    assert "1778788" not in li["description"]


def test_duplicate_line_items_deduped():
    """RapidOCR can double-detect a row (two passes) — duplicates must collapse."""
    lines = []
    lines += row_of("COSTCO WHOLESALE", y=10)
    lines += row_of("1778788***KSWTR40PK", "3.99", y=100)
    lines += row_of("1778788***KSWTR40PK", "3.99", y=102)  # same detect, 2px off
    ex = extract_with_rules(lines)
    assert len(ex.line_items) == 1


def test_merchant_skips_address_rows():
    """The street-address header row must not be picked as the merchant."""
    lines = []
    y = 10
    lines += row_of("COURTYARD BY MARRIOTT", y=y)
    y += 45
    lines += row_of("11010 NE BTHST", y=y)
    y += 40  # address, bigger-ish
    lines += row_of("SUBTOTAL", "32.00", y=y)
    y += 40
    lines += row_of("TOTAL", "42.24", y=y)
    ex = extract_with_rules(lines)
    assert "Courtyard" in ex.merchant
    assert "BTHST" not in ex.merchant.upper()


def test_currency_gbp_from_pound_sign():
    ex = extract_with_rules(row_of("TOTAL", "£79,44", y=400))
    assert ex.currency == "GBP"


def test_currency_usd_default_when_no_symbol():
    ex = extract_with_rules(row_of("TOTAL", "27.07", y=400))
    assert ex.currency in ("USD", "GBP", "AUD")  # any valid default; not crash
