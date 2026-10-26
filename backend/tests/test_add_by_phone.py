"""Adding people to tabs by phone number or email: someone on Cotab joins
straight away; anyone else joins when they sign up with it."""

import pytest
from fastapi.testclient import TestClient

from app.db.session import get_db
from app.main import app
from app.services import split_service

API = "/api/v1"
BEN = "(415) 555-0123"
BEN_E164 = "+14155550123"


@pytest.fixture()
def client(db_session):
    app.dependency_overrides[get_db] = lambda: db_session
    yield TestClient(app)
    app.dependency_overrides.clear()


def _account(client, email, name, phone=None):
    token = client.post(
        f"{API}/auth/register",
        json={"email": email, "password": "pw12345", "full_name": name},
    ).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    if phone:
        assert (
            client.put(
                f"{API}/auth/me/phone", headers=headers, json={"phone": phone}
            ).status_code
            == 200
        )
    return headers


def _tab_with_ben(client, ada, phone=BEN, kind="direct"):
    person = {"name": "Ben", "phone": phone}
    if kind == "direct":
        out = client.post(
            f"{API}/splits/direct",
            headers=ada,
            json={"my_name": "Ada", "members": [person]},
        )
    else:
        out = client.post(
            f"{API}/splits/groups",
            headers=ada,
            json={"name": "Lake trip", "my_name": "Ada", "members": [person]},
        )
    assert out.status_code == 200, out.text
    return out.json()


def _ben(tab):
    return next(m for m in tab["members"] if m["name"] == "Ben")


def test_a_number_nobody_uses_yet_is_not_on_cotab(client):
    ada = _account(client, "ada@x.com", "Ada", "212-555-0100")
    ben = _ben(_tab_with_ben(client, ada))
    assert ben["status"] == "not_on_cotab"
    assert ben["phone"] == BEN_E164 and not ben["joined"]


def test_someone_on_cotab_is_added_straight_away(client):
    ada = _account(client, "ada@x.com", "Ada", "212-555-0100")
    ben_headers = _account(client, "ben@x.com", "Ben", BEN)
    tab = _tab_with_ben(client, ada, kind="group")
    assert _ben(tab)["status"] == "joined" and _ben(tab)["joined"]

    # The tab is in Ben's app, and he's on it as himself.
    (mine,) = client.get(f"{API}/splits/groups", headers=ben_headers).json()
    assert mine["id"] == tab["id"] and not mine["is_owner"]
    summary = client.get(
        f"{API}/splits/groups/{tab['id']}/summary", headers=ben_headers
    ).json()
    assert summary["me"] == _ben(tab)["id"]


def test_only_the_owner_sees_numbers(client, db_session):
    ada = _account(client, "ada@x.com", "Ada", "212-555-0100")
    ben_headers = _account(client, "ben@x.com", "Ben", BEN)
    tab = _tab_with_ben(client, ada, kind="group")
    client.post(
        f"{API}/splits/groups/{tab['id']}/members",
        headers=ada,
        json={"name": "Cara", "phone": "646-555-0188"},
    )

    def cara(headers):
        summary = client.get(
            f"{API}/splits/groups/{tab['id']}/summary", headers=headers
        ).json()
        return next(m for m in summary["members"] if m["name"] == "Cara")

    assert cara(ada)["phone"] == "+16465550188"
    assert cara(ben_headers)["phone"] is None
    assert cara(ben_headers)["status"] == "not_on_cotab"
    groups = client.get(f"{API}/splits/groups", headers=ben_headers).json()
    assert all(m["phone"] is None for g in groups for m in g["members"])


def test_share_links_and_tabby_never_carry_numbers(client, db_session):
    ada = _account(client, "ada@x.com", "Ada", "212-555-0100")
    tab = _tab_with_ben(client, ada, kind="group")
    public = client.get(f"{API}/splits/share/{tab['share_code']}")
    tabby = str(split_service.group_summary(db_session, tab["id"]))
    # Whole numbers, not "555": share codes and ids are random hex.
    for number in ("5550123", "555-0123", "5550100", "555-0100"):
        assert number not in public.text
        # What Tabby reads (and sends to the AI) comes from group_summary.
        assert number not in tabby


