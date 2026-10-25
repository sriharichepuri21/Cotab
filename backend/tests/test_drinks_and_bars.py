"""Drinks and Bars & alcohol: their own categories, and drink budgets that
count what receipts actually print ("Caffe Latte", not "coffee")."""

import pytest

from app.services import budget_service as B
from app.services import capture_service, gemini_service, quick_answers
from app.services.categories import CANONICAL_CATEGORIES, _normalize_category
from tests.test_budgets import _budget, _item, _mk


def test_both_are_categories_the_reader_and_the_app_know():
    assert {"drinks", "bars"} <= set(CANONICAL_CATEGORIES)
    assert "drinks" in gemini_service.EXTRACTION_PROMPT
    assert "boba" in gemini_service.EXTRACTION_PROMPT


@pytest.mark.parametrize(
    "said, category",
    [
        ("coffee", "drinks"),
        ("Starbucks", "drinks"),
        ("matcha latte", "drinks"),
        ("boba", "drinks"),
        ("bubble tea", "drinks"),
        ("tea", "drinks"),
        ("drinks", "drinks"),
        ("beer", "bars"),
        ("wine bar", "bars"),
        ("liquor store", "bars"),
        ("alcohol", "bars"),
        ("bar", "bars"),
        ("food", "dining"),
        ("barbecue", "dining"),
        ("dinner at nopa", "dining"),
        ("steakhouse", None),  # "tea" is only a whole word
        ("publix", None),  # so is "pub"
    ],
)
def test_words_people_use(said, category):
    assert _normalize_category(said) == category


@pytest.mark.parametrize(
    "store, category",
    [
        ("Starbucks", "drinks"),
        ("Blue Bottle Coffee", "drinks"),
        ("Peet's Coffee", "drinks"),
        ("Gong Cha", "drinks"),
        ("Tea Station", "drinks"),
        ("Jamba Juice", "drinks"),
        ("Toronado Bar", "bars"),
        ("Anchor Brewing", "bars"),
        ("Total Wine & More", "bars"),
        ("Cafe Rio", "dining"),
        ("Chipotle", "dining"),
        ("Steakhouse 55", "other"),
        ("Publix", "groceries"),
        ("Barnes & Noble", "other"),
    ],
)
def test_a_new_store_is_guessed_by_its_name(db_session, user, store, category):
    assert capture_service.guess_category(db_session, user.id, store) == category


def test_a_scanned_cafe_receipt_counts_toward_a_coffee_budget(db_session, user):
    """The reported bug: a scanned café receipt left a $50 coffee budget at $0
    because no line said "coffee"."""
    receipt = _mk(db_session, user.id, "Blue Bottle Coffee", 15.75, "drinks")
    _item(db_session, receipt, user.id, "CAFFE LATTE", 5.50)
    _item(db_session, receipt, user.id, "Iced Americano", 4.25)
    _item(db_session, receipt, user.id, "Croissant", 6.00)
    coffee = _budget(db_session, user.id, "item", "coffee", 50)
    state = B.evaluate(db_session, user.id, coffee)
    assert state["spent"] == 9.75 and state["remaining"] == 40.25


def test_the_readable_name_counts_when_the_printed_text_is_cryptic(db_session, user):
    receipt = _mk(db_session, user.id, "Starbucks", 6.45, "drinks")
    _item(db_session, receipt, user.id, "GR CF LTE", 6.45)
    receipt.line_items[0].item_name = "Grande caffe latte"
    db_session.commit()
    coffee = _budget(db_session, user.id, "item", "coffee", 50)
    assert B.evaluate(db_session, user.id, coffee)["spent"] == 6.45


def test_a_drinks_budget_counts_every_drinks_receipt(db_session, user):
    _mk(db_session, user.id, "Starbucks", 6.45, "drinks")  # an Apple Pay tap: no lines
    _mk(db_session, user.id, "Gong Cha", 7.10, "drinks")
    _mk(db_session, user.id, "Toronado Bar", 30.00, "bars")
    _mk(db_session, user.id, "Chipotle", 12.00, "dining")
    drinks = _budget(db_session, user.id, "category", "drinks", 50)
    bars = _budget(db_session, user.id, "category", "bars", 100)
    assert B.evaluate(db_session, user.id, drinks)["spent"] == 13.55
    assert B.evaluate(db_session, user.id, bars)["spent"] == 30.0


def test_a_tea_budget_does_not_count_steak(db_session, user):
    receipt = _mk(db_session, user.id, "Grill", 40.0, "dining")
    _item(db_session, receipt, user.id, "RIBEYE STEAK", 32.0)
    _item(db_session, receipt, user.id, "Chai latte", 5.0)
    _item(db_session, receipt, user.id, "Iced tea", 3.0)
    tea = _budget(db_session, user.id, "item", "tea", 30)
    assert B.evaluate(db_session, user.id, tea)["spent"] == 8.0


def test_other_item_budgets_match_as_before(db_session, user):
    receipt = _mk(db_session, user.id, "Costco", 20.0, "groceries")
    _item(db_session, receipt, user.id, "KS PIZZA ROLLS", 12.0)
    _item(db_session, receipt, user.id, "Bananas", 8.0)
    pizza = _budget(db_session, user.id, "item", "pizza", 30)
    assert B.evaluate(db_session, user.id, pizza)["spent"] == 12.0


def test_quick_answers_know_the_new_categories():
    assert quick_answers._CATEGORY_WORDS["drinks"] == "drinks"
    assert quick_answers._CATEGORY_WORDS["bars & alcohol"] == "bars"
    assert quick_answers._CATEGORY_WORDS["alcohol"] == "bars"


def test_a_coffee_category_budget_is_a_drinks_budget(db_session):
    from fastapi.testclient import TestClient

    from app.db.session import get_db
    from app.main import app
    from tests.test_notifications import API, _account

    app.dependency_overrides[get_db] = lambda: db_session
    try:
        client = TestClient(app)
        ada = _account(client, "ada@x.com", "Ada", "212-555-0100")
        out = client.post(
            f"{API}/budgets/",
            headers=ada,
            json={"level": "category", "target": "coffee", "amount": 50},
        )
        assert out.status_code == 201, out.text
        assert out.json()["target"] == "drinks"
    finally:
        app.dependency_overrides.clear()
