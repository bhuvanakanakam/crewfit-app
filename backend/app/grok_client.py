"""
Every call to xAI's Grok API lives in this one file — this is the integration
point mentioned in the README. Nothing else in the backend imports `openai`
or knows about xAI at all, so swapping models/providers later only touches
this file.

Three call sites, matching the PRD:
  1. extract_profile()      free text -> structured profile (+ confidence,
                             clarifying questions when something's ambiguous)
  2. resolve_clarification() a person's answers -> a completed profile
  3. generate_rationale()   a solved team's score breakdown -> a one-line
                             human explanation

If no decrypted XAI key is available, each function falls back to a plain
heuristic so the rest of the app is runnable with zero setup. Store the key
encrypted as XAI_API_KEY_ENCRYPTED in .env.shared (see app/crypto_secret.py).
"""

import json
import os
import re

from openai import OpenAI

from .config import XAI_API_KEY, XAI_MODEL, XAI_BASE_URL
from .slots import ALL_SLOTS, normalize_availability

_client = OpenAI(api_key=XAI_API_KEY, base_url=XAI_BASE_URL, timeout=20.0) if XAI_API_KEY else None

_SLOT_ENUM = list(ALL_SLOTS)

PROFILE_JSON_SCHEMA = {
    "name": "student_profile",
    "schema": {
        "type": "object",
        "properties": {
            "goal": {"type": "string", "enum": ["pass", "grade_A", "research", "deep_mastery"]},
            "availability": {
                "type": "array",
                "items": {"type": "string", "enum": _SLOT_ENUM},
                "description": "Concrete windows as day_time, e.g. mon_evening, sat_afternoon.",
            },
            "skills": {
                "type": "object",
                "properties": {
                    "technical": {"type": "integer", "minimum": 1, "maximum": 5, "description": "Coding / building"},
                    "writing": {"type": "integer", "minimum": 1, "maximum": 5, "description": "Docs / reports"},
                    "analysis": {"type": "integer", "minimum": 1, "maximum": 5, "description": "Data / research"},
                    "presentation": {"type": "integer", "minimum": 1, "maximum": 5, "description": "Demos / pitching"},
                },
                "required": ["technical", "writing", "analysis", "presentation"],
            },
            "hours": {"type": "integer", "minimum": 1, "maximum": 40},
            "role": {"type": "string", "enum": ["lead", "contributor", "either"]},
            "conflict_mode": {"type": "string", "enum": ["vote", "rotate_lead", "escalate", "defer_to_invested"]},
            "confidence": {"type": "number", "minimum": 0, "maximum": 1},
            "clarifying_questions": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["goal", "availability", "skills", "hours", "role", "conflict_mode", "confidence", "clarifying_questions"],
    },
}


def extract_profile(name: str, bio: str, course_context: str) -> dict:
    if _client is None:
        return normalize_availability_in_profile(_heuristic_extract(bio))

    response = _client.chat.completions.create(
        model=XAI_MODEL,
        messages=[
            {
                "role": "system",
                "content": (
                    f"You extract structured team-formation constraints from a student's free-text "
                    f"self-description, for the course/context: {course_context or 'a group project'}. "
                    "Make your best-guess extraction for every field even when the text is vague. "
                    "Set confidence between 0 and 1 reflecting how sure you are overall. "
                    "If any field was a real guess rather than something the text actually supported, "
                    "add one short, specific clarifying question about it (max 2 questions)."
                ),
            },
            {"role": "user", "content": f"Name: {name}\nSelf-description: {bio}"},
        ],
        response_format={"type": "json_schema", "json_schema": PROFILE_JSON_SCHEMA},
        temperature=0.2,
    )
    return normalize_availability_in_profile(json.loads(response.choices[0].message.content))


def normalize_availability_in_profile(data: dict, *, fill_default: bool = True) -> dict:
    data = dict(data)
    data["availability"] = normalize_availability(
        list(data.get("availability") or []), fill_default=fill_default
    )
    return data


def resolve_clarification(name: str, bio: str, course_context: str, qa_pairs: list[tuple[str, str]]) -> dict:
    """Append the Q&A as extra context and re-run extraction — the simplest
    reliable way to fold a clarifying answer back into the structured profile."""
    extra = "\n".join(f"Q: {q}\nA: {a}" for q, a in qa_pairs)
    enriched_bio = f"{bio}\n\nAdditional clarification:\n{extra}"
    return extract_profile(name, enriched_bio, course_context)


def generate_rationale(
    member_names: list[str],
    breakdown: dict,
    dominant_goal_label: str,
    extras: dict | None = None,
) -> str:
    if _client is None or os.getenv("PYTEST_CURRENT_TEST"):
        return _heuristic_rationale(member_names, breakdown, dominant_goal_label)

    payload = {
        "members": member_names,
        "scores": breakdown,
        "most_common_goal": dominant_goal_label,
        **(extras or {}),
    }
    try:
        response = _client.chat.completions.create(
            model=XAI_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Write 2 short sentences for students: why this team was grouped, and what "
                        "skill coverage looks like (covered vs thin). Use only the facts given. "
                        "No hedging, no raw numbers, no private ratings or hours. Speak in shared "
                        "fit: goals, schedules, complementary strengths, similar commitment."
                    ),
                },
                {"role": "user", "content": json.dumps(payload)},
            ],
            temperature=0.4,
        )
        text = (response.choices[0].message.content or "").strip()
        return text or _heuristic_rationale(member_names, breakdown, dominant_goal_label)
    except Exception:
        return _heuristic_rationale(member_names, breakdown, dominant_goal_label)


