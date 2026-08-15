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

# --- Phase 2 v2.1 regression: typo-tolerant label matching -------------------


# RapidOCR's two small-charset passes produce recurring one-edit typos on the
# money labels. These were observed in the corpus (Kmart read "SUBTOTAL" as
# "Subtptal"; Walmart produced "SUBYOTAL 84 16"). These forms must be treated as
# the real labels, not ignored as unknown rows.
def test_label_misread_subtotal_is_classified():
    ex = extract_with_rules(
        row_of("Subtptal", "$2,020.90", y=200) + row_of("TOTAL", "$2,020.90", y=400)
    )
    assert ex.subtotal == pytest.approx(2020.90)


def test_label_misread_total_is_classified():
    ex = extract_with_rules(
        row_of("SUBTOTAL", "$5.00", y=100) + row_of("T0tal", "$5.50", y=400)
    )
    assert ex.total == pytest.approx(5.50)


def test_glue_prefixed_labels_match():
    """A label glued to its trailing word ('GSTIncluded', 'SubtotalExcl') matches."""
    from app.services.ocr_rules import _SUBTOTAL_KEYWORDS, _TAX_KEYWORDS, _has_label

    assert _has_label("GST INCLUDED 183.80", _TAX_KEYWORDS)
    assert _has_label("SUBTOTALS: 66,20", _SUBTOTAL_KEYWORDS)


def test_lev1_misread_typology():
    """One substitution, one insert, one delete all match; two-char drift does not."""
    from app.services.ocr_rules import _lev1

    assert _lev1("SUBTOTAL", "SUBTOTA")  # delete 1
    assert _lev1("SUBTOTAL", "SUBTOTALS")  # insert 1
    assert _lev1("SUBTOTAL", "SUBTPTAL")  # substitute 1
    assert not _lev1("SUBTOTAL", "SUBTOTALSXX")  # two inserts
    assert not _lev1("SUBTOTAL", "BTOTALXX")  # two-letter drift


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


def test_currency_usd_default_when_no_signal():
    ex = extract_with_rules(row_of("TOTAL", "27.07", y=400))
    assert ex.currency == "USD"


# --- currency: "$" is ambiguous, regional markers must win ------------------
# Every foreign receipt in the corpus read as USD because "$" was counted as a
# USD vote. AU/NZ/CA/SG all print "$", so it carries no information on its own.


def test_currency_dollar_sign_alone_is_usd():
    ex = extract_with_rules(row_of("TOTAL", "$27.07", y=400))
    assert ex.currency == "USD"


def test_currency_abn_marks_aud_despite_dollar_sign():
    """Kmart: an Australian Business Number and only "$" glyphs."""
    lines = row_of("KmartAustraliaLtd", y=10)
    lines += row_of("ABN73004700485", y=50)  # OCR glues ABN to the digits
    lines += row_of("Total", "$2.020.90", y=400)
    ex = extract_with_rules(lines)
    assert ex.currency == "AUD"


def test_currency_abn_detected_without_word_boundary():
    """A trailing \\b never matches "ABN73004700485" — regression guard."""
    ex = extract_with_rules(row_of("ABN73004700485", "$10.00", y=10))
    assert ex.currency == "AUD"


def test_currency_uk_vat_marks_gbp_when_pound_sign_lost():
    """Willow Fork: OCR dropped every "£", leaving VAT + a London address."""
    lines = row_of("124 Market Street,London,UK", y=10)
    lines += row_of("VATNo:987654321", y=50)
    lines += row_of("Total", "79.44", y=400)
    ex = extract_with_rules(lines)
    assert ex.currency == "GBP"


def test_currency_vat_without_uk_marker_is_eur():
    ex = extract_with_rules(row_of("VAT (19%)", "11.40", y=50))
    assert ex.currency == "EUR"


def test_currency_explicit_iso_code_outranks_symbols():
    """One "AUD" beats any number of "$" — ordered resolution, not counting."""
    lines = row_of("$5.00", "$6.00", "$7.00", y=10)
    lines += row_of("TOTAL AUD", "$18.00", y=50)
    ex = extract_with_rules(lines)
    assert ex.currency == "AUD"