def test_bad_numbers_are_refused_before_anything_is_made(client):
    ada = _account(client, "ada@x.com", "Ada", "212-555-0100")
    out = client.post(
        f"{API}/splits/groups",
        headers=ada,
        json={
            "name": "Trip",
            "my_name": "Ada",
            "members": [{"name": "Ben", "phone": "555-01"}],
        },
    )
    assert out.status_code == 400 and out.json()["detail"].startswith("Ben:")
    mine = client.post(
        f"{API}/splits/direct",
        headers=ada,
        json={
            "my_name": "Ada",
            "members": [{"name": "Ben", "phone": "(212) 555-0100"}],
        },
    )
    assert mine.status_code == 400 and "your own number" in mine.json()["detail"]
    assert client.get(f"{API}/splits/groups", headers=ada).json() == []


def test_the_same_number_twice_on_one_tab_is_refused(client):
    ada = _account(client, "ada@x.com", "Ada", "212-555-0100")
    tab = _tab_with_ben(client, ada, kind="group")
    out = client.post(
        f"{API}/splits/groups/{tab['id']}/members",
        headers=ada,
        json={"name": "Benny", "phone": "415.555.0123"},
    )
    assert (
        out.status_code == 409
        and "already in this split, as Ben" in out.json()["detail"]
    )


def test_the_owner_can_add_a_number_later(client):
    ada = _account(client, "ada@x.com", "Ada", "212-555-0100")
    ben_headers = _account(client, "ben@x.com", "Ben", BEN)
    tab = client.post(
        f"{API}/splits/direct",
        headers=ada,
        json={"my_name": "Ada", "members": [{"name": "Ben"}]},
    ).json()
    assert _ben(tab)["status"] == "no_phone"

    out = client.put(
        f"{API}/splits/groups/{tab['id']}/members/{_ben(tab)['id']}/phone",
        headers=ada,
        json={"phone": BEN},
    )
    assert out.status_code == 200 and _ben(out.json())["status"] == "joined"
    assert len(client.get(f"{API}/splits/groups", headers=ben_headers).json()) == 1


def test_only_the_owner_can_set_numbers(client):
    ada = _account(client, "ada@x.com", "Ada", "212-555-0100")
    ben_headers = _account(client, "ben@x.com", "Ben", BEN)
    tab = _tab_with_ben(client, ada, kind="group")
    cara = client.post(
        f"{API}/splits/groups/{tab['id']}/members", headers=ada, json={"name": "Cara"}
    ).json()
    cara_id = next(m["id"] for m in cara["members"] if m["name"] == "Cara")

    out = client.put(
        f"{API}/splits/groups/{tab['id']}/members/{cara_id}/phone",
        headers=ben_headers,
        json={"phone": "646-555-0188"},
    )
    assert out.status_code == 403


def test_signing_up_later_joins_every_tab_your_number_was_put_on(client):
    ada = _account(client, "ada@x.com", "Ada", "212-555-0100")
    cara = _account(client, "cara@x.com", "Cara", "646-555-0100")
    lake = _tab_with_ben(client, ada, kind="group")
    friends = _tab_with_ben(client, cara)
    assert _ben(lake)["status"] == "not_on_cotab"
    ben_headers = _account(client, "ben@x.com", "Ben")
    assert client.get(f"{API}/splits/groups", headers=ben_headers).json() == []

    client.put(f"{API}/auth/me/phone", headers=ben_headers, json={"phone": BEN})
    tabs = {
        g["id"] for g in client.get(f"{API}/splits/groups", headers=ben_headers).json()
    }
    assert tabs == {lake["id"], friends["id"]}
    summary = client.get(
        f"{API}/splits/groups/{lake['id']}/summary", headers=ada
    ).json()
    assert _ben(summary)["status"] == "joined"