_SKILL_KEYS = ("technical", "writing", "analysis", "presentation")
_SKILL_REASK = {
    "technical": "How would you rate your technical skills, from 1 to 5?",
    "writing": "How would you rate your writing, from 1 to 5?",
    "analysis": "How would you rate your analysis skills, from 1 to 5?",
    "presentation": "How would you rate your presenting, from 1 to 5?",
}
_INTAKE_ORDER = (
    "goal",
    "hours",
    "availability",
    "technical",
    "writing",
    "analysis",
    "presentation",
    "role",
)

INTAKE_JSON_SCHEMA = {
    "name": "intake_extract",
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "goal": {"type": "string", "enum": ["pass", "grade_A", "research", "deep_mastery", "unknown"]},
            "hours": {"type": "integer", "minimum": 0, "maximum": 40},
            "availability": {
                "type": "array",
                "items": {"type": "string", "enum": _SLOT_ENUM},
            },
            "skills": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "technical": {"type": "integer", "minimum": 0, "maximum": 5},
                    "writing": {"type": "integer", "minimum": 0, "maximum": 5},
                    "analysis": {"type": "integer", "minimum": 0, "maximum": 5},
                    "presentation": {"type": "integer", "minimum": 0, "maximum": 5},
                },
                "required": ["technical", "writing", "analysis", "presentation"],
            },
            "role": {"type": "string", "enum": ["lead", "contributor", "either", "unknown"]},
            "stated": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "goal": {"type": "boolean"},
                    "hours": {"type": "boolean"},
                    "availability": {"type": "boolean"},
                    "technical": {"type": "boolean"},
                    "writing": {"type": "boolean"},
                    "analysis": {"type": "boolean"},
                    "presentation": {"type": "boolean"},
                    "role": {"type": "boolean"},
                },
                "required": [
                    "goal",
                    "hours",
                    "availability",
                    "technical",
                    "writing",
                    "analysis",
                    "presentation",
                    "role",
                ],
            },
        },
        "required": ["goal", "hours", "availability", "skills", "role", "stated"],
    },
}


