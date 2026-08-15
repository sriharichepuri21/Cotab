"""Saved views CRUD and bulk receipt actions, over HTTP.

These go through TestClient rather than calling functions directly because the
things most likely to break are ownership scoping and status codes, and both
only exist at the route layer.
"""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.db.session import get_db
from app.main import app
from app.models import Receipt, User


@pytest.fixture()
def client(db_session):
    app.dependency_overrides[get_db] = lambda: db_session
    # Not `with TestClient(app)`: the lifespan waits ~13s on unreachable LocalStack.
    yield TestClient(app)
    app.dependency_overrides.clear()


def _register(client, email):
    r = client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "pw12345", "full_name": "T"},
    )
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _mk(db, user_id, merchant="Shop", total=10.0, category="other"):
    r = Receipt(
        user_id=user_id,
        merchant=merchant,
        total=total,
        subtotal=total,
        currency="USD",
        category=category,
        status="extracted",
        purchased_at=datetime.now(timezone.utc) - timedelta(days=1),
    )
    db.add(r)
    db.commit()
    db.refresh(r)
    return r


def _uid(db, email):
    return db.query(User).filter(User.email == email).one().id


# --- saved views ------------------------------------------------------------


def test_saved_views_require_auth(client):
    assert client.get("/api/v1/saved-views/").status_code == 401


def test_create_and_list_saved_view(client):
    h = _register(client, "sv1@example.com")
    r = client.post(
        "/api/v1/saved-views/",
        json={
            "name": "Coffee this month",
            "filters": {"q": "coffee", "category": "dining"},
        },
        headers=h,
    )
    assert r.status_code == 201
    assert r.json()["name"] == "Coffee this month"

    listed = client.get("/api/v1/saved-views/", headers=h).json()
    assert len(listed) == 1
    assert listed[0]["filters"] == {"q": "coffee", "category": "dining"}


def test_saved_view_round_trips_filters_exactly(client):
    """The point of a saved view: loading it restores the same query."""
    h = _register(client, "sv2@example.com")
    filters = {
        "q": "milk",
        "category": "groceries",
        "min_amount": 5,
        "max_amount": 50,
        "sort": "amount",
        "order": "asc",
    }
    client.post(
        "/api/v1/saved-views/", json={"name": "V", "filters": filters}, headers=h
    )
    assert client.get("/api/v1/saved-views/", headers=h).json()[0]["filters"] == filters


def test_unknown_filter_keys_are_dropped(client):
    """Storing keys the list endpoint ignores would look like a working filter."""
    h = _register(client, "sv3@example.com")
    client.post(
        "/api/v1/saved-views/",
        json={
            "name": "V",
            "filters": {"category": "dining", "evil": "x", "limit": 999},
        },
        headers=h,
    )
    assert client.get("/api/v1/saved-views/", headers=h).json()[0]["filters"] == {
        "category": "dining"
    }


def test_empty_filter_values_are_dropped(client):
    h = _register(client, "sv4@example.com")
    client.post(
        "/api/v1/saved-views/",
        json={
            "name": "V",
            "filters": {"q": "", "category": None, "merchant": "Costco"},
        },
        headers=h,
    )
    assert client.get("/api/v1/saved-views/", headers=h).json()[0]["filters"] == {
        "merchant": "Costco"
    }


def test_saving_same_name_overwrites_instead_of_duplicating(client):
    h = _register(client, "sv5@example.com")
    client.post(
        "/api/v1/saved-views/", json={"name": "V", "filters": {"q": "a"}}, headers=h
    )
    client.post(
        "/api/v1/saved-views/", json={"name": "V", "filters": {"q": "b"}}, headers=h
    )
    rows = client.get("/api/v1/saved-views/", headers=h).json()
    assert len(rows) == 1
    assert rows[0]["filters"] == {"q": "b"}


def test_blank_name_rejected(client):
    h = _register(client, "sv6@example.com")
    r = client.post(
        "/api/v1/saved-views/", json={"name": "   ", "filters": {}}, headers=h
    )
    assert r.status_code == 422


