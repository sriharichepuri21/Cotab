"""Splitting by exact amounts, percentages and shares."""

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect

from app.db.session import get_db
from app.main import app
from app.services import split_service
from tests.test_direct_splits import _receipt
from tests.test_migrations import _run_alembic
from tests.test_my_share import _spent
from tests.test_notifications import API, _account, _lake_trip, _uid


@pytest.fixture()
def client(db_session):
    app.dependency_overrides[get_db] = lambda: db_session
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture()
def trip(client, db_session):
    """Ada, Ben and Cara on Lake trip, with a $10.00 receipt of Ada's."""
    ada = _account(client, "ada@x.com", "Ada", "212-555-0100")
    ben = _account(client, "ben@x.com", "Ben", "415-555-0199")
    tab = _lake_trip(
        client, ada, {"name": "Ben", "phone": "415-555-0199"}, {"name": "Cara"}
    )
    receipt = _receipt(db_session, _uid(db_session, "ada@x.com"), 10.0)
    receipt.purchased_at = datetime.now(timezone.utc)
    db_session.commit()
    return ada, ben, tab, receipt


def _save(client, headers, tab, receipt, mode, parts, paid_by="Ada", **extra):
    return client.post(
        f"{API}/splits/groups/{tab['id']}/splits",
        headers=headers,
        json={
            "receipt_id": receipt.id,
            "paid_by": paid_by,
            "mode": mode,
            "parts": parts,
            **extra,
        },
    )


def _summary(client, headers, tab):
    return client.get(
        f"{API}/splits/groups/{tab['id']}/summary", headers=headers
    ).json()


def test_shares_round_with_the_extra_cent_on_the_payer(client, trip):
    ada, _, tab, receipt = trip
    out = _save(client, ada, tab, receipt, "shares", {"Ada": 1, "Ben": 1, "Cara": 1})
    assert out.status_code == 200, out.text
    assert out.json()["shares"] == {"Ada": 3.34, "Ben": 3.33, "Cara": 3.33}


def test_shares_two_one_one(client, trip):
    ada, _, tab, receipt = trip
    out = _save(client, ada, tab, receipt, "shares", {"Ada": 2, "Ben": 1, "Cara": 1})
    assert out.json()["shares"] == {"Ada": 5.0, "Ben": 2.5, "Cara": 2.5}


def test_people_left_out_of_parts_pay_nothing(client, trip):
    ada, _, tab, receipt = trip
    out = _save(client, ada, tab, receipt, "shares", {"Ada": 1, "Ben": 1})
    assert out.json()["shares"] == {"Ada": 5.0, "Ben": 5.0, "Cara": 0.0}


def test_percent_split(client, trip):
    ada, _, tab, receipt = trip
    out = _save(
        client, ada, tab, receipt, "percent", {"Ada": 50, "Ben": 33.33, "Cara": 16.67}
    )
    assert out.status_code == 200, out.text
    assert out.json()["shares"] == {"Ada": 5.0, "Ben": 3.33, "Cara": 1.67}


def test_exact_split(client, trip):
    ada, _, tab, receipt = trip
    out = _save(client, ada, tab, receipt, "exact", {"Ada": 2.43, "Ben": 7.57})
    assert out.status_code == 200, out.text
    assert out.json()["shares"] == {"Ada": 2.43, "Ben": 7.57, "Cara": 0.0}
    (split,) = _summary(client, ada, tab)["splits"]
    assert split["mode"] == "exact"
    assert split["parts"] == {"Ada": 2.43, "Ben": 7.57}
    assert {s["member"]: s["amount"] for s in split["shares"]} == {
        "Ben": 7.57,
        "Cara": 0.0,
    }


def test_a_friend_can_pay(client, trip):
    ada, _, tab, receipt = trip
    out = _save(
        client, ada, tab, receipt, "shares", {"Ada": 1, "Ben": 2}, paid_by="Ben"
    )
    assert out.json()["shares"] == {"Ben": 6.67, "Ada": 3.33, "Cara": 0.0}