def chat_turn(name: str, messages: list[dict], course_context: str) -> dict:
    """Student interview: parse whatever they wrote, ask only what is still missing.

    Matching fields are never filled with silent defaults. A team is offered only
    after goal, hours, availability, four skill ratings, and role are actually stated.
    """
    user_turns = [m["content"] for m in messages if m["role"] == "user"]
    if not user_turns:
        return {"reply": _opening(name), "ready": False, "profile": None}

    draft = _collect_intake(name, messages, course_context)
    missing = _missing_intake(draft)
    asked = _field_from_assistant(messages)

    if not missing:
        return {
            "reply": (
                f"Thanks {name} — that’s everything we need. "
                "Goal, hours, schedule, skills, and role are saved as a profile, "
                "not a paragraph dump. Find your team whenever you’re ready."
            ),
            "ready": True,
            "profile": _draft_to_profile(draft),
        }

    nxt = missing[0]
    if asked == nxt:
        reply = _reask(nxt)
    else:
        reply = _ask(nxt, name)
    return {"reply": reply, "ready": False, "profile": None}


def _opening(name: str) -> str:
    return (
        f"Hey {name} — tell me how you work. A few sentences or a long dump is fine. "
        "I’ll pick out your goal, hours, schedule, skills, and whether you like to lead, "
        "and I’ll only ask about whatever I couldn’t find."
    )


def _ask(field: str, name: str) -> str:
    if field == "goal":
        return (
            f"Got it so far, {name}. What would make this project feel successful for you — "
            "finishing it, a strong grade, a research angle, or really learning the material?"
        )
    if field == "hours":
        return "Roughly how many hours a week can you actually put into this?"
    if field == "availability":
        return "When are you usually free to meet during the week — days and mornings / afternoons / evenings?"
    if field in _SKILL_REASK:
        return _SKILL_REASK[field]
    if field == "role":
        return "On a team, would you rather lead, contribute, or are you fine with either?"
    return "Could you say a bit more about how you work?"


def _reask(field: str) -> str:
    if field == "goal":
        return (
            "I’m still not sure what you’re aiming for. "
            "In your own words — pass, a strong grade, research, or really learning it?"
        )
    if field == "hours":
        return "About how many hours a week — even a rough number is enough."
    if field == "availability":
        return "When do you usually have time to meet? Days and time of day is enough, in whatever words you use."
    if field in _SKILL_REASK:
        return f"Still need a sense of that skill — anything from ‘not my thing’ to ‘I’m strong at it’ works. {_SKILL_REASK[field]}"
    if field == "role":
        return "Would you rather run the team, support, or whichever is needed?"
    return "Could you say that another way?"


def _missing_intake(draft: dict) -> list[str]:
    missing: list[str] = []
    if not draft.get("goal"):
        missing.append("goal")
    if not draft.get("hours"):
        missing.append("hours")
    if not draft.get("availability"):
        missing.append("availability")
    skills = draft.get("skills") or {}
    for key in _SKILL_KEYS:
        if not skills.get(key):
            missing.append(key)
    if not draft.get("role"):
        missing.append("role")
    return missing


def _draft_to_profile(draft: dict) -> dict:
    return {
        "goal": draft["goal"],
        "hours": draft["hours"],
        "availability": draft["availability"],
        "skills": {key: int(draft["skills"][key]) for key in _SKILL_KEYS},
        "role": draft["role"],
        "conflict_mode": "vote",
        "confidence": 0.9,
        "clarifying_questions": [],
    }


def _field_from_assistant(messages: list[dict]) -> str | None:
    last = next((m["content"] for m in reversed(messages) if m["role"] == "assistant"), "") or ""
    return _field_from_text(last)