def test_currency_gst_alone_does_not_imply_aud():
    """GST is levied by AU, NZ, IN, CA and SG — not a currency signal."""
    ex = extract_with_rules(row_of("GST", "1.50", y=50))
    assert ex.currency == "USD"


# --- split-decimal recovery -------------------------------------------------
# Walmart: OCR read "84.16" as two adjacent tokens "84" "16" because the decimal
# point broke the token instead of merely vanishing.


def _adjacent(label, dollars, cents, y):
    """Label, then two digit tokens flush against each other in the amount column."""
    toks = [tok(label, 10, y, 90, y + 12)]
    toks.append(tok(dollars, 292, y, 305, y + 12))
    toks.append(tok(cents, 305, y, 321, y + 12))  # gap == 0
    return toks


def test_split_decimal_subtotal_is_rejoined():
    lines = _adjacent("SUBYOTAL", "84", "16", y=298)
    lines += row_of("TOTAL", "90.32", y=316)
    ex = extract_with_rules(lines)
    assert ex.subtotal == 84.16


def test_split_decimal_requires_adjacency():
    """A real quantity column is separated by space and must not be welded."""
    toks = [tok("ITEM", 10, 100, 90, 112)]
    toks.append(tok("3", 150, 100, 160, 112))  # qty column, far left
    toks.append(tok("99", 300, 100, 316, 112))  # unrelated column
    from app.services.ocr_rules import _join_split_decimal, group_rows

    row = group_rows(toks)[0]
    assert _join_split_decimal(row) is None


def test_split_decimal_only_joins_two_digit_cents():
    toks = [tok("X", 10, 100, 40, 112)]
    toks.append(tok("84", 292, 100, 305, 112))
    toks.append(tok("163", 305, 100, 327, 112))  # 3 digits: not cents
    from app.services.ocr_rules import _join_split_decimal, group_rows

    assert _join_split_decimal(group_rows(toks)[0]) is None


# --- arithmetic tax fallback ------------------------------------------------
# Rows are spaced 100px apart on purpose: the corpus's real y-values (298/306/316)
# are closer than one token height, so reusing them here silently merged all three
# into a single row and the assertions passed for the wrong reason.


def test_tax_derived_when_row_amount_unreadable():
    """ "TAX1 8250% 16" loses the leading "6."; tax = total - subtotal recovers it."""
    lines = row_of("SUBTOTAL", "84.16", y=100)
    lines += row_of("TAX1", "8250%", y=200)  # labeled tax row, no usable money
    lines += row_of("TOTAL", "90.32", y=300)
    ex = extract_with_rules(lines)
    assert ex.subtotal == 84.16
    assert ex.total == 90.32
    assert ex.tax == 6.16


def test_tax_not_derived_without_a_tax_row():
    """No labeled tax row means the gap is something else — leave tax at zero."""
    lines = row_of("SUBTOTAL", "84.16", y=100)
    lines += row_of("TOTAL", "90.32", y=300)
    ex = extract_with_rules(lines)
    assert ex.subtotal == 84.16 and ex.total == 90.32  # fixture really did parse
    assert ex.tax == 0.0


def test_tax_not_derived_when_gap_is_implausible():
    """A 60% gap is a tip or another item, not tax — refuse rather than invent."""
    lines = row_of("SUBTOTAL", "100.00", y=100)
    lines += row_of("TAX", "%", y=200)
    lines += row_of("TOTAL", "160.00", y=300)
    ex = extract_with_rules(lines)
    assert ex.subtotal == 100.00 and ex.total == 160.00
    assert ex.tax == 0.0


def test_derived_tax_never_overrides_a_read_tax():
    lines = row_of("SUBTOTAL", "84.16", y=100)
    lines += row_of("TAX", "6.16", y=200)
    lines += row_of("TOTAL", "90.32", y=300)
    ex = extract_with_rules(lines)
    assert ex.tax == 6.16


# --- item block boundary ----------------------------------------------------


