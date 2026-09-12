import copy
import random
from itertools import combinations

from .scoring import pair_score
from .solver import legal_team_sizes, solve_teams

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


def floor_score(teams: list[list], vetoes: set) -> float:
    if not teams:
        return 0.0
    return min(team_stats(t, vetoes)["avg"] for t in teams)


def legal_random_partition(people: list, min_size: int, max_size: int, rng: random.Random | None = None):
    rng = rng or random
    shuffled = people[:]
    rng.shuffle(shuffled)
    sizes = legal_team_sizes(len(people), min_size, max_size)
    teams = []
    idx = 0
    for size in sizes:
        teams.append(shuffled[idx : idx + size])
        idx += size
    return teams


def random_baseline_score(
    people: list,
    vetoes: set,
    min_size: int,
    max_size: int,
    samples: int = 16,
    rng: random.Random | None = None,
) -> float:
    """Mean of legal random partitions (same size bounds as the solver)."""
    rng = rng or random.Random()
    if not people:
        return 0.0
    scores = [
        total_score(legal_random_partition(people, min_size, max_size, rng), vetoes)
        for _ in range(samples)
    ]
    return sum(scores) / len(scores)


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


def _best_subset_resolve(teams: list[list], person_id: str, vetoes: set, min_size: int, max_size: int):
    """When a single swap can't help, re-solve the flagged person's team
    paired with each other team (the affected subset) and keep the best
    improving reassignment, leaves every other team untouched."""
    current_idx = next(i for i, t in enumerate(teams) if any(m.id == person_id for m in t))
    before = total_score(teams, vetoes)
    best = None

    for j, other_team in enumerate(teams):
        if j == current_idx:
            continue
        subset = list(teams[current_idx]) + list(other_team)
        try:
            resolved = solve_teams(subset, min_size, max_size, vetoes, time_limit_s=3.0)
        except RuntimeError:
            continue
        if len(resolved) != 2:
            continue

        trial = copy.deepcopy(teams)
        trial[current_idx] = resolved[0]
        trial[j] = resolved[1]
        after = total_score(trial, vetoes)
        delta = after - before
        if delta > 0 and (best is None or delta > best["delta"]):
            best = {"delta": delta, "teams": trial, "other_idx": j}

    return best


def reoptimize_for_flag(
    teams: list[list],
    person_id: str,
    vetoes: set,
    min_size: int,
    max_size: int,
) -> tuple[list[list], str]:
    """Flag flow: try a single swap first; if that can't improve the score,
    fall back to a CP-SAT re-solve of the affected two-team subset. Returns
    (teams, human-readable note) so the UI never pretends a no-op worked."""
    person_name = next(m.name for t in teams for m in t if m.id == person_id)

    swap = best_swap_for_person(teams, person_id, vetoes)
    if swap and swap["delta"] > 0:
        apply_swap(teams, swap)
        note = (
            f"Swapped {swap['person'].name} with {swap['candidate'].name} "
            f"(+{swap['delta']:.2f} on the two affected teams)."
        )
        return teams, note

    subset = _best_subset_resolve(teams, person_id, vetoes, min_size, max_size)
    if subset:
        note = (
            f"No single swap helped {person_name}; re-solved their team plus one "
            f"neighbor team with CP-SAT (+{subset['delta']:.2f} overall)."
        )
        return subset["teams"], note

    note = (
        f"No improving single swap or local re-solve found for {person_name}. "
        "This conflict looks structural (e.g. unique availability). "
        "Adjust profiles or vetoes, then run Optimize again."
    )
    return teams, note