def _field_from_text(last: str) -> str | None:
    if re.search(r"lead, contribute, or either|pick one: lead", last, re.I):
        return "role"
    if re.search(r"technical skills", last, re.I):
        return "technical"
    if re.search(r"rate your writing", last, re.I):
        return "writing"
    if re.search(r"analysis skills", last, re.I):
        return "analysis"
    if re.search(r"presenting", last, re.I):
        return "presentation"
    if re.search(r"hours a week|how many hours", last, re.I):
        return "hours"
    if re.search(r"free to meet|when you can meet|mornings / afternoons|meeting windows", last, re.I):
        return "availability"
    if re.search(r"feel successful|aiming for|strong grade|how you work", last, re.I):
        return "goal"
    return None


def _collect_intake(name: str, messages: list[dict], course_context: str) -> dict:
    draft: dict = {"skills": {}}
    grok = _intake_from_grok(name, messages, course_context)
    if grok:
        _merge_stated(draft, grok)
    _merge_stated(draft, _intake_from_heuristic(messages))
    _apply_history(draft, messages)
    asked = _field_from_assistant(messages)
    last_user = next((m["content"] for m in reversed(messages) if m["role"] == "user"), "") or ""
    if asked == "goal" and not _parse_goal(last_user):
        draft.pop("goal", None)
    if asked == "hours" and not _parse_hours(last_user):
        draft.pop("hours", None)
    if asked == "availability" and not _slots_from_text(last_user):
        draft.pop("availability", None)
    if asked in _SKILL_KEYS and not _parse_skill_rating(last_user):
        skills = dict(draft.get("skills") or {})
        skills.pop(asked, None)
        draft["skills"] = skills
    if asked == "role" and not _parse_team_role(last_user):
        draft.pop("role", None)
    if draft.get("availability"):
        draft["availability"] = normalize_availability(draft["availability"], fill_default=False)
    return draft


def _apply_history(draft: dict, messages: list[dict]) -> None:
    asked = None
    for m in messages:
        if m["role"] == "assistant":
            asked = _field_from_text(m["content"])
        elif m["role"] == "user" and asked:
            _merge_last_turn(draft, asked, m["content"])


def _merge_stated(draft: dict, incoming: dict) -> None:
    if incoming.get("goal"):
        draft["goal"] = incoming["goal"]
    if incoming.get("hours"):
        draft["hours"] = incoming["hours"]
    if incoming.get("availability"):
        draft["availability"] = incoming["availability"]
    skills = dict(draft.get("skills") or {})
    for key in _SKILL_KEYS:
        val = (incoming.get("skills") or {}).get(key)
        if val:
            skills[key] = val
    draft["skills"] = skills
    if incoming.get("role"):
        draft["role"] = incoming["role"]


def _merge_last_turn(draft: dict, asked: str | None, text: str) -> None:
    if not asked:
        return
    if asked == "goal":
        parsed = _parse_goal(text)
        if parsed:
            draft["goal"] = parsed
    elif asked == "hours":
        parsed_h = _parse_hours(text)
        if parsed_h:
            draft["hours"] = parsed_h
    elif asked == "availability":
        slots = _slots_from_text(text)
        if slots:
            draft["availability"] = slots
    elif asked in _SKILL_KEYS:
        rating = _parse_skill_rating(text)
        if rating:
            skills = dict(draft.get("skills") or {})
            skills[asked] = rating
            draft["skills"] = skills
    elif asked == "role":
        parsed_r = _parse_team_role(text)
        if parsed_r:
            draft["role"] = parsed_r