def test_money_label_above_items_does_not_truncate_block():
    """Costco's "TF Member 111997457766" classifies as a tax row and sat above
    every item; the block used to end there, discarding all of them."""
    lines = row_of("COSTCO WHOLESALE", y=100)
    lines += row_of("TF Member 111997457766", y=200)  # misreads as a tax row
    lines += row_of("1778788 KSWTR40PK", "3.99", y=300)
    lines += row_of("1224482 GOPI PANEER", "9.99", y=400)
    lines += row_of("SUBTOTAL", "13.98", y=500)
    lines += row_of("TOTAL", "13.98", y=600)
    ex = extract_with_rules(lines)
    assert len(ex.line_items) == 2
    assert {round(li["total_price"], 2) for li in ex.line_items} == {3.99, 9.99}


def test_real_money_block_after_items_still_ends_the_block():
    """The guard must not swallow the genuine subtotal/total rows as items."""
    lines = row_of("STORE", y=100)
    lines += row_of("WIDGET", "5.00", y=200)
    lines += row_of("SUBTOTAL", "5.00", y=300)
    lines += row_of("TAX", "0.50", y=400)
    lines += row_of("TOTAL", "5.50", y=500)
    ex = extract_with_rules(lines)
    assert len(ex.line_items) == 1
    assert ex.subtotal == 5.00 and ex.tax == 0.50 and ex.total == 5.50


# --- fused rows, identifier rows, grouped amounts, real vs ghost duplicates ---


def test_fused_row_price_and_description_split():
    """Tight line spacing makes OCR emit the whole line as ONE token."""
    row = group_rows(
        [tok("Ribeye Steak(10oz)w/Peppecorn Sauce 21,50", 10, 100, 400, 120)]
    )
    li = line_items_from_row(row[0])
    assert li is not None
    assert li["total_price"] == pytest.approx(21.50)
    assert "Ribeye" in li["description"]
    assert "21,50" not in li["description"]  # price stripped out of the text


def test_fused_row_absorbs_pound_misread_as_letter():
    """ "£17,90" is frequently OCR'd "f17,90"."""
    row = group_rows(
        [tok("Pan-Seared Salmon w/New Potatoes f17,90", 10, 100, 400, 120)]
    )
    li = line_items_from_row(row[0])
    assert li["total_price"] == pytest.approx(17.90)


def test_identifier_row_is_not_a_priced_item():
    """ "SKU:933545678901" — trailing digits are the code, not 0.01."""
    row = group_rows([tok("SKU:933545678901", 10, 100, 200, 120)])
    assert line_items_from_row(row[0]) is None


def test_grouped_amount_not_split_as_two_prices():
    """ "$1.997.00" is 1997.00 (grouped), not a glued $1.99 + $7.00."""
    lines = row_of("Limited Edition Chihuahua", "$1.997.00", y=100)
    lines += row_of("Total", "$1.997.00", y=300)
    ex = extract_with_rules(lines)
    assert ex.total == pytest.approx(1997.00)
    assert ex.line_items[0]["total_price"] == pytest.approx(1997.00)


def test_repeated_purchase_at_normal_spacing_survives():
    """Buying the same SKU three times prints three lines — keep all three."""
    lines = row_of("STORE", y=10)
    for i, y in enumerate((300, 334, 368)):  # ~34px apart, real line spacing
        lines += row_of("1778788 KSWTR40PK", "3.99", y=y)
    lines += row_of("TOTAL", "11.97", y=500)
    ex = extract_with_rules(lines)
    assert len(ex.line_items) == 3


def test_ghost_duplicate_at_same_y_is_still_collapsed():
    """The same physical line detected twice lands on top of itself."""
    lines = row_of("STORE", y=10)
    lines += row_of("1778788 KSWTR40PK", "3.99", y=300)
    lines += row_of("1778788 KSWTR40PK", "3.99", y=302)  # 2px — a re-read
    lines += row_of("TOTAL", "3.99", y=500)
    ex = extract_with_rules(lines)
    assert len(ex.line_items) == 1