def test_adding_numbers_in_bulk_is_limited(client):
    ada = _account(client, "ada@x.com", "Ada", "212-555-0100")
    tab = client.post(
        f"{API}/splits/groups",
        headers=ada,
        json={"name": "Big", "my_name": "Ada", "members": []},
    ).json()
    codes = [
        client.post(
            f"{API}/splits/groups/{tab['id']}/members",
            headers=ada,
            json={"name": f"P{n}", "phone": f"415-555-01{n:02d}"},
        ).status_code
        for n in range(61)
    ]
    assert codes[:60] == [200] * 60 and codes[60] == 429


# --- already in the split, and picking people you know -----------------------


def test_the_same_name_twice_says_already_in_this_split(client):
    ada = _account(client, "ada@x.com", "Ada", "212-555-0100")
    tab = _tab_with_ben(client, ada, kind="group")
    out = client.post(
        f"{API}/splits/groups/{tab['id']}/members", headers=ada, json={"name": " ben "}
    )
    assert out.status_code == 409
    assert out.json()["detail"] == (
        "ben is already in this split. If this is someone else, add their number."
    )


def test_a_joined_friend_added_again_by_number_is_already_in_this_split(client):
    ada = _account(client, "ada@x.com", "Ada", "212-555-0100")
    _account(client, "ben@x.com", "Ben", BEN)
    tab = _tab_with_ben(client, ada, kind="group")

    out = client.post(
        f"{API}/splits/groups/{tab['id']}/members",
        headers=ada,
        json={"name": "Benjamin", "phone": BEN},
    )
    assert out.status_code == 409
    assert out.json()["detail"] == "That number is already in this split, as Ben."


def test_my_people_lists_only_people_on_cotab_and_tells_two_bens_apart(client):
    ada = _account(client, "ada@x.com", "Ada", "212-555-0100")
    _account(client, "ben@x.com", "Ben", "415-555-0199")
    _account(client, "benlee@x.com", "Ben Lee", "646-555-0177")
    # Both Bens have accounts, so both are added straight away.
    trip = _tab_with_ben(client, ada, phone="415-555-0199", kind="group")
    client.post(
        f"{API}/splits/direct",
        headers=ada,
        json={"my_name": "Ada", "members": [{"name": "Ben", "phone": "646-555-0177"}]},
    )
    # Not on Cotab: a name with no number, and a number nobody uses.
    for person in ({"name": "Dev"}, {"name": "Cara", "phone": "917-555-0123"}):
        client.post(
            f"{API}/splits/groups/{trip['id']}/members", headers=ada, json=person
        )

    people = client.get(f"{API}/splits/people", headers=ada).json()
    assert {p["name"] for p in people} == {"Ben"}
    bens = {(p["phone"], p["hint"], p["account"] is not None) for p in people}
    # Each Ben shows the number Ada typed for him.
    assert bens == {("+14155550199", None, True), ("+16465550177", None, True)}


def test_someone_who_joined_from_a_link_shows_only_the_end_of_their_number(client):
    ada = _account(client, "ada@x.com", "Ada", "212-555-0100")
    ben_headers = _account(client, "ben@x.com", "Ben", "415-555-0199")
    trip = client.post(
        f"{API}/splits/groups",
        headers=ada,
        json={"name": "Trip", "my_name": "Ada", "members": []},
    ).json()
    client.post(f"{API}/splits/join/{trip['share_code']}", headers=ben_headers, json={})
    (ben,) = client.get(f"{API}/splits/people", headers=ada).json()
    assert ben["phone"] is None and ben["hint"] == "\u2022\u2022\u20220199"