def _intake_from_grok(name: str, messages: list[dict], course_context: str) -> dict | None:
    if _client is None:
        return None
    transcript = "\n".join(
        f"{'Student' if m['role'] == 'user' else 'Assistant'}: {m['content']}" for m in messages
    )
    try:
        response = _client.chat.completions.create(
            model=XAI_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": (
                        f"You extract team-formation facts from a student interview for: "
                        f"{course_context or 'a group project'}. "
                        "Use ONLY what the student clearly stated. Do not guess, infer, or fill defaults. "
                        "If a field was not clearly answered, set its stated flag to false and use unknown/0/empty. "
                        "Vague phrases like 'do well', 'some time', 'I'm flexible', or unrelated course chatter "
                        "do not count. Goal must be one of pass / grade_A / research / deep_mastery. "
                        "Hours must be a single weekly number 1–40. "
                        "Availability must be concrete day_time slots (e.g. mon_evening). "
                        "Skills only if they gave 1–5 ratings. "
                        f"Student name: {name}."
                    ),
                },
                {"role": "user", "content": transcript or "(no messages yet)"},
            ],
            response_format={"type": "json_schema", "json_schema": INTAKE_JSON_SCHEMA},
            temperature=0.1,
        )
        raw = json.loads(response.choices[0].message.content)
    except Exception:
        return None
    stated = raw.get("stated") or {}
    skills_in = raw.get("skills") or {}
    skills = {}
    for key in _SKILL_KEYS:
        val = skills_in.get(key)
        if stated.get(key) and isinstance(val, int) and 1 <= val <= 5:
            skills[key] = val
    hours = raw.get("hours") or 0
    goal = raw.get("goal")
    role = raw.get("role")
    slots = normalize_availability(list(raw.get("availability") or []), fill_default=False)
    return {
        "goal": goal if stated.get("goal") and goal in {"pass", "grade_A", "research", "deep_mastery"} else None,
        "hours": hours if stated.get("hours") and 1 <= hours <= 40 else None,
        "availability": slots if stated.get("availability") and slots else None,
        "skills": skills,
        "role": role if stated.get("role") and role in {"lead", "contributor", "either"} else None,
    }


def _intake_from_heuristic(messages: list[dict]) -> dict:
    text = " ".join(m["content"] for m in messages if m["role"] == "user")
    skills = {}
    blob = text.lower()
    for key, label in (
        ("technical", r"(?:technical|coding|building)"),
        ("writing", r"(?:writing|docs)"),
        ("analysis", r"(?:analysis|analytic)"),
        ("presentation", r"(?:presenting|presentation|pitch)"),
    ):
        m = re.search(rf"{label}\s*[:=]?\s*([1-5])\b", blob)
        if m:
            skills[key] = int(m.group(1))
    compact = re.fullmatch(r"\s*([1-5])(?:[\s,]+)([1-5])(?:[\s,]+)([1-5])(?:[\s,]+)([1-5])\s*", text)
    if compact and not skills:
        skills = {k: int(compact.group(i + 1)) for i, k in enumerate(_SKILL_KEYS)}
    hours = _parse_hours(text) if re.search(r"hour", blob) else None
    slots = _slots_from_text(text)
    return {
        "goal": _parse_goal(text),
        "hours": hours,
        "availability": slots or None,
        "skills": skills,
        "role": _parse_team_role(text),
    }


def update_turn(
    name: str,
    messages: list[dict],
    course_context: str,
    existing: dict,
    focus: str | None = None,
) -> dict:
    """Update an existing profile from a short chat, asking once if unclear."""
    user_turns = [m["content"] for m in messages if m["role"] == "user"]
    if not user_turns:
        return {
            "reply": (
                f"Here is what we already have for you, {name}. "
                "Tell me which part to change — goal, hours, availability, skills, or role — "
                "and what it should be now."
            ),
            "ready": False,
            "profile": None,
        }

    last = user_turns[-1]
    field = (focus or "any").strip().lower()
    if field not in {"goal", "hours", "availability", "skills", "role", "any"}:
        field = "any"

    if _client is not None:
        extracted = extract_profile(
            name,
            (
                f"Current structured profile: {json.dumps(existing)}\n"
                f"Student wants to change: {field}\n"
                f"Their latest message: {last}"
            ),
            course_context,
        )
        questions = extracted.get("clarifying_questions") or []
        confidence = float(extracted.get("confidence") or 0)
        if questions and confidence < 0.72:
            return {"reply": questions[0], "ready": False, "profile": None}
        merged = _merge_profile(existing, extracted, field)
        return {
            "reply": "Updated. Check the saved profile and keep going if something else is off.",
            "ready": True,
            "profile": merged,
        }

    merged, question = _heuristic_update(existing, last, field)
    if question:
        return {"reply": question, "ready": False, "profile": None}
    return {
        "reply": "Updated. Check the saved profile and keep going if something else is off.",
        "ready": True,
        "profile": merged,
    }


