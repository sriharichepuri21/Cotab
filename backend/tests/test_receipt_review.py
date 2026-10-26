"""Correcting a receipt: the category has to be one the app knows."""

import pytest
from fastapi.testclient import TestClient

from app.db.session import get_db
from app.main import app
from app.models import Receipt
from tests.test_direct_splits import _receipt
from tests.test_notifications import API, _account, _uid


@pytest.fixture()
def client(db_session):
    app.dependency_overrides[get_db] = lambda: db_session
    yield TestClient(app)
    app.dependency_overrides.clear()


def _review(client, headers, receipt, **body):
    return client.post(
        f"{API}/receipts/{receipt.id}/review", headers=headers, json=body
    )


def test_an_unknown_category_is_refused_and_nothing_changes(client, db_session):
    ada = _account(client, "ada@x.com", "Ada", "212-555-0100")
    receipt = _receipt(db_session, _uid(db_session, "ada@x.com"), 20.0)
    out = _review(client, ada, receipt, category="bills", merchant="Renamed")
    assert out.status_code == 422 and "Unknown category" in out.json()["detail"]
    db_session.refresh(receipt)
    assert receipt.merchant == "Costco"


@pytest.mark.parametrize(
    "said, stored", [("drinks", "drinks"), ("Starbucks", "drinks")]
)
def test_a_known_category_or_word_for_one_is_saved_as_the_category(
    client, db_session, said, stored
):
    ada = _account(client, "ada@x.com", "Ada", "212-555-0100")
    receipt = _receipt(db_session, _uid(db_session, "ada@x.com"), 20.0)
    out = _review(client, ada, receipt, category=said)
    assert out.status_code == 200, out.text
    assert out.json()["category"] == stored
    assert db_session.get(Receipt, receipt.id).category == stored


def test_someone_else_cannot_correct_your_receipt(client, db_session):
    _account(client, "ada@x.com", "Ada", "212-555-0100")
    ben = _account(client, "ben@x.com", "Ben", "415-555-0199")
    receipt = _receipt(db_session, _uid(db_session, "ada@x.com"), 20.0)
    assert _review(client, ben, receipt, total=1).status_code == 404
    db_session.refresh(receipt)
    assert receipt.total == 20.0
