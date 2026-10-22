"""Changing your name and picking your Tabby."""

import pytest
from fastapi.testclient import TestClient

from app.db.session import get_db
from app.main import app

API = "/api/v1"


@pytest.fixture()
def client(db_session):
    app.dependency_overrides[get_db] = lambda: db_session
    yield TestClient(app)
    app.dependency_overrides.clear()


def _register(client, email, name):
    token = client.post(
        f"{API}/auth/register",
        json={"email": email, "password": "pw12345", "full_name": name},
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_new_accounts_have_no_tabby_yet(client):
    me = client.get(
        f"{API}/auth/me", headers=_register(client, "a@x.com", "Ada")
    ).json()
    assert me["avatar_mood"] is None and me["avatar_look"] is None


def test_profile_changes_only_what_is_sent(client):
    headers = _register(client, "a@x.com", "Ada")
    out = client.patch(
        f"{API}/auth/me",
        headers=headers,
        json={"avatar_look": "beanie", "avatar_mood": "cool", "avatar_bg": "sage"},
    )
    assert out.status_code == 200
    me = out.json()
    assert (me["avatar_look"], me["avatar_mood"], me["avatar_bg"]) == (
        "beanie",
        "cool",
        "sage",
    )
    assert me["full_name"] == "Ada"

    me = client.patch(
        f"{API}/auth/me", headers=headers, json={"full_name": "  Ada Lovelace "}
    ).json()
    assert me["full_name"] == "Ada Lovelace" and me["avatar_mood"] == "cool"

    me = client.patch(
        f"{API}/auth/me", headers=headers, json={"tabby_reacts": False}
    ).json()
    assert me["tabby_reacts"] is False


def test_profile_rejects_unknown_tabbies_and_blank_names(client):
    headers = _register(client, "a@x.com", "Ada")
    assert (
        client.patch(
            f"{API}/auth/me", headers=headers, json={"avatar_mood": "angry"}
        ).status_code
        == 422
    )
    assert (
        client.patch(
            f"{API}/auth/me", headers=headers, json={"avatar_look": "tophat"}
        ).status_code
        == 422
    )
    assert (
        client.patch(
            f"{API}/auth/me", headers=headers, json={"full_name": " "}
        ).status_code
        == 400
    )


def test_joined_friends_show_their_own_tabby_on_the_tab(client):
    ada = _register(client, "a@x.com", "Ada")
    ben = _register(client, "b@x.com", "Ben")
    client.patch(
        f"{API}/auth/me",
        headers=ben,
        json={"avatar_look": "headphones", "avatar_mood": "love"},
    )
    group = client.post(
        f"{API}/splits/groups",
        headers=ada,
        json={"name": "Flat", "my_name": "Ada", "members": ["Ben"]},
    ).json()
    summary = client.get(
        f"{API}/splits/groups/{group['id']}/summary", headers=ada
    ).json()
    ben_id = next(m["id"] for m in summary["members"] if m["name"] == "Ben")
    assert (
        client.post(
            f"{API}/splits/join/{group['share_code']}",
            headers=ben,
            json={"member_id": ben_id},
        ).status_code
        == 200
    )
    summary = client.get(
        f"{API}/splits/groups/{group['id']}/summary", headers=ada
    ).json()
    avatars = {m["name"]: m["avatar"] for m in summary["members"]}
    assert avatars["Ben"] == {"look": "headphones", "mood": "love", "bg": "mood"}
    assert avatars["Ada"] is None