def _merge_profile(existing: dict, extracted: dict, field: str) -> dict:
    merged = dict(existing)
    if field == "skills":
        merged["skills"] = extracted.get("skills", existing.get("skills"))
    elif field == "availability":
        merged["availability"] = extracted.get("availability", existing.get("availability"))
    elif field in {"goal", "hours", "role"}:
        merged[field] = extracted.get(field, existing.get(field))
    else:
        for key in ("goal", "hours", "role", "availability", "skills"):
            if key in extracted:
                merged[key] = extracted[key]
    merged["conflict_mode"] = existing.get("conflict_mode", "vote")
    return normalize_availability_in_profile(merged)


def _heuristic_update(existing: dict, text: str, field: str) -> tuple[dict, str | None]:
    extracted = _heuristic_extract(text)
    if field == "hours" and not re.search(r"\d+", text or ""):
        return existing, "Roughly how many hours a week should we set?"
    if field == "goal" and extracted.get("goal") == existing.get("goal") and extracted.get("clarifying_questions"):
        return existing, extracted["clarifying_questions"][0]
    if field == "role":
        parsed = _parse_team_role(text)
        if parsed is None:
            return existing, "Should we set you as lead, contributor, or either?"
        extracted["role"] = parsed
    if field == "skills":
        rating = _parse_skill_rating(text)
        if rating is None:
            return existing, "Give a 1–5 rating for the skill you want to change, or list all four."
    merged = _merge_profile(existing, extracted, field)
    return merged, None


def _parse_goal(text: str) -> str | None:
    t = (text or "").lower()
    if re.search(r"research|publish|paper|phd|thesis", t):
        return "research"
    if re.search(r"deep mastery|really learn|master the material|mastery", t):
        return "deep_mastery"
    if re.search(r"just (need to |trying to )?pass|bare minimum|\bpass\b", t) and not re.search(
        r"pass(?:ing)? (?:on|up)", t
    ):
        if re.search(r"grade|\ban a\b|ace|4\.0|research|mastery", t):
            return None
        return "pass"
    if re.search(r"grade a|\ban a\b|aiming for an a|strong grade|4\.0|ace this", t):
        return "grade_A"
    return None


def _parse_hours(text: str) -> int | None:
    raw = text or ""
    range_hit = re.search(r"(\d+)\s*[-–to]+\s*(\d+)", raw, re.I)
    if range_hit:
        a, b = int(range_hit.group(1)), int(range_hit.group(2))
        if 1 <= a <= 40 and 1 <= b <= 40:
            return max(1, min(40, round((a + b) / 2)))
    nums = [int(n) for n in re.findall(r"\d+", raw)]
    in_range = [n for n in nums if 1 <= n <= 40]
    if len(in_range) != 1:
        return None
    return in_range[0]


