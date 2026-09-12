"""Shared availability vocabulary: day × time-of-day.

Stored as strings like ``mon_evening`` so Jaccard overlap stays simple
in scoring.py while the UI can show a clear calendar grid.
"""

from __future__ import annotations

DAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
TIMES = ("morning", "afternoon", "evening")

DAY_LABEL = {
    "mon": "Mon",
    "tue": "Tue",
    "wed": "Wed",
    "thu": "Thu",
    "fri": "Fri",
    "sat": "Sat",
    "sun": "Sun",
}

DAY_SPOKEN = {
    "mon": "Monday",
    "tue": "Tuesday",
    "wed": "Wednesday",
    "thu": "Thursday",
    "fri": "Friday",
    "sat": "Saturday",
    "sun": "Sunday",
}

TIME_SPOKEN = {
    "morning": "mornings",
    "afternoon": "afternoons",
    "evening": "evenings",
}

TIME_LABEL = {
    "morning": "Morning (9am–12pm)",
    "afternoon": "Afternoon (12–5pm)",
    "evening": "Evening (5–9pm)",
}

ALL_SLOTS: tuple[str, ...] = tuple(f"{d}_{t}" for d in DAYS for t in TIMES)

# Map the older coarse buckets (still accepted from older clients / Grok slips).
_LEGACY = {
    "weekday_morning": [f"{d}_morning" for d in DAYS[:5]],
    "weekday_afternoon": [f"{d}_afternoon" for d in DAYS[:5]],
    "weekday_evening": [f"{d}_evening" for d in DAYS[:5]],
    "weekend": ["sat_morning", "sat_afternoon", "sat_evening", "sun_morning", "sun_afternoon", "sun_evening"],
}


def normalize_availability(slots: list[str], *, fill_default: bool = True) -> list[str]:
    out: list[str] = []
    for s in slots:
        key = s.strip().lower().replace(" ", "_")
        if key in _LEGACY:
            out.extend(_LEGACY[key])
        elif key in ALL_SLOTS:
            out.append(key)
    # stable unique
    seen: set[str] = set()
    ordered: list[str] = []
    for s in out:
        if s not in seen:
            seen.add(s)
            ordered.append(s)
    if ordered:
        return ordered
    return ["wed_evening"] if fill_default else []


def spoken_slot(slot: str) -> str:
    parts = slot.strip().lower().replace(" ", "_").split("_")
    if len(parts) != 2:
        return slot.replace("_", " ")
    day, time = parts
    return f"{DAY_SPOKEN.get(day, day)} {TIME_SPOKEN.get(time, time)}"


def spoken_slots(slots: list[str]) -> str:
    labels = [spoken_slot(s) for s in slots]
    if not labels:
        return ""
    if len(labels) == 1:
        return labels[0]
    if len(labels) == 2:
        return f"{labels[0]} and {labels[1]}"
    return ", ".join(labels[:-1]) + f", and {labels[-1]}"
