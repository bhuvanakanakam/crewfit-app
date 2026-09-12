"""Intake chat must parse free text and refuse silent defaults."""

import pytest

import app.grok_client as gc
from app.grok_client import chat_turn


@pytest.fixture(autouse=True)
def no_grok(monkeypatch):
    monkeypatch.setattr(gc, "_client", None)


def _run(name, user_replies, start=None):
    messages = list(start or [])
    last = None
    for text in user_replies:
        last = chat_turn(name, messages, "HackCMU")
        if last.get("ready"):
            return last, messages
        messages.append({"role": "assistant", "content": last["reply"]})
        messages.append({"role": "user", "content": text})
    last = chat_turn(name, messages, "HackCMU")
    return last, messages


def test_opening_is_not_ready():
    res = chat_turn("Vamsi", [], "HackCMU")
    assert res["ready"] is False
    assert res["profile"] is None
    assert "how you work" in res["reply"].lower()


def test_vague_replies_never_ready():
    res, _ = _run("Vamsi", ["idk", "whatever", "not sure", "asdf", "maybe later", "nah"] * 2)
    assert res["ready"] is False
    assert res["profile"] is None


def test_paragraph_without_hours_asks_hours():
    dump = (
        "I want a research paper out of this. I'm free Monday and Wednesday evenings. "
        "Technical 5, writing 3, analysis 4, presenting 2. I'd rather lead."
    )
    res, messages = _run("Vamsi", [dump])
    assert res["ready"] is False
    assert "hour" in res["reply"].lower()
    res2, _ = _run("Vamsi", ["10"], start=messages)
    assert res2["ready"] is True
    assert res2["profile"]["hours"] == 10
    assert res2["profile"]["goal"] == "research"
    assert res2["profile"]["role"] == "lead"
    assert 5 == res2["profile"]["skills"]["technical"]
    assert res2["profile"]["availability"]


def test_scripted_answers_ready():
    res, _ = _run(
        "Vamsi",
        ["Pass", "8", "Mon Evening, Wed Evening", "5", "3", "4", "2", "lead"],
    )
    assert res["ready"] is True
    p = res["profile"]
    assert p["goal"] == "pass"
    assert p["hours"] == 8
    assert "mon_evening" in p["availability"]
    assert p["skills"] == {"technical": 5, "writing": 3, "analysis": 4, "presentation": 2}
    assert p["role"] == "lead"


def test_does_not_default_hours_or_evening():
    res, _ = _run("Vamsi", ["I just want to do well in the class honestly lots of random context"])
    assert res["ready"] is False
    assert res["profile"] is None