def test_picking_a_joined_friend_adds_that_exact_account(client):
    ada = _account(client, "ada@x.com", "Ada", "212-555-0100")
    _account(client, "ben@x.com", "Ben", BEN)
    first = _tab_with_ben(client, ada, kind="group")
    (ben,) = [
        p
        for p in client.get(f"{API}/splits/people", headers=ada).json()
        if p["on_cotab"]
    ]

    lake = client.post(
        f"{API}/splits/groups",
        headers=ada,
        json={
            "name": "Lake",
            "my_name": "Ada",
            "members": [{"name": "Ben", "from_member": ben["ref"]}],
        },
    ).json()
    assert lake["id"] != first["id"]
    assert _ben(lake)["status"] == "joined"
    # Picking him again on the same tab is refused.
    again = client.post(
        f"{API}/splits/groups/{lake['id']}/members",
        headers=ada,
        json={"name": "Ben C", "from_member": ben["ref"]},
    )
    assert (
        again.status_code == 409
        and again.json()["detail"] == "Ben is already in this split."
    )


def test_picking_someone_from_a_tab_you_are_not_on_is_refused(client):
    ada = _account(client, "ada@x.com", "Ada", "212-555-0100")
    eve = _account(client, "eve@x.com", "Eve", "646-555-0111")
    secret = _tab_with_ben(client, ada, kind="group")
    eve_tab = client.post(
        f"{API}/splits/groups",
        headers=eve,
        json={"name": "Mine", "my_name": "Eve", "members": []},
    ).json()
    out = client.post(
        f"{API}/splits/groups/{eve_tab['id']}/members",
        headers=eve,
        json={"name": "Ben", "from_member": _ben(secret)["id"]},
    )
    assert out.status_code == 404


def test_checking_a_number_while_typing(client):
    ada = _account(client, "ada@x.com", "Ada", "212-555-0100")
    _account(client, "ben@x.com", "Ben Carter", BEN)

    def look(q):
        return client.get(f"{API}/splits/lookup", headers=ada, params={"q": q})

    found = look("415.555.0123").json()
    assert found["phone"] == BEN_E164 and found["name"] == "Ben Carter"
    assert found["on_cotab"] is True and found["account"] and not found["you"]
    assert look("646-555-0199").json()["on_cotab"] is False
    assert look("(212) 555-0100").json()["you"] is True
    assert look("555-01").status_code == 400


# --- one number, one person: two Bens are two people ------------------------


def _two_bens(client):
    ada = _account(client, "ada@x.com", "Ada", "212-555-0100")
    _account(client, "ben@x.com", "Ben Carter", "415-555-0199")
    _account(client, "benlee@x.com", "Ben Lee", "646-555-0177")
    tab = _tab_with_ben(client, ada, phone="415-555-0199", kind="group")
    return ada, tab, f"{API}/splits/groups/{tab['id']}/members"


def test_a_different_ben_needs_a_different_name(client):
    ada, tab, url = _two_bens(client)
    out = client.post(url, headers=ada, json={"name": "Ben", "phone": "646-555-0177"})
    assert out.status_code == 409
    assert out.json()["detail"] == (
        "There's already a Ben in this split. "
        "Give this one a different name, like their last name."
    )

    out = client.post(
        url, headers=ada, json={"name": "Ben Lee", "phone": "646-555-0177"}
    )
    assert out.status_code == 200, out.text
    bens = {
        m["name"]: m["account"]
        for m in out.json()["members"]
        if m["name"].startswith("Ben")
    }
    assert set(bens) == {"Ben", "Ben Lee"} and len(set(bens.values())) == 2


def test_the_same_ben_under_another_name_is_still_the_same_person(client):
    ada, tab, url = _two_bens(client)
    out = client.post(
        url, headers=ada, json={"name": "Benjamin", "phone": "(415) 555-0199"}
    )
    assert out.status_code == 409
    assert out.json()["detail"] == "That number is already in this split, as Ben."


def test_the_owner_renames_someone_to_tell_two_bens_apart(client):
    ada, tab, url = _two_bens(client)
    ben = _ben(tab)
    renamed = client.put(
        f"{url}/{ben['id']}/name", headers=ada, json={"name": "Ben Carter"}
    )
    assert renamed.status_code == 200
    assert _ben_named(renamed.json(), "Ben Carter")["account"] == ben["account"]
    # Now a plain "Ben" is free for the other one.
    out = client.post(url, headers=ada, json={"name": "Ben", "phone": "646-555-0177"})
    assert out.status_code == 200

    taken = client.put(f"{url}/{ben['id']}/name", headers=ada, json={"name": " ben "})
    assert taken.status_code == 409
    assert taken.json()["detail"] == "There's already a ben in this split."
    blank = client.put(f"{url}/{ben['id']}/name", headers=ada, json={"name": "  "})
    assert blank.status_code == 422