def test_delete_saved_view(client):
    h = _register(client, "sv7@example.com")
    vid = client.post(
        "/api/v1/saved-views/", json={"name": "V", "filters": {}}, headers=h
    ).json()["id"]
    assert client.delete(f"/api/v1/saved-views/{vid}", headers=h).status_code == 204
    assert client.get("/api/v1/saved-views/", headers=h).json() == []


def test_cannot_see_or_delete_another_users_view(client):
    h1 = _register(client, "sv8a@example.com")
    h2 = _register(client, "sv8b@example.com")
    vid = client.post(
        "/api/v1/saved-views/", json={"name": "Mine", "filters": {}}, headers=h1
    ).json()["id"]

    assert client.get("/api/v1/saved-views/", headers=h2).json() == []
    assert client.delete(f"/api/v1/saved-views/{vid}", headers=h2).status_code == 404
    assert len(client.get("/api/v1/saved-views/", headers=h1).json()) == 1  # untouched


# --- bulk actions -----------------------------------------------------------


def test_bulk_categorize(client, db_session):
    h = _register(client, "b1@example.com")
    uid = _uid(db_session, "b1@example.com")
    ids = [_mk(db_session, uid).id for _ in range(3)]

    r = client.post(
        "/api/v1/receipts/bulk",
        json={"receipt_ids": ids, "action": "categorize", "category": "dining"},
        headers=h,
    )
    assert r.status_code == 200
    assert r.json() == {"requested": 3, "updated": 3}
    for rid in ids:
        assert db_session.get(Receipt, rid).category == "dining"


def test_bulk_categorize_accepts_an_alias(client, db_session):
    """ "food" should resolve to the canonical "dining", same as chat does."""
    h = _register(client, "b2@example.com")
    uid = _uid(db_session, "b2@example.com")
    rid = _mk(db_session, uid).id
    client.post(
        "/api/v1/receipts/bulk",
        json={"receipt_ids": [rid], "action": "categorize", "category": "food"},
        headers=h,
    )
    assert db_session.get(Receipt, rid).category == "dining"


def test_bulk_categorize_rejects_unknown_category(client, db_session):
    h = _register(client, "b3@example.com")
    uid = _uid(db_session, "b3@example.com")
    rid = _mk(db_session, uid).id
    r = client.post(
        "/api/v1/receipts/bulk",
        json={"receipt_ids": [rid], "action": "categorize", "category": "zzz"},
        headers=h,
    )
    assert r.status_code == 422
    assert db_session.get(Receipt, rid).category == "other"  # unchanged


def test_bulk_delete_is_soft(client, db_session):
    h = _register(client, "b4@example.com")
    uid = _uid(db_session, "b4@example.com")
    ids = [_mk(db_session, uid).id for _ in range(2)]
    r = client.post(
        "/api/v1/receipts/bulk",
        json={"receipt_ids": ids, "action": "delete"},
        headers=h,
    )
    assert r.json()["updated"] == 2
    for rid in ids:
        row = db_session.get(Receipt, rid)
        assert row is not None and row.deleted_at is not None  # soft, not gone


def test_bulk_silently_skips_receipts_owned_by_someone_else(client, db_session):
    """A forged id must affect nothing and must not reveal that it exists."""
    h1 = _register(client, "b5a@example.com")
    _register(client, "b5b@example.com")
    mine = _mk(db_session, _uid(db_session, "b5a@example.com")).id
    theirs = _mk(db_session, _uid(db_session, "b5b@example.com")).id

    r = client.post(
        "/api/v1/receipts/bulk",
        json={"receipt_ids": [mine, theirs], "action": "delete"},
        headers=h1,
    )
    assert r.json() == {"requested": 2, "updated": 1}
    assert db_session.get(Receipt, theirs).deleted_at is None


def test_bulk_requires_at_least_one_id(client):
    h = _register(client, "b6@example.com")
    r = client.post(
        "/api/v1/receipts/bulk", json={"receipt_ids": [], "action": "delete"}, headers=h
    )
    assert r.status_code == 422


def test_bulk_rejects_unknown_action(client):
    h = _register(client, "b7@example.com")
    r = client.post(
        "/api/v1/receipts/bulk",
        json={"receipt_ids": ["x"], "action": "launch_missiles"},
        headers=h,
    )
    assert r.status_code == 422
