import random
from itertools import combinations

from .scoring import pair_score

BREAKDOWN_KEYS = ["goal", "avail", "skill", "workload"]


def team_stats(members: list, vetoes: set) -> dict:
    total = 0.0
    violations = 0
    agg = {k: 0.0 for k in BREAKDOWN_KEYS}
    count = 0

    for a, b in combinations(members, 2):
        count += 1
        result = pair_score(a, b, vetoes)
        if result is None:
            # explicit veto pair landed together anyway (only possible in the
            # random baseline, never in the solver's own output)
            violations += 1
            total += -1.5
            continue
        total += result["score"]
        if result.get("hard_conflict"):
            violations += 1
        else:
            for k in BREAKDOWN_KEYS:
                agg[k] += result["breakdown"][k]

    scored_pairs = max(1, count - violations)
    breakdown = {k: agg[k] / scored_pairs for k in BREAKDOWN_KEYS}
    avg = total / count if count else 0.0
    return {"avg": avg, "violations": violations, "breakdown": breakdown}


def total_score(teams: list[list], vetoes: set) -> float:
    if not teams:
        return 0.0
    return sum(team_stats(t, vetoes)["avg"] for t in teams) / len(teams)


def random_baseline_score(people: list, vetoes: set, max_size: int) -> float:
    shuffled = people[:]
    random.shuffle(shuffled)
    teams = [shuffled[i:i + max_size] for i in range(0, len(shuffled), max_size)]
    return total_score(teams, vetoes)


def best_swap_for_person(teams: list[list], person_id: str, vetoes: set):
    """Local re-optimization for the 'flag this team' flow: search every
    possible swap of the flagged person with someone on a different team,
    and return the swap that improves total score the most (or None)."""
    current_idx = next(i for i, t in enumerate(teams) if any(m.id == person_id for m in t))
    current_team = teams[current_idx]
    person = next(m for m in current_team if m.id == person_id)

    best = None
    for j, other_team in enumerate(teams):
        if j == current_idx:
            continue
        for candidate in other_team:
            before = team_stats(current_team, vetoes)["avg"] + team_stats(other_team, vetoes)["avg"]

            ci = current_team.index(person)
            oi = other_team.index(candidate)
            current_team[ci], other_team[oi] = candidate, person
            after = team_stats(current_team, vetoes)["avg"] + team_stats(other_team, vetoes)["avg"]
            current_team[ci], other_team[oi] = person, candidate  # revert, apply only the winner below

            delta = after - before
            if best is None or delta > best["delta"]:
                best = {"delta": delta, "current_idx": current_idx, "other_idx": j, "candidate": candidate, "person": person}

    return best


def apply_swap(teams: list[list], swap: dict):
    current_team = teams[swap["current_idx"]]
    other_team = teams[swap["other_idx"]]
    ci = current_team.index(swap["person"])
    oi = other_team.index(swap["candidate"])
    current_team[ci], other_team[oi] = swap["candidate"], swap["person"]
    return teams