def _slots_from_text(text: str) -> list[str]:
    t = (text or "").lower()
    day_aliases = {
        "monday": "mon",
        "mon": "mon",
        "tuesday": "tue",
        "tue": "tue",
        "tues": "tue",
        "wednesday": "wed",
        "wed": "wed",
        "thursday": "thu",
        "thu": "thu",
        "thur": "thu",
        "thurs": "thu",
        "friday": "fri",
        "fri": "fri",
        "saturday": "sat",
        "sat": "sat",
        "sunday": "sun",
        "sun": "sun",
    }
    times_found: list[str] = []
    if re.search(r"morning|9\s*[-–]\s*12|9am", t):
        times_found.append("morning")
    if re.search(r"afternoon|12\s*[-–]\s*5|noon", t):
        times_found.append("afternoon")
    if re.search(r"evening|5\s*[-–]\s*9|night", t):
        times_found.append("evening")
    days_found = [code for word, code in day_aliases.items() if re.search(rf"\b{word}\b", t)]
    days_u = list(dict.fromkeys(days_found))
    if days_u and times_found:
        return normalize_availability([f"{d}_{tm}" for d in days_u for tm in times_found], fill_default=False)
    coarse: list[str] = []
    if re.search(r"weekend", t):
        coarse.append("weekend")
    if re.search(r"weekday", t) and times_found:
        coarse.extend(f"weekday_{tm}" for tm in times_found)
    elif times_found and not days_u:
        coarse.extend(f"weekday_{tm}" for tm in times_found)
    return normalize_availability(coarse, fill_default=False)


def _parse_skill_rating(text: str) -> int | None:
    """Accept only an explicit 1–5. Out-of-range values like 6 are rejected."""
    nums = [int(n) for n in re.findall(r"\d+", text or "")]
    if not nums:
        return None
    if any(n < 1 or n > 5 for n in nums):
        return None
    in_range = [n for n in nums if 1 <= n <= 5]
    if len(in_range) != 1:
        return None
    return in_range[0]


def _parse_team_role(text: str) -> str | None:
    t = (text or "").lower()
    if re.search(
        r"\beither\b|no preference|don't mind|do not mind|fine with (?:either|both)|"
        r"\bwhatever\b|flexible|either way",
        t,
    ):
        return "either"
    if re.search(r"\bcontribut|\bsupport", t):
        return "contributor"
    if re.search(r"\blead", t):
        return "lead"
    return None


# ---------------------------------------------------------------------------
# Heuristic fallbacks — used only when XAI_API_KEY is unset, so the app runs
# end to end with zero setup. Replace by adding a key to backend/.env.
# ---------------------------------------------------------------------------

