"""Price memory: reading item codes and sizes, and comparing each item with
what was paid for it before at the same store."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.db.session import get_db
from app.main import app
from app.models import Receipt
from app.services import insight_service, price_memory

API = "/api/v1"


# ---------- reading a line ----------


@pytest.mark.parametrize(
    "text,expected",
    [
        ("***KSWTR40PK", (40, "ct")),
        ("KSULTRPAC152", (152, "ct")),
        ("GV LG WHT EGG 18CT", (18, "ct")),
        ("EGGS 1DZ", (12, "ct")),
        ("BANANAS 2.5 LB", (2.5, "lb")),
        ("OATLY 32 FL OZ", (32, "oz")),
        ("KS CAGE FREE", (None, None)),
        ("ORG ATAULFO", (None, None)),
        ("GOPI PANEER", (None, None)),
    ],
)
def test_sizes_are_read_only_when_printed(text, expected):
    assert price_memory.parse_size(text) == expected


def test_codes_must_be_plain_digit_runs():
    assert price_memory.clean_code("1778788") == "1778788"
    assert price_memory.clean_code(" 637598 ") == "637598"
    assert price_memory.clean_code("12") is None
    assert price_memory.clean_code("not a code") is None
    assert price_memory.clean_code(None) is None


def test_the_same_item_gets_the_same_key():
    by_code = price_memory.line_fields("KS CAGE FREE", "637598", "Kirkland eggs")
    assert by_code["item_key"] == "c:637598"
    by_text = price_memory.line_fields("***KSWTR40PK")
    assert by_text["item_key"] == "d:kswtr40pk"
    assert (by_text["size_qty"], by_text["size_unit"]) == (40, "ct")
    assert price_memory.store_key("Costco Wholesale #1694") == price_memory.store_key(
        "COSTCO"
    )
    assert price_memory.store_key("Walmart Supercenter") == "walmart"


# ---------- comparing ----------


def _line(desc, total, code=None, qty=1):
    return SimpleNamespace(
        description=desc,
        quantity=qty,
        unit_price=total / qty,
        total_price=total,
        item_code=code,
        item_name=None,
        size=None,
    )


def _receipt(db, user_id, days_ago, lines, merchant="Costco Wholesale", **extra):
    receipt = Receipt(
        user_id=user_id,
        merchant=merchant,
        total=sum(li.total_price for li in lines),
        status="extracted",
        currency="USD",
        purchased_at=datetime.now(timezone.utc) - timedelta(days=days_ago),
        **extra,
    )
    db.add(receipt)
    db.flush()
    for li in lines:
        db.add(price_memory.make_line(receipt.id, user_id, li))
    db.commit()
    db.refresh(receipt)
    return receipt


def _items(db, receipt):
    return {
        i["code"] or i["name"]: i
        for i in price_memory.for_receipt(db, receipt)["items"]
    }


def test_first_visit_just_remembers(db_session, user):
    receipt = _receipt(db_session, user.id, 0, [_line("KS CAGE FREE", 3.99, "637598")])
    memory = price_memory.for_receipt(db_session, receipt)
    assert memory["items"][0]["status"] == "first"
    assert memory["tabby"]["mood"] == "hi"
    assert memory["trip_change"] is None


def test_price_changes_at_the_same_store(db_session, user):
    _receipt(
        db_session,
        user.id,
        60,
        [_line("KS CAGE FREE", 3.69, "637598"), _line("GOPI PANEER", 10.49, "1224482")],
    )
    today = _receipt(
        db_session,
        user.id,
        0,
        [_line("KS CAGE FREE", 3.99, "637598"), _line("GOPI PANEER", 9.99, "1224482")],
    )
    items = _items(db_session, today)
    assert items["637598"]["status"] == "up"
    assert items["637598"]["change"] == 0.30
    assert items["1224482"]["status"] == "down"
    memory = price_memory.for_receipt(db_session, today)
    assert memory["trip_change"] == -0.20
    assert "went up $0.30" in memory["tabby"]["text"]


def test_a_few_cents_is_the_same_price(db_session, user):
    _receipt(db_session, user.id, 30, [_line("ORG ATAULFO", 8.49, "1018249")])
    today = _receipt(db_session, user.id, 0, [_line("ORG ATAULFO", 8.52, "1018249")])
    assert _items(db_session, today)["1018249"]["status"] == "same"


def test_other_stores_are_never_compared(db_session, user):
    _receipt(db_session, user.id, 10, [_line("EGGS", 5.99)], merchant="Walmart")
    today = _receipt(db_session, user.id, 0, [_line("EGGS", 3.99)], merchant="Costco")
    assert _items(db_session, today)["EGGS"]["status"] == "first"


def test_a_big_jump_over_the_usual_price_is_worth_checking(db_session, user):
    for days in (90, 60, 30):
        _receipt(db_session, user.id, days, [_line("GOPI PANEER", 9.99, "1224482")])
    today = _receipt(db_session, user.id, 0, [_line("GOPI PANEER", 11.99, "1224482")])
    memory = price_memory.for_receipt(db_session, today)
    item = memory["items"][0]
    assert item["status"] == "check"
    assert item["usual_price"] == 9.99 and item["times"] == 3
    assert memory["tabby"]["mood"] == "bill-shock"
    assert "usually rings up $9.99" in memory["tabby"]["text"]


def test_repeated_lines_are_one_item_and_discounts_come_off(db_session, user):
    _receipt(db_session, user.id, 20, [_line("***KSWTR40PK", 3.99, "1778788")])
    today = _receipt(
        db_session,
        user.id,
        0,
        [
            _line("***KSWTR40PK", 3.99, "1778788"),
            _line("***KSWTR40PK", 3.99, "1778788"),
            _line("***KSWTR40PK", 3.99, "1778788"),
            _line("/1778788", -3.00, "1778788"),
        ],
    )
    item = _items(db_session, today)["1778788"]
    assert item["quantity"] == 3 and item["lines"] == 3
    assert item["price"] == 2.99 and item["discounted"]
    assert item["status"] == "down"


def test_buying_more_than_usual_is_a_quiet_note_not_an_alarm(db_session, user):
    for days in (40, 20):
        _receipt(db_session, user.id, days, [_line("GOPI PANEER", 9.99, "1224482")])
    today = _receipt(
        db_session,
        user.id,
        0,
        [_line("GOPI PANEER", 9.99, "1224482"), _line("GOPI PANEER", 9.99, "1224482")],
    )
    memory = price_memory.for_receipt(db_session, today)
    item = memory["items"][0]
    assert item["more_than_usual"] is True and item["usual_quantity"] == 1
    assert item["status"] == "same"
    assert memory["tabby"]["mood"] == "cool"
    assert "twice" not in memory["tabby"]["text"]


def test_later_and_deleted_receipts_are_left_out(db_session, user):
    old = _receipt(db_session, user.id, 30, [_line("EGGS", 2.00, "637598")])
    today = _receipt(db_session, user.id, 10, [_line("EGGS", 3.99, "637598")])
    _receipt(db_session, user.id, 1, [_line("EGGS", 9.99, "637598")])
    old.deleted_at = datetime.now(timezone.utc)
    db_session.commit()
    assert _items(db_session, today)["637598"]["status"] == "first"


def test_price_watch_spots_slow_creep(db_session, user):
    for days, price in ((80, 3.49), (50, 3.69), (10, 3.99)):
        _receipt(db_session, user.id, days, [_line("KS CAGE FREE", price, "637598")])
    risen = price_memory.watch(
        db_session, user.id, datetime.now(timezone.utc) - timedelta(days=120)
    )
    assert risen and risen[0]["from"] == 3.49 and risen[0]["to"] == 3.99
    insight_service.compute_for_user(db_session, user.id)
    kinds = {i["kind"]: i for i in insight_service.active_insights(db_session, user.id)}
    assert "price_watch" in kinds
    assert "went up" in kinds["price_watch"]["title"]


# ---------- the API ----------


@pytest.fixture()
def client(db_session):
    app.dependency_overrides[get_db] = lambda: db_session
    yield TestClient(app)
    app.dependency_overrides.clear()


def _register(client, email):
    token = client.post(
        f"{API}/auth/register",
        json={"email": email, "password": "Pw12345!", "full_name": "A"},
    ).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    return headers, client.get(f"{API}/auth/me", headers=headers).json()["id"]


def test_prices_endpoint_is_owner_only(client, db_session):
    ada, ada_id = _register(client, "a@x.com")
    ben, _ = _register(client, "b@x.com")
    receipt = _receipt(db_session, ada_id, 0, [_line("KS CAGE FREE", 3.99, "637598")])
    out = client.get(f"{API}/receipts/{receipt.id}/prices", headers=ada)
    assert out.status_code == 200
    assert out.json()["items"][0]["code"] == "637598"
    assert (
        client.get(f"{API}/receipts/{receipt.id}/prices", headers=ben).status_code
        == 404
    )
    lines = client.get(f"{API}/receipts/{receipt.id}", headers=ada).json()["line_items"]
    assert lines[0]["item_code"] == "637598"


def test_editing_a_line_keeps_its_product_number(client, db_session):
    ada, ada_id = _register(client, "a@x.com")
    receipt = _receipt(db_session, ada_id, 0, [_line("KS CAGE FREE", 3.99, "637598")])
    line = client.get(f"{API}/receipts/{receipt.id}", headers=ada).json()["line_items"][
        0
    ]
    out = client.post(
        f"{API}/receipts/{receipt.id}/review",
        headers=ada,
        json={
            "line_items": [
                {"id": line["id"], "description": "KS CAGE FREE", "total_price": 4.29}
            ]
        },
    )
    assert out.status_code == 200, out.text
    assert out.json()["line_items"][0]["item_code"] == "637598"
