"""Phase 5 split correctness: cents, shared items, tax modes, API and netting."""

from fastapi.testclient import TestClient

from app.db.session import get_db
from app.main import app
from app.models import Receipt, ReceiptLineItem
from app.services.split_service import calculate_even_shares, calculate_itemized_split


def test_even_split_reconciles_awkward_cent():
    shares = calculate_even_shares(10.00, ["a", "b", "c"])
    assert sum(shares.values()) == 10.00
    assert sorted(shares.values()) == [3.33, 3.33, 3.34]


def test_shared_item_and_pro_rata_tax_sum_to_total(db_session, user):
    receipt = Receipt(user_id=user.id, merchant="Cafe", total=11, subtotal=10, tax=1)
    db_session.add(receipt)
    db_session.flush()
    item = ReceiptLineItem(
        receipt_id=receipt.id, user_id=user.id, description="Pizza", total_price=10
    )
    db_session.add(item)
    db_session.commit()
    shares = calculate_itemized_split(
        {"a": [item.id], "b": [item.id]}, [item], 1, "a", total=11
    )
    assert shares == {"a": 5.5, "b": 5.5}


def test_unassigned_item_goes_to_payer_and_even_tax_is_exact(db_session, user):
    receipt = Receipt(user_id=user.id, merchant="Cafe", total=10.01)
    db_session.add(receipt)
    db_session.flush()
    item = ReceiptLineItem(
        receipt_id=receipt.id, user_id=user.id, description="Meal", total_price=9
    )
    db_session.add(item)
    db_session.commit()
    shares = calculate_itemized_split(
        {"me": [], "alex": []}, [item], 1.01, "me", total=10.01, tax_mode="even"
    )
    assert sum(shares.values()) == 10.01
    assert shares["me"] > shares["alex"]


def _client(db_session):
    app.dependency_overrides[get_db] = lambda: db_session
    return TestClient(app)


def _auth(client):
    response = client.post(
        "/api/v1/auth/register",
        json={"email": "split@example.com", "password": "Pw12345!", "full_name": "Ada"},
    )
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_split_flow_public_share_and_net_balance(db_session):
    client, headers = _client(db_session), None
    try:
        headers = _auth(client)
        user_id = client.get("/api/v1/auth/me", headers=headers).json()["id"]
        receipt = Receipt(
            user_id=user_id,
            merchant="Costco",
            total=10,
            subtotal=9,
            tax=1,
            status="extracted",
            currency="USD",
        )
        db_session.add(receipt)
        db_session.commit()
        group_response = client.post(
            "/api/v1/splits/groups",
            headers=headers,
            json={
                "name": "Roommates",
                "my_name": "Ada",
                "members": [{"name": "Alex", "email": "alex@example.com"}],
            },
        )
        assert group_response.status_code == 200
        group = group_response.json()
        assert len(group["share_code"]) == 32
        split = client.post(
            f"/api/v1/splits/groups/{group['id']}/splits",
            headers=headers,
            json={"receipt_id": receipt.id, "paid_by": "Ada", "mode": "even"},
        )
        assert split.status_code == 200 and sum(split.json()["shares"].values()) == 10
        for total in (12, 14):
            prior = Receipt(
                user_id=user_id,
                merchant="Costco",
                total=total,
                subtotal=total,
                status="extracted",
            )
            db_session.add(prior)
            db_session.commit()
            assert (
                client.post(
                    f"/api/v1/splits/groups/{group['id']}/splits",
                    headers=headers,
                    json={"receipt_id": prior.id, "paid_by": "Ada", "mode": "even"},
                ).status_code
                == 200
            )
        fourth = Receipt(
            user_id=user_id,
            merchant="Costco",
            total=16,
            subtotal=16,
            status="extracted",
        )
        db_session.add(fourth)
        db_session.commit()
        suggestion = client.get(
            f"/api/v1/splits/suggestions/{fourth.id}", headers=headers
        ).json()
        assert suggestion["merchant_history_count"] == 3
        assert suggestion["auto_apply"] is True and suggestion["confidence"] == 1
        public = client.get(f"/api/v1/splits/share/{group['share_code']}")
        assert public.status_code == 200 and public.json()["group_name"] == "Roommates"
        assert all("email" not in member for member in public.json()["members"])
        net = client.get("/api/v1/splits/net-balances", headers=headers).json()
        assert net[0]["person"] == "Alex" and net[0]["net"] == 18
    finally:
        app.dependency_overrides.clear()


def test_a_split_receipt_says_which_tab_it_is_on(db_session):
    client = _client(db_session)
    try:
        headers = _auth(client)
        user_id = client.get("/api/v1/auth/me", headers=headers).json()["id"]
        split, alone = (
            Receipt(user_id=user_id, merchant=m, total=10, status="extracted")
            for m in ("Costco", "Cafe")
        )
        db_session.add_all([split, alone])
        db_session.commit()
        group = client.post(
            "/api/v1/splits/groups",
            headers=headers,
            json={"name": "Home", "my_name": "Ada", "members": [{"name": "Alex"}]},
        ).json()
        client.post(
            f"/api/v1/splits/groups/{group['id']}/splits",
            headers=headers,
            json={"receipt_id": split.id, "paid_by": "Ada", "mode": "even"},
        )
        got = client.get(f"/api/v1/receipts/{split.id}", headers=headers).json()
        assert got["split_group_id"] == group["id"] and got["my_share"] == 5
        got = client.get(f"/api/v1/receipts/{alone.id}", headers=headers).json()
        assert got["split_group_id"] is None and got["my_share"] is None
    finally:
        app.dependency_overrides.clear()
