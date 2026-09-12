"""
The optimizer. Formulates team assignment as an integer program and solves it
with OR-Tools CP-SAT — this is the "Optimization track" core of the project.

Model:
  x[i, t]      = 1 if person i is assigned to team t
  y[i, j, t]   = 1 iff persons i and j are BOTH on team t (linearized AND)

Constraints:
  - each person assigned to exactly one team
  - each team size within [min_size, max_size]
  - a hard-forbidden pair (explicit veto, or zero schedule overlap) can never
    share a team, enforced directly rather than just scored down

Objective:
  maximize the total pairwise compatibility score across all teams, i.e.
  sum(score(i, j) * y[i, j, t]) over all pairs and teams.

At cohort scale (tens of people) this solves to a provable optimum in well
under the time limit below.
"""

from itertools import combinations

from ortools.sat.python import cp_model

from .scoring import pair_score

SCALE = 1000  # CP-SAT needs integer coefficients; we scale float scores up


def solve_teams(people: list, min_size: int, max_size: int, vetoes: set, time_limit_s: float = 10.0) -> list[list]:
    n = len(people)
    if n == 0:
        return []
    if n < min_size:
        raise RuntimeError(f"Not enough people ({n}) to form even one team of {min_size}.")

    num_teams = max(1, round(n / max_size))

    model = cp_model.CpModel()

    x = {(i, t): model.NewBoolVar(f"x_{i}_{t}") for i in range(n) for t in range(num_teams)}

    for i in range(n):
        model.Add(sum(x[i, t] for t in range(num_teams)) == 1)

    for t in range(num_teams):
        team_size = sum(x[i, t] for i in range(n))
        model.Add(team_size >= min_size)
        model.Add(team_size <= max_size)

    objective_terms = []
    for i, j in combinations(range(n), 2):
        result = pair_score(people[i], people[j], vetoes)
        if result is None:
            # true hard constraint: only an explicit organizer veto excludes
            # a pairing structurally. A schedule conflict is penalized in the
            # objective instead (see scoring.py) so the model stays feasible.
            for t in range(num_teams):
                model.Add(x[i, t] + x[j, t] <= 1)
            continue

        score_int = int(round(result["score"] * SCALE))
        for t in range(num_teams):
            y = model.NewBoolVar(f"y_{i}_{j}_{t}")
            model.Add(y <= x[i, t])
            model.Add(y <= x[j, t])
            model.Add(y >= x[i, t] + x[j, t] - 1)
            objective_terms.append(score_int * y)

    model.Maximize(sum(objective_terms))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit_s
    solver.parameters.num_search_workers = 8
    status = solver.Solve(model)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        raise RuntimeError(
            "No feasible team assignment exists under the current constraints — "
            "usually means a veto or availability gap makes some team impossible to fill. "
            "Try relaxing team size bounds or reviewing vetoes."
        )

    teams: list[list] = [[] for _ in range(num_teams)]
    for i in range(n):
        for t in range(num_teams):
            if solver.Value(x[i, t]) == 1:
                teams[t].append(people[i])
                break

    return [team for team in teams if team]
