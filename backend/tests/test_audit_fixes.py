"""What the October 2026 audit found, each kept fixed."""

import pytest
from fastapi.testclient import TestClient

from app.config.settings import get_settings
from app.db.session import get_db
from app.main import app
from app.services import notify
from tests.test_direct_splits import _receipt
from tests.test_notifications import API, _account, _lake_trip, _uid


@pytest.fixture()
def client(db_session):
    app.dependency_overrides[get_db] = lambda: db_session
    yield TestClient(app)
    app.dependency_overrides.clear()


def _login(client, email, password="pw12345"):
    return client.post(
        f"{API}/auth/login", data={"username": email, "password": password}
    )


def test_an_email_is_one_account_whatever_its_capitals(client):
    signed_up = client.post(
        f"{API}/auth/register",
        json={"email": "Ben.Carter@Gmail.com", "password": "pw12345"},
    )
    assert signed_up.status_code == 200
    assert _login(client, "ben.carter@gmail.com").status_code == 200
    assert _login(client, " BEN.CARTER@gmail.com").status_code == 200
    again = client.post(
        f"{API}/auth/register",
        json={"email": "ben.carter@gmail.com", "password": "pw12345"},
    )
    assert again.status_code == 409


def test_an_older_account_saved_with_capitals_still_logs_in(client, db_session):
    from app.core.security import hash_password
    from app.models import User

    db_session.add(
        User(email="Old.Timer@x.com", hashed_password=hash_password("pw12345"))
    )
    db_session.commit()
    assert _login(client, "old.timer@x.com").status_code == 200


def test_signing_up_needs_a_real_password(client):
    out = client.post(f"{API}/auth/register", json={"email": "a@x.com", "password": ""})
    assert out.status_code == 422


def test_one_address_trying_many_emails_is_slowed_down(client):
    limit = get_settings().rate_limit_login_per_ip_15min
    codes = [_login(client, f"nobody{n}@x.com").status_code for n in range(limit + 1)]
    assert codes[:limit] == [401] * limit and codes[-1] == 429


def test_deleting_a_receipt_takes_it_off_its_tabs(client, db_session):
    ada = _account(client, "ada@x.com", "Ada", "212-555-0100")
    _account(client, "ben@x.com", "Ben", "415-555-0199")
    tab = _lake_trip(client, ada, {"name": "Ben", "phone": "415-555-0199"})
    one, two = (_receipt(db_session, _uid(db_session, "ada@x.com"), 30) for _ in "12")
    for receipt in (one, two):
        client.post(
            f"{API}/splits/groups/{tab['id']}/splits",
            headers=ada,
            json={"receipt_id": receipt.id, "paid_by": "Ada", "mode": "even"},
        )
    notify.emailed.clear()

    client.delete(f"{API}/receipts/{one.id}", headers=ada)
    client.post(
        f"{API}/receipts/bulk",
        headers=ada,
        json={"receipt_ids": [two.id], "action": "delete"},
    )
    summary = client.get(f"{API}/splits/groups/{tab['id']}/summary", headers=ada)
    assert summary.json()["splits"] == []
    assert summary.json()["suggested_settlements"] == []
    assert [m["subject"] for m in notify.emailed] == [
        "Ada removed Costco from Lake trip"
    ] * 2


def _paid(client, db, ada, ben):
    """Ben marks that he paid Ada his $10 of a $30 Lake trip split."""
    tab = _lake_trip(
        client,
        ada,
        {"name": "Ben", "phone": "415-555-0199"},
        {"name": "Cara", "phone": "646-555-0177"},
    )
    receipt = _receipt(db, _uid(db, "ada@x.com"), 30)
    client.post(
        f"{API}/splits/groups/{tab['id']}/splits",
        headers=ada,
        json={"receipt_id": receipt.id, "paid_by": "Ada", "mode": "even"},
    )
    row = next(
        r
        for r in client.get(
            f"{API}/splits/groups/{tab['id']}/summary", headers=ben
        ).json()["suggested_settlements"]
        if r["from"] == "Ben"
    )
    out = client.post(
        f"{API}/splits/groups/{tab['id']}/settlements",
        headers=ben,
        json={
            "from_member_id": row["from_id"],
            "to_member_id": row["to_id"],
            "amount": row["amount"],
        },
    ).json()
    return tab, out["settlements"][0]["id"]


def test_only_the_people_in_a_payment_can_undo_it(client, db_session):
    ada = _account(client, "ada@x.com", "Ada", "212-555-0100")
    ben = _account(client, "ben@x.com", "Ben", "415-555-0199")
    cara = _account(client, "cara@x.com", "Cara", "646-555-0177")
    tab, payment = _paid(client, db_session, ada, ben)
    url = f"{API}/splits/groups/{tab['id']}/settlements/{payment}"
    notify.emailed.clear()

    assert client.delete(url, headers=cara).status_code == 403
    assert client.delete(url, headers=ada).status_code == 200
    (mail,) = notify.emailed
    assert mail["to"] == "ben@x.com"
    assert mail["subject"] == "Ada undid Ben paying Ada $10.00"


