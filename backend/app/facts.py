"""Aggregated team facts students can see without leaking anyone's answers."""

from __future__ import annotations

from collections import Counter

from .models import DEFAULT_SKILL_LABELS, SKILL_KEYS
from .slots import DAY_LABEL

GOAL_PHRASE = {
    "pass": "Get the project done",
    "grade_A": "Aim for a strong grade",
    "research": "Push a research angle",
    "deep_mastery": "Learn the material deeply",
}

SKILL_LABEL = dict(DEFAULT_SKILL_LABELS)

_TIME_SHORT = {"morning": "morning", "afternoon": "afternoon", "evening": "evening"}
_SKILL_KEYS = SKILL_KEYS


def human_slot(slot: str) -> str:
    day, _, time = slot.partition("_")
    return f"{DAY_LABEL.get(day, day)} {_TIME_SHORT.get(time, time)}"


def human_list(items: list[str]) -> str:
    if not items:
        return ""
    if len(items) == 1:
        return items[0]
    if len(items) == 2:
        return f"{items[0]} and {items[1]}"
    return f"{', '.join(items[:-1])}, and {items[-1]}"


def shared_windows(members: list) -> list[str]:
    if not members:
        return []
    overlap = set(members[0].availability)
    for m in members[1:]:
        overlap &= set(m.availability)
    return sorted(overlap)


def skill_coverage(members: list, keys: list[str] | tuple[str, ...] | None = None) -> tuple[list[str], list[str]]:
    covered: list[str] = []
    thin: list[str] = []
    for key in keys or _SKILL_KEYS:
        peak = max(getattr(m.skills, key) for m in members)
        (covered if peak >= 4 else thin).append(key)
    return covered, thin


def skill_peaks(members: list, keys: list[str] | tuple[str, ...] | None = None) -> dict[str, int]:
    return {key: max(getattr(m.skills, key) for m in members) for key in (keys or _SKILL_KEYS)}


def dominant_goal(members: list) -> str:
    if not members:
        return "grade_A"
    return Counter(m.goal for m in members).most_common(1)[0][0]


def grounded_why(
    shared: list[str],
    goal: str,
    covered: list[str],
    thin: list[str],
    skill_labels: dict[str, str] | None = None,
) -> str:
    parts: list[str] = []
    if shared:
        parts.append(f"You share {human_list([human_slot(s) for s in shared])}")
    else:
        parts.append("There’s no fully shared meeting window, so plan to work async")
    phrase = GOAL_PHRASE.get(goal, goal)
    parts.append(f"the team goal is to {phrase[0].lower() + phrase[1:]}")
    labels = {**SKILL_LABEL, **(skill_labels or {})}
    cov = [labels.get(k, k) for k in covered]
    weak = [labels.get(k, k) for k in thin]
    if cov:
        verb = "is" if len(cov) == 1 else "are"
        parts.append(f"{human_list(cov)} {verb} covered")
    if weak:
        verb = "is" if len(weak) == 1 else "are"
        parts.append(f"{human_list(weak)} {verb} thinner")
    sentences = []
    for part in parts:
        cleaned = part.strip()
        if not cleaned:
            continue
        sentences.append(cleaned[0].upper() + cleaned[1:])
    return ". ".join(sentences) + "."


def team_facts(
    members: list,
    focus_skills: list[str] | None = None,
    skill_labels: dict[str, str] | None = None,
) -> dict:
    shared = shared_windows(members)
    goal = dominant_goal(members)
    keys = focus_skills or list(_SKILL_KEYS)
    covered, thin = skill_coverage(members, keys)
    return {
        "shared_windows": shared,
        "team_goal": GOAL_PHRASE.get(goal, goal),
        "goal_key": goal,
        "coverage": covered,
        "thin": thin,
        "skill_peaks": skill_peaks(members, keys),
        "rationale": grounded_why(shared, goal, covered, thin, skill_labels),
    }
