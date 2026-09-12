"""
The optimizer. Formulates team assignment as an integer program and solves it
with OR-Tools CP-SAT, this is the "Optimization track" core of the project.

Model:
  x[i, t]      = 1 if person i is assigned to team t
  y[i, j, t]   = 1 iff persons i and j are BOTH on team t (linearized AND)

Constraints:
  - each person assigned to exactly one team
  - each team size within [min_size, max_size]
  - explicit organizer vetoes never share a team (hard cut)
  - zero schedule overlap is a steep penalty in pair_score, not a hard cut

Objective (Rawlsian floor + ε-sum):
  maximize  BIG * floor + sum_t avg_L[t]
  where avg_L[t] is the size-normalized pair-average on team t (same quantity
  team_stats reports as avg) and floor <= avg_L[t] for every team. BIG is large
  enough that raising the floor by one scaled unit always beats any gain in the
  sum, i.e. lex maximin then total quality.
"""

from dataclasses import dataclass
from itertools import combinations
from math import comb, lcm

from ortools.sat.python import cp_model

from .scoring import pair_score

SCALE = 1000  # CP-SAT needs integer coefficients; we scale float scores up
# Bounds pad the observed pair-score range (hard conflict -1.5 … ~1.0)
SCORE_INT_MIN = -2 * SCALE
SCORE_INT_MAX = 2 * SCALE


@dataclass
class SolveResult:
    teams: list[list]
    status: str  # "OPTIMAL" | "FEASIBLE"


def feasible_team_count(n: int, min_size: int, max_size: int) -> int:
    """Smallest k with k * min_size <= n <= k * max_size.

    round(n / max_size) is not always feasible (e.g. n=13, min=3, max=4).
    Prefer the smallest legal k so teams stay as close to max_size as possible.
    """
    if min_size < 1 or max_size < min_size:
        raise RuntimeError(f"Invalid team size bounds [{min_size}, {max_size}].")
    candidates = [k for k in range(1, n + 1) if k * min_size <= n <= k * max_size]
    if not candidates:
        raise RuntimeError(
            f"No feasible team count for {n} people with sizes [{min_size}, {max_size}]. "
            "Try relaxing team size bounds."
        )
    return min(candidates)


def legal_team_sizes(n: int, min_size: int, max_size: int) -> list[int]:
    """Concrete sizes summing to n, each in [min_size, max_size], for the chosen k.
    Sizes differ by at most one when extra seats are spread evenly."""
    k = feasible_team_count(n, min_size, max_size)
    base = n // k
    extra = n % k
    sizes = [base + 1] * extra + [base] * (k - extra)
    if any(s < min_size or s > max_size for s in sizes):
        raise RuntimeError(
            f"No feasible team sizes for {n} people with bounds [{min_size}, {max_size}]."
        )
    return sizes


def _pair_coeff(result: dict) -> int:
    return int(round(result["score"] * SCALE))


def _status_name(status) -> str:
    if status == cp_model.OPTIMAL:
        return "OPTIMAL"
    if status == cp_model.FEASIBLE:
        return "FEASIBLE"
    return "INFEASIBLE"


def solve_teams(
    people: list,
    min_size: int,
    max_size: int,
    vetoes: set,
    time_limit_s: float = 10.0,
) -> list[list]:
    return solve_teams_detailed(people, min_size, max_size, vetoes, time_limit_s).teams


