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

If XAI_API_KEY isn't set, each function falls back to a plain heuristic so
the rest of the app is runnable and demoable with zero setup — swap in your
key in .env and every response starts coming from Grok instead.
"""

import json
import re

from openai import OpenAI

from .config import XAI_API_KEY, XAI_MODEL, XAI_BASE_URL
from .slots import ALL_SLOTS, normalize_availability

_client = OpenAI(api_key=XAI_API_KEY, base_url=XAI_BASE_URL) if XAI_API_KEY else None

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


def normalize_availability_in_profile(data: dict) -> dict:
    data = dict(data)
    data["availability"] = normalize_availability(list(data.get("availability") or []))
    return data


def resolve_clarification(name: str, bio: str, course_context: str, qa_pairs: list[tuple[str, str]]) -> dict:
    """Append the Q&A as extra context and re-run extraction — the simplest
    reliable way to fold a clarifying answer back into the structured profile."""
    extra = "\n".join(f"Q: {q}\nA: {a}" for q, a in qa_pairs)
    enriched_bio = f"{bio}\n\nAdditional clarification:\n{extra}"
    return extract_profile(name, enriched_bio, course_context)


def generate_rationale(member_names: list[str], breakdown: dict, dominant_goal_label: str) -> str:
    if _client is None:
        return _heuristic_rationale(member_names, breakdown, dominant_goal_label)

    response = _client.chat.completions.create(
        model=XAI_MODEL,
        messages=[
            {
                "role": "system",
                "content": (
                    "Write ONE short, plain-language sentence explaining why this team was grouped "
                    "together, for the students themselves to read. Base it only on the scores given "
                    "(0-1 scale, higher is better alignment). No hedging, no filler, no restating the "
                    "numbers directly — describe what they mean. Do NOT reveal anyone's private "
                    "preferences, hours, skill ratings, or survey answers — speak only in terms of "
                    "shared fit (goals, schedules, complementary strengths, similar commitment)."
                ),
            },
            {
                "role": "user",
                "content": json.dumps({"members": member_names, "scores": breakdown, "most_common_goal": dominant_goal_label}),
            },
        ],
        temperature=0.4,
    )
    return response.choices[0].message.content.strip()


_SKILL_KEYS = ("technical", "writing", "analysis", "presentation")
_SKILL_REASK = (
    "How would you rate your technical skills, from 1 to 5?",
    "How would you rate your writing, from 1 to 5?",
    "How would you rate your analysis skills, from 1 to 5?",
    "How would you rate your presenting, from 1 to 5?",
)


_ROLE_QUESTION = (
    "On a team, would you rather lead, contribute, or are you fine with either?"
)
_ROLE_REASK = (
    "Please pick one: lead, contribute, or either."
)


def chat_turn(name: str, messages: list[dict], course_context: str) -> dict:
    """One conversational turn for the student-facing personality interview.

    Questions are scripted so every category is asked. Extraction (Grok or
    heuristic) only runs after the last answer — the matcher is unchanged.
    """
    user_turns = [m["content"] for m in messages if m["role"] == "user"]
    script = _interview_script(name)

    if len(user_turns) < 3:
        return {"reply": script[len(user_turns)], "ready": False, "profile": None}

    ratings: list[int] = []
    team_role: str | None = None
    last_invalid_skill = False
    last_invalid_role = False
    for reply in user_turns[3:]:
        if len(ratings) < 4:
            parsed = _parse_skill_rating(reply)
            if parsed is None:
                last_invalid_skill = True
                continue
            ratings.append(parsed)
            last_invalid_skill = False
            continue
        parsed_role = _parse_team_role(reply)
        if parsed_role is None:
            last_invalid_role = True
            continue
        team_role = parsed_role
        last_invalid_role = False
        break

    if len(ratings) < 4:
        nxt = _SKILL_REASK[len(ratings)]
        if last_invalid_skill:
            reply = (
                "That needs to be a whole number from 1 to 5 — 6 or anything outside "
                f"that range doesn’t count. {nxt}"
            )
        else:
            reply = script[3 + len(ratings)]
        return {"reply": reply, "ready": False, "profile": None}

    if team_role is None:
        reply = _ROLE_REASK if last_invalid_role else _ROLE_QUESTION
        return {"reply": reply, "ready": False, "profile": None}

    early = " ".join(user_turns[:3])
    if _client is not None:
        extracted = extract_profile(name, early, course_context)
    else:
        extracted = _heuristic_extract(early)

    extracted.pop("clarifying_questions", None)
    extracted["skills"] = {key: ratings[i] for i, key in enumerate(_SKILL_KEYS)}
    extracted["role"] = team_role
    extracted["conflict_mode"] = "vote"
    extracted = normalize_availability_in_profile(extracted)
    return {
        "reply": f"Thanks {name} — that’s everything we need. Find your team whenever you’re ready.",
        "ready": True,
        "profile": extracted,
    }


def _interview_script(name: str) -> list[str]:
    return [
        (
            f"Hey {name} — a few easy questions so we can put you with people who want "
            "a similar outcome. To start: what would make this project feel successful "
            "for you? Some people just want to finish it, others want a strong grade, "
            "a research angle, or to really learn the material."
        ),
        "Got it. Roughly how many hours a week can you actually put into this?",
        (
            "When are you usually free to meet — which days work, "
            "and is that mornings, afternoons, or evenings?"
        ),
        (
            "Next, four quick ratings so we can balance the team — just a number from 1 to 5, "
            "where 1 is not your thing and 5 is a real strength. "
            "First: how would you rate your technical skills?"
        ),
        "How would you rate your writing, from 1 to 5?",
        "How would you rate your analysis skills, from 1 to 5?",
        "How would you rate your presenting, from 1 to 5?",
    ]


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
