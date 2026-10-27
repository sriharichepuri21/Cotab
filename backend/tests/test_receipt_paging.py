"""Every receipt is reachable: pages plus a total count."""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.core.security import create_access_token
from app.db.session import get_db
from app.main import app
from app.models import Receipt


@pytest.fixture()
def client(db_session):
    app.dependency_overrides[get_db] = lambda: db_session
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture()
def many(db_session, user, other_user):
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    for i in range(130):
        db_session.add(
            Receipt(
                user_id=user.id,
                merchant="Coffee Spot" if i % 10 == 0 else f"Shop {i}",
                total=float(i + 1),
                status="extracted",
                purchased_at=start + timedelta(days=i),
            )
        )
    db_session.add(
        Receipt(user_id=other_user.id, merchant="Theirs", total=1, status="extracted")
    )
    db_session.commit()


def _h(user):
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def test_pages_walk_through_every_receipt(client, user, many):
    seen = []
    offset = 0
    while True:
        r = client.get(f"/api/v1/receipts/?limit=50&offset={offset}", headers=_h(user))
        assert r.status_code == 200
        assert r.headers["x-total-count"] == "130"
        page = r.json()
        if not page:
            break
        seen += [row["id"] for row in page]
        offset += len(page)
    assert len(seen) == len(set(seen)) == 130


def test_old_receipts_are_searchable_past_the_first_page(client, user, many):
    r = client.get("/api/v1/receipts/?q=coffee&limit=5", headers=_h(user))
    assert r.headers["x-total-count"] == "13"
    assert len(r.json()) == 5


def test_small_lists_skip_the_extra_count(client, user, many):
    r = client.get("/api/v1/receipts/?min_amount=129", headers=_h(user))
    assert r.headers["x-total-count"] == "2"
    assert len(r.json()) == 2


def test_the_count_header_is_readable_by_the_app(client, user, many):
    r = client.get(
        "/api/v1/receipts/?limit=1",
        headers={**_h(user), "Origin": "http://localhost:3000"},
    )
    assert "x-total-count" in r.headers.get("access-control-expose-headers", "").lower()


def test_collection_route_works_without_trailing_slash(client, user, many):
    r = client.get(
        "/api/v1/receipts?limit=3", headers=_h(user), follow_redirects=False
    )
    assert r.status_code == 200
    assert len(r.json()) == 3