def test_only_the_owner_renames_people(client):
    ada, tab, url = _two_bens(client)
    ben_headers = client.post(
        f"{API}/auth/login",
        data={"username": "ben@x.com", "password": "pw12345"},
    ).json()["access_token"]
    ben_headers = {"Authorization": f"Bearer {ben_headers}"}
    out = client.put(
        f"{url}/{_ben(tab)['id']}/name", headers=ben_headers, json={"name": "Big Ben"}
    )
    assert out.status_code == 403


def test_two_bens_picked_in_one_go_need_two_names(client):
    ada, tab, _ = _two_bens(client)
    client.post(
        f"{API}/splits/direct",
        headers=ada,
        json={"my_name": "Ada", "members": [{"name": "Ben", "phone": "646-555-0177"}]},
    )
    people = client.get(f"{API}/splits/people", headers=ada).json()
    assert len({p["account"] for p in people}) == 2
    refs = [p["ref"] for p in people]

    same = client.post(
        f"{API}/splits/groups",
        headers=ada,
        json={
            "name": "Ski",
            "my_name": "Ada",
            "members": [{"name": "Ben", "from_member": r} for r in refs],
        },
    )
    assert same.status_code == 409
    named = client.post(
        f"{API}/splits/groups",
        headers=ada,
        json={
            "name": "Ski",
            "my_name": "Ada",
            "members": [
                {"name": "Ben Carter", "from_member": refs[0]},
                {"name": "Ben Lee", "from_member": refs[1]},
            ],
        },
    )
    assert named.status_code == 200, named.text
    assert [m["name"] for m in named.json()["members"]] == [
        "Ada",
        "Ben Carter",
        "Ben Lee",
    ]


def test_the_same_name_without_a_number_is_still_refused(client):
    ada, tab, url = _two_bens(client)
    out = client.post(url, headers=ada, json={"name": "Ben"})
    assert out.status_code == 409
    assert "If this is someone else, add their number." in out.json()["detail"]


def _ben_named(tab, name):
    return next(m for m in tab["members"] if m["name"] == name)


# --- by email, the same as by number -----------------------------------------


def test_finding_someone_by_their_email(client):
    ada = _account(client, "ada@x.com", "Ada", "212-555-0100")
    _account(client, "ben@x.com", "Ben Carter", BEN)

    def look(q):
        return client.get(f"{API}/splits/lookup", headers=ada, params={"q": q})

    found = look(" Ben@X.com ").json()
    assert found["email"] == "ben@x.com" and found["name"] == "Ben Carter"
    assert look("nobody@x.com").json()["on_cotab"] is False
    assert look("ada@x.com").json()["you"] is True
    assert look("not-an-email@").status_code == 400


def test_adding_a_registered_email_adds_that_account(client):
    ada = _account(client, "ada@x.com", "Ada", "212-555-0100")
    ben_headers = _account(client, "ben@x.com", "Ben Carter", BEN)
    tab = client.post(
        f"{API}/splits/groups",
        headers=ada,
        json={
            "name": "Lake trip",
            "my_name": "Ada",
            "members": [{"name": "Ben Carter", "email": "BEN@x.com"}],
        },
    ).json()
    ben = next(m for m in tab["members"] if m["name"] == "Ben Carter")
    assert ben["status"] == "joined" and ben["account"]
    assert len(client.get(f"{API}/splits/groups", headers=ben_headers).json()) == 1

    again = client.post(
        f"{API}/splits/groups/{tab['id']}/members",
        headers=ada,
        json={"name": "Benny", "email": "ben@x.com"},
    )
    assert again.status_code == 409
    assert (
        again.json()["detail"] == "That email is already in this split, as Ben Carter."
    )


