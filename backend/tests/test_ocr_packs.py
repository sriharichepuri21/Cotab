from app.services.ocr_packs import detect_pack, extract_with_pack
from app.services.ocr_rules import OcrLine


def tok(text, x1, y1, x2, y2, conf=0.93):
    return OcrLine(text=text, conf=conf, box=[[x1, y1], [x2, y1], [x2, y2], [x1, y2]])


BASE = [
    tok("KmartAustraliaLtd", 10, 10, 260, 45),
    tok("Total", 10, 420, 90, 440),
    tok("$2020.90", 400, 420, 480, 440),
]


def test_detects_glued_kmart_token():
    # "KmartAustraliaLtd" comes through as one Ran tokens (no space) — the regex
    # without word boundaries finds it.
    lines = BASE + [tok("MelissaMitchell $19.95", 10, 150, 300, 170)]
    pack = detect_pack(lines)
    assert pack is not None
    assert pack.name == "Kmart"


def test_detects_spaced_costco():
    lines = [
        tok("COSTCO WHOLESALE", 10, 10, 260, 45),
        tok("COSTCO", 10, 10, 260, 45),  # could be split too
        tok("TOTAL", 10, 420, 90, 440),
        tok("81.02", 400, 420, 460, 440),
    ]
    pack = detect_pack(lines)
    assert pack is not None
    assert pack.name == "Costco"
    ex = extract_with_pack(pack, lines)
    assert ex.merchant == "Costco"


def test_detects_willow_fork_bistro():
    # comma-decimal labels and explicit GBP
    lines = [
        tok("THE WILLOW FORK BISTRO", 10, 10, 260, 45),
        tok("124 Market Street, London, UK", 10, 60, 260, 80),
        tok("Total", 10, 400, 90, 440),
        tok("£79,44", 400, 400, 460, 440),
    ]
    pack = detect_pack(lines)
    assert pack is not None
    assert pack.name == "The Willow Fork Bistro"


def test_detects_courtyard_marriott_over_address():
    # The Marriott corpus proves the address row must not win even when it's
    # near-matching size. The pack fingerprint must carry precedence.
    lines = [
        tok("COURTYARD BY MARRIOTT", 10, 10, 260, 45),
        tok(
            "11010 Ne Bthst", 10, 40, 260, 60
        ),  # by itself this would read as merchant header
        tok("Total", 10, 420, 90, 440),
        tok("$42.24", 400, 420, 460, 440),
    ]
    pack = detect_pack(lines)
    assert pack is not None
    assert pack.name == "Courtyard by Marriott"
    ex = extract_with_pack(pack, lines)
    assert ex.merchant == "Courtyard by Marriott"
    # "11010 Ne Bthst" must not be treated as the merchant


def test_trader_joe_and_walmart_detection():
    for lines, want in [
        (
            [tok("Walmart*", 10, 10, 260, 45), tok("GRAPE 2.48N", 10, 100, 300, 120)],
            "Walmart",
        ),
        (
            [
                tok("Save money. Live better.", 10, 40, 260, 60),
                tok("TOTAL", 10, 420, 90, 440),
                tok("90.32", 400, 420, 460, 440),
            ],
            "Walmart",
        ),
        (
            [
                tok("Trader Joe's", 10, 10, 260, 45),
                tok("TOTAL", 10, 420, 90, 440),
                tok("9.99", 400, 420, 460, 440),
            ],
            "Trader Joe's",
        ),
    ]:
        pack = detect_pack(lines)
        assert pack is not None and pack.name == want