def test_a_change_sent_from_another_website_with_the_cookie_is_refused(client):
    client.post(
        f"{API}/auth/register", json={"email": "ada@x.com", "password": "pw12345"}
    )
    assert client.cookies.get("rw_access")  # signed in by cookie only
    body = {"intent": "splits"}
    evil = client.post(
        f"{API}/auth/set-intent", json=body, headers={"Origin": "https://evil.example"}
    )
    assert evil.status_code == 403
    ours = get_settings().allowed_origins()[0]
    assert (
        client.post(
            f"{API}/auth/set-intent", json=body, headers={"Origin": ours}
        ).status_code
        == 200
    )
    # Reading is fine from anywhere (CORS keeps the answer from other sites).
    me = client.get(f"{API}/auth/me", headers={"Origin": "https://evil.example"})
    assert me.status_code == 200


def test_notifications_go_out_after_the_answer(client, monkeypatch):
    sent = []
    monkeypatch.setattr(notify, "emailed", None)
    monkeypatch.setattr(notify._pool, "submit", lambda *job: sent.append(job))
    ada = _account(client, "ada@x.com", "Ada", "212-555-0100")
    _account(client, "ben@x.com", "Ben", "415-555-0199")
    _lake_trip(client, ada, {"name": "Ben", "phone": "415-555-0199"})
    ((deliver, user_id, title, *_),) = sent
    assert deliver is notify._deliver_alone
    assert title == "Ada added you to Lake trip"


def test_opening_a_tab_costs_the_same_queries_however_many_purchases(
    client, db_session
):
    from sqlalchemy import event

    from app.services import split_service

    ada = _account(client, "ada@x.com", "Ada", "212-555-0100")
    tab = _lake_trip(client, ada, {"name": "Ben"}, {"name": "Cara"})
    uid = _uid(db_session, "ada@x.com")

    def add(n):
        for _ in range(n):
            receipt = _receipt(db_session, uid, 30)
            client.post(
                f"{API}/splits/groups/{tab['id']}/splits",
                headers=ada,
                json={"receipt_id": receipt.id, "paid_by": "Ada", "mode": "even"},
            )

    def queries():
        count = [0]

        def tick(*_):
            count[0] += 1

        engine = db_session.get_bind()
        event.listen(engine, "before_cursor_execute", tick)
        split_service.group_summary(db_session, tab["id"], viewer_id=uid)
        split_service.owner_net_balances(db_session, uid)
        event.remove(engine, "before_cursor_execute", tick)
        return count[0]

    add(2)
    few = queries()
    add(20)
    assert queries() == few


def _old_account(db, email, password="pw12345", phone=None):
    from app.core.security import hash_password
    from app.models import User

    user = User(email=email, hashed_password=hash_password(password), phone=phone)
    db.add(user)
    db.commit()
    return user


def test_two_old_accounts_for_one_email_log_into_the_set_up_one(client, db_session):
    """Made before emails were lower-cased: the empty one mustn't win."""
    empty = _old_account(db_session, "sri@x.com")
    set_up = _old_account(db_session, "Sri@x.com", phone="+14155550123")
    for typed in ("sri@x.com", "Sri@x.com", "SRI@X.COM"):
        token = _login(client, typed).json()["access_token"]
        me = client.get(
            f"{API}/auth/me", headers={"Authorization": f"Bearer {token}"}
        ).json()
        assert me["id"] == set_up.id, typed
    assert empty.id != set_up.id


def test_two_old_accounts_with_different_passwords_each_still_log_in(
    client, db_session
):
    first = _old_account(db_session, "sri@x.com", "first-pw", phone="+14155550123")
    second = _old_account(db_session, "Sri@x.com", "second-pw")
    for password, account in (("first-pw", first), ("second-pw", second)):
        token = _login(client, "SRI@x.com", password).json()["access_token"]
        me = client.get(
            f"{API}/auth/me", headers={"Authorization": f"Bearer {token}"}
        ).json()
        assert me["id"] == account.id


def test_a_deleted_budget_or_view_can_be_made_again(client):
    """A deleted one used to keep its slot: making it again was a 500, which
    the app showed as "Failed to fetch"."""
    ada = _account(client, "ada@x.com", "Ada", "212-555-0100")
    monthly = {"level": "total", "period": "monthly", "amount": 500}
    first = client.post(f"{API}/budgets/", headers=ada, json=monthly).json()
    client.delete(f"{API}/budgets/{first['id']}", headers=ada)
    again = client.post(f"{API}/budgets/", headers=ada, json={**monthly, "amount": 600})
    assert again.status_code == 201, again.text
    assert [b["limit"] for b in client.get(f"{API}/budgets/", headers=ada).json()] == [
        600.0
    ]

    view = {"name": "Coffee", "filters": {}}
    made = client.post(f"{API}/saved-views/", headers=ada, json=view).json()
    client.delete(f"{API}/saved-views/{made['id']}", headers=ada)
    assert client.post(f"{API}/saved-views/", headers=ada, json=view).status_code == 201
