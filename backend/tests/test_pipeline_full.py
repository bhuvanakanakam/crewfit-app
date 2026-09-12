"""16-person cohort: solver + flag path on hand-built profiles (no Grok)."""

from app.main import flag, optimize
from app.models import CourseContext, FlagRequest, OptimizeRequest, Skills, StructuredProfile
from app.solver import solve_teams_detailed


GOALS = ["research", "pass", "grade_A", "deep_mastery"]
SLOTS = [
    ["weekday_evening"],
    ["weekend"],
    ["weekday_evening"],
    ["weekday_evening", "weekend"],
    ["weekday_afternoon", "weekend"],
    ["weekday_morning", "weekday_evening"],
]


def _p(i: int) -> StructuredProfile:
    return StructuredProfile(
        id=f"p{i}",
        name=f"Person {i}",
        bio="",
        goal=GOALS[i % 4],
        availability=SLOTS[i % len(SLOTS)],
        skills=Skills(),
        hours=4 + (i % 10),
        role="lead" if i % 7 == 0 else "either",
    )


def test_pipeline_full():
    course = CourseContext(name="94-800 Negotiation", grading_notes="", team_size_min=3, team_size_max=4)
    people = [_p(i) for i in range(16)]
    detailed = solve_teams_detailed(people, 3, 4, set())
    assert detailed.status == "OPTIMAL"

    opt = optimize(OptimizeRequest(course=course, profiles=people, vetoes=[]))
    assert sum(len(t.members) for t in opt.teams) == 16
    assert all(3 <= len(t.members) <= 4 for t in opt.teams)

    flagged = opt.teams[0].members[0].id
    flagged_resp = flag(
        FlagRequest(
            course=course,
            profiles=people,
            teams=opt.teams,
            person_id=flagged,
            reason="schedule",
            vetoes=[],
        )
    )
    assert sum(len(t.members) for t in flagged_resp.teams) == 16
