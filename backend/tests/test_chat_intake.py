"""Intake chat must parse free text and refuse silent defaults."""

import json

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
    assert "scotty" in res["reply"].lower()
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


def test_grok_path_infers_a_full_paragraph(monkeypatch):
    payload = {
        "reply": "Sounds like an A, evenings, you lead on the technical side.",
        "ready": True,
        "profile": {
            "goal": "grade_A",
            "hours": 8,
            "availability": ["mon_evening", "wed_evening"],
            "skills": {"technical": 5, "writing": 2, "analysis": 3, "presentation": 3},
            "role": "lead",
            "conflict_mode": "vote",
            "confidence": 0.82,
        },
    }

    class _Msg:
        content = json.dumps(payload)

    class _Choice:
        message = _Msg()

    class _Resp:
        choices = [_Choice()]

    class _Completions:
        @staticmethod
        def create(**_kwargs):
            return _Resp()

    class _Chat:
        completions = _Completions()

    class _Client:
        chat = _Chat()

    monkeypatch.setattr(gc, "_client", _Client())
    res = chat_turn(
        "Surya",
        [
            {
                "role": "user",
                "content": "I want an A. I code most nights. Writing isn’t my thing. I’ll lead.",
            }
        ],
        "HackCMU",
    )
    assert res["ready"] is True
    assert res["profile"]["goal"] == "grade_A"
    assert res["profile"]["role"] == "lead"
    assert "mon_evening" in res["profile"]["availability"]
    assert "mon_evening" not in res["reply"]
    assert "grade_A" not in res["reply"]


def test_humanize_reply_never_leaks_slot_tokens():
    raw = "Avail: mon_evening through fri_evening ok? Skills tech4/writing3. grade_A."
    out = gc.humanize_reply(raw)
    assert "mon_evening" not in out
    assert "grade_A" not in out
    assert "Monday evenings" in out
    assert "technical 4" in out


def test_humanize_reply_strips_em_dashes():
    dash = "\u2014"
    out = gc.humanize_reply(f"Presenting at a 3 {dash} do you like to lead? Nice{dash}work.")
    assert dash not in out
    assert out == "Presenting at a 3, do you like to lead? Nice, work."


def test_interview_prompt_has_no_em_dashes_and_names_grok():
    prompt = gc.interview_instructions("Surya", "HackCMU", spoken=True)
    assert "\u2014" not in prompt
    assert "Grok powered AI assistant" in prompt
    opening = chat_turn("Surya", [], "HackCMU")["reply"]
    assert "\u2014" not in opening
    assert "Grok powered AI assistant" in opening


def test_review_instructions_keep_scotty_on_the_recap():
    profile = {
        "goal": "grade_A",
        "hours": 7,
        "availability": ["mon_evening"],
        "skills": {"technical": 4, "writing": 3, "analysis": 3, "presentation": 3},
        "role": "contributor",
    }
    guidance = gc.review_instructions("Surya", profile)
    assert "\u2014" not in guidance
    assert "do not restart the interview" in guidance
    assert "Do not introduce yourself again" in guidance
    # The recap the student is looking at has to be in the prompt, in plain language.
    assert "presenting at 3" in guidance
    assert "grade_A" not in guidance


def test_spoken_review_is_plain_language():
    recap = gc.spoken_review(
        "Surya",
        {
            "goal": "grade_A",
            "hours": 7,
            "availability": ["mon_evening", "sat_afternoon"],
            "skills": {"technical": 4, "writing": 3, "analysis": 3, "presentation": 3},
            "role": "contributor",
        },
    )
    assert "grade_A" not in recap
    assert "mon_evening" not in recap
    assert "Monday evenings" in recap
    assert "You're aiming for an A" in recap


def test_voice_snapshot_notes_block_ready():
    res = gc.apply_voice_snapshot(
        "Surya",
        {
            "goal": "grade_A",
            "hours": 7,
            "availability": ["mon_evening"],
            "skills": {"technical": 4, "writing": 3, "analysis": 3, "presentation": 3},
            "role": "contributor",
            "notes": ["technical inferred from pretty good"],
            "ready": True,
        },
    )
    assert res["ready"] is False
    assert res["profile"] is None


def test_grok_vague_notes_block_review(monkeypatch):
    payload = {
        "reply": "I’m hearing pretty good at technical. Is that a 3, 4, or 5?",
        "ready": True,
        "notes": ["technical inferred as 4 from 'pretty good'"],
        "profile": {
            "goal": "grade_A",
            "hours": 8,
            "availability": ["mon_evening"],
            "skills": {"technical": 4, "writing": 3, "analysis": 3, "presentation": 3},
            "role": "either",
            "conflict_mode": "vote",
            "confidence": 0.6,
        },
    }

    class _Msg:
        content = json.dumps(payload)

    class _Choice:
        message = _Msg()

    class _Resp:
        choices = [_Choice()]

    class _Completions:
        @staticmethod
        def create(**_kwargs):
            return _Resp()

    class _Chat:
        completions = _Completions()

    class _Client:
        chat = _Chat()

    monkeypatch.setattr(gc, "_client", _Client())
    res = chat_turn(
        "Surya",
        [{"role": "user", "content": "I want an A, 8 hours, Monday evenings, pretty good at technical."}],
        "HackCMU",
    )
    assert res["ready"] is False
    assert res["profile"] is None
    assert res["notes"]
