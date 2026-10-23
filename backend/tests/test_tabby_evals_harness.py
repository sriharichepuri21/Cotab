"""The report card's own plumbing works (the real run needs a Gemini key)."""

from evals import run_tabby_evals as evals
from tests import fake_gemini


def test_the_report_card_seeds_runs_and_grades(monkeypatch):
    monkeypatch.setattr(evals.chat_service, "_check_rate_limit", lambda _u: None)
    stream = fake_gemini.Stream(
        [fake_gemini.call("find_purchases", store="costco")],
        [fake_gemini.call("remove_budget", budget="coffee")],
        [fake_gemini.text("Here's the plan.")],
    )
    monkeypatch.setattr(evals.chat_service.ai_client, "stream", stream)
    got = evals.run_case({"id": "x", "say": ["Remove my coffee budget"]})
    assert got["actions"] == ["remove_budget"]
    assert evals.grade({"plan": ["remove_budget"]}, got) == []
    assert evals.grade({"ask": True}, got) == [
        "should have asked first",
        "planned ['remove_budget'] instead of asking",
    ]


def test_every_request_has_a_checkable_expectation():
    import json

    cases = json.loads((evals.HERE / "tabby_requests.json").read_text())
    assert len(cases) >= 50
    assert len({c["id"] for c in cases}) == len(cases)
    known = {"plan", "plan_any", "plan_min", "plan_or_ask", "ask", "no_plan", "now"}
    known |= {"link", "item_ids", "args", "no_error", "or_now"}
    for case in cases:
        assert case["say"] and set(case["expect"]) <= known, case["id"]