def solve_teams_detailed(
    people: list,
    min_size: int,
    max_size: int,
    vetoes: set,
    time_limit_s: float = 10.0,
) -> SolveResult:
    n = len(people)
    if n == 0:
        return SolveResult(teams=[], status="OPTIMAL")
    if n < min_size:
        raise RuntimeError(f"Not enough people ({n}) to form even one team of {min_size}.")

    num_teams = feasible_team_count(n, min_size, max_size)
    planned_sizes = legal_team_sizes(n, min_size, max_size)
    uniform_size = planned_sizes[0] if len(set(planned_sizes)) == 1 else None
    legal_sizes = list(range(min_size, max_size + 1))
    pair_counts = [comb(s, 2) for s in legal_sizes]
    if any(pc <= 0 for pc in pair_counts):
        raise RuntimeError("Team min_size must be at least 2 so a pair-average is defined.")
    avg_lcm = lcm(*pair_counts) if len(pair_counts) > 1 else pair_counts[0]

    model = cp_model.CpModel()
    x = {(i, t): model.NewBoolVar(f"x_{i}_{t}") for i in range(n) for t in range(num_teams)}

    for i in range(n):
        model.Add(sum(x[i, t] for t in range(num_teams)) == 1)

    size_is = {}
    for t in range(num_teams):
        team_size = sum(x[i, t] for i in range(n))
        if uniform_size is not None:
            model.Add(team_size == uniform_size)
        else:
            model.Add(team_size >= min_size)
            model.Add(team_size <= max_size)
            zs = {s: model.NewBoolVar(f"z_{t}_{s}") for s in legal_sizes}
            size_is[t] = zs
            model.Add(sum(zs[s] for s in legal_sizes) == 1)
            model.Add(team_size == sum(s * zs[s] for s in legal_sizes))

    # Pair terms: vetoes hard-excluded; everyone else contributes to team_sum.
    team_sum = [
        model.NewIntVar(
            comb(max_size, 2) * SCORE_INT_MIN,
            comb(max_size, 2) * SCORE_INT_MAX,
            f"team_sum_{t}",
        )
        for t in range(num_teams)
    ]
    pair_terms = {t: [] for t in range(num_teams)}

    for i, j in combinations(range(n), 2):
        result = pair_score(people[i], people[j], vetoes)
        if result is None:
            for t in range(num_teams):
                model.Add(x[i, t] + x[j, t] <= 1)
            continue

        coeff = _pair_coeff(result)
        for t in range(num_teams):
            y = model.NewBoolVar(f"y_{i}_{j}_{t}")
            model.Add(y <= x[i, t])
            model.Add(y <= x[j, t])
            model.Add(y >= x[i, t] + x[j, t] - 1)
            pair_terms[t].append(coeff * y)

    for t in range(num_teams):
        if pair_terms[t]:
            model.Add(team_sum[t] == sum(pair_terms[t]))
        else:
            model.Add(team_sum[t] == 0)

    # Size-normalized average on a common integer scale of avg_lcm:
    # avg_L = avg_lcm * (team_sum / C(s,2)) = (avg_lcm // C(s,2)) * team_sum
    avg_min = avg_lcm * SCORE_INT_MIN
    avg_max = avg_lcm * SCORE_INT_MAX
    avg_l = [
        model.NewIntVar(avg_min, avg_max, f"avg_l_{t}") for t in range(num_teams)
    ]
    if uniform_size is not None:
        coef = avg_lcm // comb(uniform_size, 2)
        for t in range(num_teams):
            model.Add(avg_l[t] == coef * team_sum[t])
    else:
        for t in range(num_teams):
            for s in legal_sizes:
                coef = avg_lcm // comb(s, 2)
                model.Add(avg_l[t] == coef * team_sum[t]).OnlyEnforceIf(size_is[t][s])

    floor = model.NewIntVar(avg_min, avg_max, "floor")
    for t in range(num_teams):
        model.Add(floor <= avg_l[t])

    rng = avg_max - avg_min
    big = num_teams * rng + 1
    model.Maximize(big * floor + sum(avg_l))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit_s
    solver.parameters.num_search_workers = 8
    status = solver.Solve(model)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        raise RuntimeError(
            "No feasible team assignment exists under the current constraints. This usually "
            "means a veto or availability gap makes some team impossible to fill. "
            "Try relaxing team size bounds or reviewing vetoes."
        )

    teams: list[list] = [[] for _ in range(num_teams)]
    for i in range(n):
        for t in range(num_teams):
            if solver.Value(x[i, t]) == 1:
                teams[t].append(people[i])
                break

    return SolveResult(
        teams=[team for team in teams if team],
        status=_status_name(status),
    )