@pytest.mark.parametrize(
    "mode, parts, message",
    [
        ("exact", {"Ada": 2.43, "Ben": 0.0}, "These add up to $2.43; $7.57 is left"),
        ("exact", {"Ada": 6, "Ben": 6}, "These add up to $12.00; $2.00 over."),
        ("percent", {"Ada": 50, "Ben": 35}, "These add up to 85%; 15% is left."),
        ("percent", {"Ada": 60, "Ben": 50}, "These add up to 110%; 10% over."),
        ("percent", {"Ada": 50, "Ben": 50.005}, "at most 2 decimals"),
        ("shares", {"Ada": 0, "Ben": 0}, "at least one person a share"),
        ("shares", {"Ada": 1.5, "Ben": 1}, "Shares must be whole numbers"),
        ("exact", {"Ada": 5.005, "Ben": 5}, "fractions of a cent"),
        ("shares", {"Ada": -1, "Ben": 2}, "can't be negative"),
        ("exact", {"Ada": 11, "Ben": -1}, "can't be negative"),
        ("shares", {"Ada": 1, "Zed": 1}, "Zed isn't on this tab"),
        ("shares", {"Ada": 10**9}, "too large"),
    ],
)
def test_bad_parts_are_refused_with_a_reason(
    client, db_session, trip, mode, parts, message
):
    ada, _, tab, receipt = trip
    out = _save(client, ada, tab, receipt, mode, parts)
    assert out.status_code == 400 and message in out.json()["detail"], out.text
    assert _summary(client, ada, tab)["splits"] == []


@pytest.mark.parametrize("mode", ["exact", "percent", "shares"])
def test_these_modes_need_parts(client, trip, mode):
    ada, _, tab, receipt = trip
    out = client.post(
        f"{API}/splits/groups/{tab['id']}/splits",
        headers=ada,
        json={"receipt_id": receipt.id, "paid_by": "Ada", "mode": mode},
    )
    assert out.status_code == 400 and "parts required" in out.json()["detail"]


def test_nan_is_refused(client, trip):
    ada, _, tab, receipt = trip
    out = client.post(
        f"{API}/splits/groups/{tab['id']}/splits",
        headers=ada,
        content='{"receipt_id": "%s", "paid_by": "Ada", "mode": "shares",'
        ' "parts": {"Ada": NaN, "Ben": 1}}' % receipt.id,
    )
    assert out.status_code in (400, 422)
    assert _summary(client, ada, tab)["splits"] == []


def test_editing_redoes_the_split_with_new_parts(client, trip):
    ada, _, tab, receipt = trip
    _save(client, ada, tab, receipt, "shares", {"Ada": 1, "Ben": 1})
    out = _save(
        client, ada, tab, receipt, "percent", {"Ada": 20, "Ben": 80}, replace=True
    )
    assert out.status_code == 200, out.text
    (split,) = _summary(client, ada, tab)["splits"]
    assert split["mode"] == "percent" and split["parts"] == {"Ada": 20, "Ben": 80}
    assert {s["member"]: s["amount"] for s in split["shares"]}["Ben"] == 8.0
    again = _save(client, ada, tab, receipt, "shares", {"Ada": 1})
    assert again.status_code == 409


def test_your_share_of_a_percent_split_is_your_spending(client, db_session, trip):
    ada, ben, tab, receipt = trip
    _save(client, ada, tab, receipt, "percent", {"Ada": 50, "Ben": 30, "Cara": 20})
    assert _spent(client, ada) == 5.0
    assert _spent(client, ben) == 3.0


