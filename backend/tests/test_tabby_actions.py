"""Tabby doing things in the app: finding a purchase and a person, splitting
a whole receipt or just some items, recording payments, and asking when
something isn't clear instead of guessing."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.api.v1.chat import confirm_proposal
from app.models import ChatActionProposal, Receipt, ReceiptSplit, SplitGroup
from app.services import chat_service, price_memory, split_service, tabby_actions
from tests import fake_gemini

NOW = datetime.now(timezone.utc)


@pytest.fixture(autouse=True)
def _settings(monkeypatch):
    monkeypatch.setattr(chat_service.settings, "gemini_model", "gemini-3.5-flash-lite")
    monkeypatch.setattr(chat_service, "_check_rate_limit", lambda _u: None)


def _line(desc, total, code=None, name=None, qty=1):
    return SimpleNamespace(
        description=desc,
        quantity=qty,
        unit_price=total,
        total_price=total,
        item_code=code,
        item_name=name,
        size=None,
    )


def _receipt(db, user, days_ago, lines, merchant="Costco", tax=0.0):
    subtotal = round(sum(li.total_price for li in lines), 2)
    receipt = Receipt(
        user_id=user.id,
        merchant=merchant,
        total=round(subtotal + tax, 2),
        subtotal=subtotal,
        tax=tax,
        currency="USD",
        status="extracted",
        purchased_at=NOW - timedelta(days=days_ago),
    )
    db.add(receipt)
    db.flush()
    for li in lines:
        db.add(price_memory.make_line(receipt.id, user.id, li))
    db.commit()
    db.refresh(receipt)
    return receipt


@pytest.fixture()
def costco(db_session, user):
    user.full_name = "Ada"
    db_session.commit()
    early = _receipt(
        db_session,
        user,
        19,
        [_line("GOPI PANEER", 9.99, "1224482", "Gopi paneer"), _line("EGGS", 3.69)],
    )
    late = _receipt(
        db_session,
        user,
        0,
        [
            _line("GOPI PANEER", 9.99, "1224482", "Gopi paneer"),
            _line("ORG ATAULFO", 8.49, "1018249", "Organic Ataulfo mangoes"),
            _line("KSULTRPAC152", 19.99, "1054838", "Kirkland laundry pacs"),
        ],
    )
    return early, late


def _paneer_line(receipt):
    return next(li.id for li in receipt.line_items if "PANEER" in li.description)


# ---------- finding ----------


def test_find_purchases_by_item_store_and_day(db_session, user, costco):
    early, late = costco
    out = tabby_actions.find_purchases(db_session, user.id, item="paneer")
    assert out["status"] == "ok" and out["data"]["count"] == 2
    day = late.purchased_at.date().isoformat()
    out = tabby_actions.find_purchases(db_session, user.id, item="paneer", date=day)
    found = out["data"]["purchases"]
    assert [p["receipt_id"] for p in found] == [late.id]
    assert [i["name"] for i in found[0]["items"]] == ["Gopi paneer"]
    assert (
        tabby_actions.find_purchases(db_session, user.id, store="target")["status"]
        == "empty"
    )


def test_find_people_matches_names_on_tabs(db_session, user, costco):
    split_service.direct_tab(db_session, user.id, "Ada", [("Ben Rivera", None)])
    out = tabby_actions.find_people(db_session, user.id, "ben")
    assert out["data"]["people"][0]["name"] == "Ben Rivera"
    assert out["data"]["people"][0]["tabs"] == ["You & Ben Rivera"]


# ---------- splitting ----------


def test_split_one_product_from_a_day_with_a_person(db_session, user, costco):
    _, late = costco
    prepared = tabby_actions.prepare_split(
        db_session,
        user.id,
        {"receipt_id": late.id, "people": ["Ben"], "item_ids": [_paneer_line(late)]},
    )
    assert prepared["status"] == "ok", prepared
    data = prepared["data"]
    assert data["shares"] == {"Ada": 33.48, "Ben": 4.99}
    assert data["summary"].startswith(
        "Split Gopi paneer ($9.99) with Ben. Ben owes you $4.99."
    )
    assert "on You & Ben" in data["summary"]
    # Nothing saved until the person confirms.
    assert db_session.query(ReceiptSplit).count() == 0

    done = tabby_actions.split_purchase(db_session, user.id, **data["plan"])
    assert done["status"] == "ok", done
    assert done["data"]["tab"] == "You & Ben"
    summary = split_service.group_summary(db_session, done["data"]["group_id"])
    row = summary["suggested_settlements"][0]
    assert (row["from"], row["to"], row["amount"]) == ("Ben", "Ada", 4.99)


def test_a_whole_receipt_splits_evenly_onto_the_same_friend_tab(
    db_session, user, costco
):
    early, late = costco
    first = tabby_actions.prepare_split(
        db_session, user.id, {"receipt_id": early.id, "people": ["Ben"]}
    )["data"]
    tab = tabby_actions.split_purchase(db_session, user.id, **first["plan"])["data"]
    second = tabby_actions.prepare_split(
        db_session, user.id, {"receipt_id": late.id, "people": ["ben"]}
    )["data"]
    assert "on You & Ben" in second["summary"]
    again = tabby_actions.split_purchase(db_session, user.id, **second["plan"])["data"]
    assert again["group_id"] == tab["group_id"]
    assert db_session.query(SplitGroup).count() == 1


def test_splitting_the_same_receipt_twice_on_a_tab_asks_first(db_session, user, costco):
    _, late = costco
    plan = tabby_actions.prepare_split(
        db_session, user.id, {"receipt_id": late.id, "people": ["Ben"]}
    )["data"]["plan"]
    tabby_actions.split_purchase(db_session, user.id, **plan)
    again = tabby_actions.prepare_split(
        db_session, user.id, {"receipt_id": late.id, "people": ["Ben"]}
    )
    assert again["status"] == "needs_clarification"
    assert "already split" in again["hint"]


def test_two_people_with_the_same_first_name_are_asked_about(db_session, user, costco):
    _, late = costco
    split_service.direct_tab(db_session, user.id, "Ada", [("Sam Lee", None)])
    split_service.direct_tab(db_session, user.id, "Ada", [("Sam Ortiz", None)])
    out = tabby_actions.prepare_split(
        db_session, user.id, {"receipt_id": late.id, "people": ["Sam"]}
    )
    assert out["status"] == "needs_clarification"
    assert set(out["data"]["options"]) == {"Sam Lee", "Sam Ortiz"}


def test_items_from_another_receipt_are_refused(db_session, user, costco):
    early, late = costco
    out = tabby_actions.prepare_split(
        db_session,
        user.id,
        {"receipt_id": late.id, "people": ["Ben"], "item_ids": [_paneer_line(early)]},
    )
    assert out["status"] == "error"


def test_someone_else_paid(db_session, user, costco):
    _, late = costco
    data = tabby_actions.prepare_split(
        db_session,
        user.id,
        {"receipt_id": late.id, "people": ["Ben"], "paid_by": "Ben"},
    )["data"]
    assert "Ada owes Ben" in data["summary"]


# ---------- settling up ----------


def test_ben_paid_me_back(db_session, user, costco):
    early, _ = costco
    plan = tabby_actions.prepare_split(
        db_session, user.id, {"receipt_id": early.id, "people": ["Ben"]}
    )["data"]["plan"]
    tab = tabby_actions.split_purchase(db_session, user.id, **plan)["data"]
    prepared = tabby_actions.prepare_settle(db_session, user.id, {"person": "Ben"})
    assert prepared["status"] == "ok"
    assert prepared["data"]["summary"] == (
        "Record that Ben paid you $6.84 on You & Ben. That settles it."
    )
    tabby_actions.settle_up(db_session, user.id, **prepared["data"]["plan"])
    assert (
        split_service.group_summary(db_session, tab["group_id"])[
            "suggested_settlements"
        ]
        == []
    )
    again = tabby_actions.prepare_settle(db_session, user.id, {"person": "Ben"})
    assert again["status"] == "needs_clarification" and "already even" in again["hint"]


def test_paying_more_than_owed_is_questioned(db_session, user, costco):
    early, _ = costco
    plan = tabby_actions.prepare_split(
        db_session, user.id, {"receipt_id": early.id, "people": ["Ben"]}
    )["data"]["plan"]
    tabby_actions.split_purchase(db_session, user.id, **plan)
    out = tabby_actions.prepare_settle(
        db_session, user.id, {"person": "Ben", "amount": 50}
    )
    assert out["status"] == "needs_clarification"


# ---------- the whole conversation ----------


def _ask(db, user, message, session_id=None):
    turn = chat_service.prepare_turn(db, db, user.id, message, session_id, None)
    return turn, list(chat_service.run_turn(turn))


def test_tabby_asks_which_purchase_then_proposes_the_split(
    db_session, user, costco, monkeypatch
):
    early, late = costco
    stream = fake_gemini.Stream(
        [fake_gemini.call("find_purchases", item="paneer")],
        [
            fake_gemini.call(
                "ask_user",
                question="Which paneer?",
                options=["Costco, today ($9.99)", "Costco, 19 days ago ($9.99)"],
            )
        ],
        [fake_gemini.text("I found paneer on two Costco trips. Which one?")],
    )
    monkeypatch.setattr(chat_service.ai_client, "stream", stream)
    turn, events = _ask(db_session, user, "split the paneer with Ben")
    choices = next(e for e in events if e["type"] == "choices")
    assert choices["options"] == [
        "Costco, today ($9.99)",
        "Costco, 19 days ago ($9.99)",
    ]
    assert not any(e["type"] == "proposal" for e in events)

    stream = fake_gemini.Stream(
        [
            fake_gemini.call(
                "split_purchase",
                receipt_id=late.id,
                people=["Ben"],
                item_ids=[_paneer_line(late)],
            )
        ],
        [fake_gemini.text("Here's the split. Confirm it below.")],
    )
    monkeypatch.setattr(chat_service.ai_client, "stream", stream)
    _, events = _ask(db_session, user, "Costco, today ($9.99)", turn.session_id)
    proposal = next(e for e in events if e["type"] == "proposal")["proposal"]
    assert proposal["summary"].startswith(
        "Split Gopi paneer ($9.99) with Ben. Ben owes you $4.99."
    )

    row = db_session.get(ChatActionProposal, proposal["id"])
    out = confirm_proposal(row.id, db_session, user)
    assert out["status"] == "executed" and out["result"]["tab"] == "You & Ben"
    assert db_session.query(ReceiptSplit).count() == 1


def test_an_unclear_action_turns_into_tappable_choices(
    db_session, user, costco, monkeypatch
):
    _, late = costco
    split_service.direct_tab(db_session, user.id, "Ada", [("Sam Lee", None)])
    split_service.direct_tab(db_session, user.id, "Ada", [("Sam Ortiz", None)])
    stream = fake_gemini.Stream(
        [fake_gemini.call("split_purchase", receipt_id=late.id, people=["Sam"])],
        [fake_gemini.text("Which Sam do you mean?")],
    )
    monkeypatch.setattr(chat_service.ai_client, "stream", stream)
    _, events = _ask(db_session, user, "split today's Costco with Sam")
    choices = next(e for e in events if e["type"] == "choices")
    assert set(choices["options"]) == {"Sam Lee", "Sam Ortiz"}
    assert db_session.query(ChatActionProposal).count() == 0


def test_the_odd_cent_stays_with_the_payer_whatever_the_ids():
    item = SimpleNamespace(id="paneer", total_price=9.99)
    for payer, friend in (("a-id", "z-id"), ("z-id", "a-id")):
        shares = split_service.calculate_itemized_split(
            {payer: ["paneer"], friend: ["paneer"]}, [item], 0, payer, total=9.99
        )
        assert shares == {payer: 5.0, friend: 4.99}
        even = split_service.calculate_even_shares(9.99, [friend, payer], paid_by=payer)
        assert even == {payer: 5.0, friend: 4.99}
