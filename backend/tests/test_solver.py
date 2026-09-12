from itertools import combinations

import pytest

from app.analysis import floor_score, legal_random_partition, random_baseline_score, team_stats, total_score
from app.main import flag, optimize
from app.models import CourseContext, FlagRequest, OptimizeRequest, Skills, StructuredProfile
from app.solver import feasible_team_count, legal_team_sizes, solve_teams, solve_teams_detailed


def person(
    pid: str,
    *,
    goal="grade_A",
    availability=("weekday_evening",),
    hours=8,
    role="either",
    **skill_kw,
) -> StructuredProfile:
    skills = Skills(
        technical=skill_kw.get("technical", 3),
        writing=skill_kw.get("writing", 3),
        analysis=skill_kw.get("analysis", 3),
        presentation=skill_kw.get("presentation", 3),
    )
    return StructuredProfile(
        id=pid,
        name=pid,
        bio="",
        goal=goal,
        availability=list(availability),
        skills=skills,
        hours=hours,
        role=role,
    )


COURSE = CourseContext(name="Test", grading_notes="", team_size_min=3, team_size_max=4)


def test_feasible_count_n13_three_to_four():
    assert feasible_team_count(13, 3, 4) == 4
    sizes = legal_team_sizes(13, 3, 4)
    assert sorted(sizes) == [3, 3, 3, 4]
    assert sum(sizes) == 13


def test_n13_round_heuristic_is_wrong():
    assert round(13 / 4) == 3
    assert 3 * 4 < 13
    assert feasible_team_count(13, 3, 4) == 4


def test_infeasible_size_bounds():
    with pytest.raises(RuntimeError, match="No feasible team count"):
        feasible_team_count(5, 3, 4)


def test_solve_n13_produces_legal_teams():
    people = [person(f"p{i}") for i in range(13)]
    result = solve_teams_detailed(people, 3, 4, set())
    assert result.status == "OPTIMAL"
    sizes = sorted(len(t) for t in result.teams)
    assert sizes == [3, 3, 3, 4]
    assigned = {m.id for team in result.teams for m in team}
    assert assigned == {f"p{i}" for i in range(13)}


def test_random_baseline_only_legal_sizes():
    people = [person(f"p{i}") for i in range(13)]
    for _ in range(8):
        teams = legal_random_partition(people, 3, 4)
        sizes = sorted(len(t) for t in teams)
        assert sizes == [3, 3, 3, 4]
        assert sum(len(t) for t in teams) == 13
    score = random_baseline_score(people, set(), 3, 4, samples=4)
    assert isinstance(score, float)


def test_solver_metric_matches_team_stats_average():
    from app.scoring import pair_score

    people = [person(f"p{i}", hours=8 + i % 3) for i in range(8)]
    teams = solve_teams(people, 3, 4, set())
    for team in teams:
        stats = team_stats(team, set())
        pairs = list(combinations(team, 2))
        manual = sum(pair_score(a, b, set())["score"] for a, b in pairs) / len(pairs)
        assert stats["avg"] == pytest.approx(manual, abs=1e-9)


def test_maximin_rejects_availability_dumpster():
    """Three flexible people + three mutually incompatible people, teams of 3.

    Sum-of-pairs prefers parking the three incompatible people on one dumpster
    team. The Rawlsian floor prefers mixing them so the worst team is not all
    hard conflicts.
    """
    all_slots = (
        "weekday_morning",
        "weekday_afternoon",
        "weekday_evening",
        "weekend",
    )
    flexible = [person(f"f{i}", availability=all_slots, goal="grade_A") for i in range(3)]
    isolated = [
        person("w0", availability=("weekend",), goal="pass"),
        person("w1", availability=("weekday_morning",), goal="pass"),
        person("w2", availability=("weekday_afternoon",), goal="pass"),
    ]
    people = flexible + isolated
    result = solve_teams_detailed(people, 3, 3, set())
    assert result.status == "OPTIMAL"
    assert len(result.teams) == 2

    isolated_ids = {"w0", "w1", "w2"}
    dumpster = [team for team in result.teams if {m.id for m in team} == isolated_ids]
    assert dumpster == []

    mixed_floor = floor_score(result.teams, set())
    segregated = [flexible, isolated]
    assert mixed_floor > floor_score(segregated, set()) + 1e-6


def test_veto_is_hard_exclusion():
    people = [person(f"p{i}") for i in range(8)]
    vetoes = {("p0", "p1")}
    teams = solve_teams(people, 3, 4, vetoes)
    together = any(
        {"p0", "p1"} <= {m.id for m in team} for team in teams
    )
    assert not together


def test_flag_resolves_and_honors_vetoes():
    people = [person(f"p{i}", hours=8 + (i % 4)) for i in range(8)]
    opt = optimize(OptimizeRequest(course=COURSE, profiles=people, vetoes=[]))
    assert opt.teams
    flagged = opt.teams[0].members[0].id
    partner = next(m.id for t in opt.teams for m in t.members if m.id != flagged)
    vetoes = [[flagged, partner]]
    flagged_resp = flag(
        FlagRequest(
            course=COURSE,
            profiles=people,
            teams=opt.teams,
            person_id=flagged,
            reason="schedule",
            vetoes=vetoes,
        )
    )
    together = any(
        {flagged, partner} <= {m.id for m in t.members} for t in flagged_resp.teams
    )
    assert not together
    assigned = {m.id for t in flagged_resp.teams for m in t.members}
    assert assigned == {p.id for p in people}


def test_eight_and_sixteen_optimal():
    for n in (8, 16):
        people = [
            person(
                f"p{i}",
                goal=("grade_A", "research", "pass", "deep_mastery")[i % 4],
                availability=(("weekday_evening", "weekend")[i % 2],),
                hours=6 + (i % 5),
            )
            for i in range(n)
        ]
        result = solve_teams_detailed(people, 3, 4, set())
        assert result.status == "OPTIMAL"
        assert all(3 <= len(t) <= 4 for t in result.teams)
        assert sum(len(t) for t in result.teams) == n
        mean = total_score(result.teams, set())
        assert mean == pytest.approx(
            sum(t.score for t in optimize(OptimizeRequest(course=COURSE, profiles=people)).teams)
            / len(result.teams),
            abs=1e-6,
        )


def test_forced_team_count_splits_evenly():
    people = [person(f"p{i}") for i in range(20)]
    assert legal_team_sizes(20, 3, 4, team_count=5) == [4, 4, 4, 4, 4]
    teams = solve_teams(people, 3, 4, set(), team_count=5)
    assert len(teams) == 5
    assert all(len(team) == 4 for team in teams)


def test_forced_team_count_rejects_impossible():
    with pytest.raises(RuntimeError, match="Can't make 6 teams"):
        feasible_team_count(20, 4, 4, team_count=6)