def test_an_email_nobody_uses_is_not_on_cotab(client):
    ada = _account(client, "ada@x.com", "Ada", "212-555-0100")
    tab = client.post(
        f"{API}/splits/direct",
        headers=ada,
        json={"my_name": "Ada", "members": [{"name": "Dev", "email": "dev@x.com"}]},
    ).json()
    dev = next(m for m in tab["members"] if m["name"] == "Dev")
    assert dev["status"] == "not_on_cotab"
    assert client.get(f"{API}/splits/people", headers=ada).json() == []

    # Dev signs up with that email later: he's on the tab.
    dev_headers = _account(client, "dev@x.com", "Dev Patel", "917-555-0123")
    (joined,) = client.get(f"{API}/splits/groups", headers=dev_headers).json()
    assert joined["id"] == tab["id"]


def test_your_own_email_is_refused(client):
    ada = _account(client, "ada@x.com", "Ada", "212-555-0100")
    out = client.post(
        f"{API}/splits/direct",
        headers=ada,
        json={"my_name": "Ada", "members": [{"name": "Me", "email": "ADA@x.com"}]},
    )
    assert out.status_code == 400 and "your own email" in out.json()["detail"]


# --- numbers proved by a texted code (REQUIRE_PHONE_VERIFICATION) ------------


@pytest.fixture()
def proof_required(monkeypatch):
    from app.config.settings import get_settings

    monkeypatch.setattr(get_settings(), "require_phone_verification", True)


def _verify(db_session, email):
    from app.models import User
    from app.services import invites

    user = db_session.query(User).filter(User.email == email).one()
    joined = invites.phone_verified(db_session, user)
    db_session.commit()
    return joined


def test_an_unproved_number_joins_no_tabs_until_it_is_proved(
    client, db_session, proof_required
):
    ada = _account(client, "ada@x.com", "Ada", "212-555-0100")
    lake = _tab_with_ben(client, ada, kind="group")
    ben_headers = _account(client, "ben@x.com", "Ben", BEN)
    # Typing Ben's number isn't proof it's his: no tabs, still not on Cotab.
    assert client.get(f"{API}/splits/groups", headers=ben_headers).json() == []
    summary = client.get(
        f"{API}/splits/groups/{lake['id']}/summary", headers=ada
    ).json()
    assert _ben(summary)["status"] == "not_on_cotab"

    assert [m.group_id for m in _verify(db_session, "ben@x.com")] == [lake["id"]]
    (mine,) = client.get(f"{API}/splits/groups", headers=ben_headers).json()
    assert mine["id"] == lake["id"]


def test_an_unproved_number_is_not_found_or_added_as_that_account(
    client, db_session, proof_required
):
    ada = _account(client, "ada@x.com", "Ada", "212-555-0100")
    _account(client, "ben@x.com", "Ben Carter", BEN)

    def look(q):
        return client.get(f"{API}/splits/lookup", headers=ada, params={"q": q})

    assert look(BEN).json()["on_cotab"] is False
    assert _ben(_tab_with_ben(client, ada))["status"] == "not_on_cotab"
    # Your own number is still yours, proved or not.
    assert look("(212) 555-0100").json()["you"] is True

    _verify(db_session, "ben@x.com")
    assert look(BEN).json()["name"] == "Ben Carter"


def test_a_changed_number_has_to_be_proved_again(client, db_session, proof_required):
    from app.models import User

    ben_headers = _account(client, "ben@x.com", "Ben", BEN)
    _verify(db_session, "ben@x.com")
    client.put(
        f"{API}/auth/me/phone", headers=ben_headers, json={"phone": "646-555-0177"}
    )
    ben = db_session.query(User).filter(User.email == "ben@x.com").one()
    db_session.refresh(ben)
    assert ben.phone_verified_at is None

    ada = _account(client, "ada@x.com", "Ada", "212-555-0100")
    tab = _tab_with_ben(client, ada, phone="646-555-0177")
    assert _ben(tab)["status"] == "not_on_cotab"