def test_preview_by_each_mode(client, trip):
    ada, _, _, receipt = trip

    def preview(mode, parts):
        return client.post(
            f"{API}/splits/preview",
            headers=ada,
            json={
                "receipt_id": receipt.id,
                "members": ["Ada", "Ben", "Cara"],
                "paid_by": "Ada",
                "mode": mode,
                "parts": parts,
            },
        ).json()

    assert preview("shares", {"Ada": 1, "Ben": 1, "Cara": 1})["shares"] == {
        "Ada": 3.34,
        "Ben": 3.33,
        "Cara": 3.33,
    }
    assert preview("percent", {"Ada": 25, "Ben": 75})["shares"]["Ben"] == 7.5
    assert preview("exact", {"Ada": 4, "Ben": 6})["shares"]["Ben"] == 6.0
    half = preview("exact", {"Ada": 2.43})
    assert "shares" not in half
    assert half["message"] == "These add up to $2.43; $7.57 is left to assign."
    assert "15% is left" in preview("percent", {"Ada": 85})["message"]


def _correct_total(client, headers, receipt, total):
    out = client.post(
        f"{API}/receipts/{receipt.id}/review", headers=headers, json={"total": total}
    )
    assert out.status_code == 200, out.text


def _amounts(client, headers, tab):
    (split,) = _summary(client, headers, tab)["splits"]
    return {s["member"]: s["amount"] for s in split["shares"]}


def test_a_corrected_total_redoes_shares_from_the_stored_shares(client, trip):
    ada, _, tab, receipt = trip
    _save(client, ada, tab, receipt, "shares", {"Ada": 1, "Ben": 1, "Cara": 1})
    _correct_total(client, ada, receipt, 20)
    assert _amounts(client, ada, tab) == {"Ben": 6.67, "Cara": 6.66}


def test_a_corrected_total_redoes_percentages(client, trip):
    ada, _, tab, receipt = trip
    _save(client, ada, tab, receipt, "percent", {"Ada": 50, "Ben": 30, "Cara": 20})
    _correct_total(client, ada, receipt, 33.33)
    # 16.665 / 9.999 / 6.666: the two spare cents go to the biggest remainders.
    assert _amounts(client, ada, tab) == {"Ben": 10.0, "Cara": 6.67}


def test_a_corrected_total_scales_exact_amounts(client, trip):
    ada, _, tab, receipt = trip
    _save(client, ada, tab, receipt, "exact", {"Ada": 2.5, "Ben": 5, "Cara": 2.5})
    _correct_total(client, ada, receipt, 20)
    assert _amounts(client, ada, tab) == {"Ben": 10.0, "Cara": 5.0}
    _correct_total(client, ada, receipt, 10.01)
    amounts = _amounts(client, ada, tab)
    assert amounts == {"Ben": 5.01, "Cara": 2.5}  # the odd cent: biggest remainder


def test_parts_model_column_survives_migration_round_trip(tmp_path):
    db = tmp_path / "parts.db"
    assert _run_alembic(db, "upgrade", "head").returncode == 0

    def columns():
        insp = inspect(create_engine(f"sqlite:///{db}"))
        return {c["name"] for c in insp.get_columns("receipt_splits")}

    assert "parts" in columns()
    assert _run_alembic(db, "downgrade", "c6e8a0b2d4f6").returncode == 0
    assert "parts" not in columns()
    assert _run_alembic(db, "upgrade", "head").returncode == 0
    assert "parts" in columns()


def test_split_by_parts_is_exact_to_the_cent():
    shares = split_service.split_by_parts(
        "shares", 100.01, {"a": 1, "b": 1, "c": 1}, ["a", "b", "c"]
    )
    assert round(sum(shares.values()), 2) == 100.01
    assert shares["a"] == 33.34


def test_edit_split_shows_rescaled_exact_amounts_that_add_up(client, trip):
    """After the total is corrected, Edit split opens with the new amounts,
    not the old ones ("$10.00 is left to assign")."""
    ada, _, tab, receipt = trip
    _save(client, ada, tab, receipt, "exact", {"Ada": 2.5, "Ben": 5, "Cara": 2.5})
    _correct_total(client, ada, receipt, 20)
    (split,) = _summary(client, ada, tab)["splits"]
    assert split["parts"] == {"Ada": 5.0, "Ben": 10.0, "Cara": 5.0}