def _heuristic_extract(bio: str) -> dict:
    text = " " + bio.lower()
    questions = []

    goal = "grade_A"
    if re.search(r"research|publish|paper|phd|thesis", text):
        goal = "research"
    elif re.search(r"deep|mastery|master this|really (understand|learn)", text):
        goal = "deep_mastery"
    elif re.search(r"just (need to |trying to |)pass|bare minimum", text):
        goal = "pass"
    elif not re.search(r"\ban a\b|grade a|4\.0|ace this", text):
        questions.append("What's the main goal here — just passing, aiming for an A, a research outcome, or deep mastery?")

    hours = 8
    hours_match = re.search(r"(\d{1,2})\s*hours?", text)
    if hours_match:
        hours = int(hours_match.group(1))
    else:
        questions.append("Roughly how many hours a week can you commit?")

    availability: list[str] = []
    # Prefer explicit day mentions; otherwise expand coarse buckets via normalize.
    day_aliases = {
        "monday": "mon", "mon": "mon",
        "tuesday": "tue", "tue": "tue", "tues": "tue",
        "wednesday": "wed", "wed": "wed",
        "thursday": "thu", "thu": "thu", "thur": "thu", "thurs": "thu",
        "friday": "fri", "fri": "fri",
        "saturday": "sat", "sat": "sat",
        "sunday": "sun", "sun": "sun",
    }
    times_found = []
    if re.search(r"morning|9\s*[-–]\s*12|9am", text):
        times_found.append("morning")
    if re.search(r"afternoon|12\s*[-–]\s*5|noon", text):
        times_found.append("afternoon")
    if re.search(r"evening|5\s*[-–]\s*9|night", text):
        times_found.append("evening")
    days_found = [code for word, code in day_aliases.items() if re.search(rf"\b{word}\b", text)]
    # unique days preserving order
    days_u = list(dict.fromkeys(days_found))
    if days_u and times_found:
        availability = [f"{d}_{t}" for d in days_u for t in times_found]
    else:
        coarse = []
        if re.search(r"weekend", text):
            coarse.append("weekend")
        if re.search(r"evening", text):
            coarse.append("weekday_evening")
        if re.search(r"morning", text):
            coarse.append("weekday_morning")
        if re.search(r"afternoon", text):
            coarse.append("weekday_afternoon")
        availability = normalize_availability(coarse or ["weekday_evening"])

    skills = {"technical": 3, "writing": 3, "analysis": 3, "presentation": 3}
    weak_near = r"(?:weak|hate|avoid|rather not|don't like|do not like|not good|rather leave|leave)\b.{0,28}"

    if re.search(r"frontend|\bui\b|design|backend|algorithm|coding|programming|build(?:ing)?|\bcode\b", text):
        skills["technical"] = 1 if re.search(weak_near + r"(?:cod|tech|program|front|back|build)", text) else 5
    if re.search(r"writing|writer|docs|reports?", text):
        skills["writing"] = 1 if re.search(weak_near + r"writ", text) else 5
    if re.search(r"stats|statistics|data analysis|\banalysis\b|analytic", text):
        skills["analysis"] = 1 if re.search(weak_near + r"(?:stat|analy)", text) else 5
    if re.search(r"presenting|presentation|public speak|pitch(?:ing)?|demos?", text):
        skills["presentation"] = 1 if re.search(weak_near + r"(?:present|speak|pitch|demo)", text) else 5
    weak_match = re.search(
        r"(?:weak|hate|avoid|rather not|don't like|do not like|not good|rather leave)(?:\s+(?:at|on|in|doing|owning))?\s+(\w+)",
        text,
    )
    if weak_match:
        kw = weak_match.group(1)
        if re.search(r"stat|analy", kw):
            skills["analysis"] = 1
        elif re.search(r"writ", kw):
            skills["writing"] = 1
        elif re.search(r"present|speak|pitch|demo", kw):
            skills["presentation"] = 1
        elif re.search(r"cod|tech|program|front|back|build", kw):
            skills["technical"] = 1

    role = "either"
    if re.search(r"like to lead|prefer(s)? to lead|leading|leader", text):
        role = "lead"
    elif re.search(r"happy to support|not looking to lead|contribut", text):
        role = "contributor"

    conflict_mode = "vote"
    if re.search(r"rotate", text):
        conflict_mode = "rotate_lead"
    elif re.search(r"escalate|\bta\b|professor|instructor", text):
        conflict_mode = "escalate"
    elif re.search(r"most invested|whoever cares most", text):
        conflict_mode = "defer_to_invested"

    confidence = 0.9 if not questions else 0.55

    return {
        "goal": goal,
        "availability": availability,
        "skills": skills,
        "hours": hours,
        "role": role,
        "conflict_mode": conflict_mode,
        "confidence": confidence,
        "clarifying_questions": questions[:2],
    }


GOAL_LABELS = {"pass": "passing", "grade_A": "getting an A", "research": "a research outcome", "deep_mastery": "deep mastery"}


def _heuristic_rationale(member_names: list[str], breakdown: dict, dominant_goal_label: str) -> str:
    factor_labels = {"goal": "goal alignment", "avail": "shared availability", "skill": "skill coverage", "workload": "similar time commitment"}
    strong = [k for k, v in sorted(breakdown.items(), key=lambda kv: -kv[1]) if v >= 0.65 and k in factor_labels]
    names = ", ".join(member_names)
    if not strong:
        return f"{names} are balanced across goals, schedules, and skills without one factor dominating."
    labels = " and ".join(factor_labels[k] for k in strong[:2])
    sentence = f"{names} align most on {labels}."
    if breakdown.get("goal", 0) >= 0.65:
        sentence += f" Most of the team is leaning toward {GOAL_LABELS.get(dominant_goal_label, dominant_goal_label)} as the shared target."
    return sentence
