"""8-person cohort: solver + flag path on hand-built profiles (no Grok)."""

from app.main import flag, optimize
from app.models import CourseContext, FlagRequest, OptimizeRequest, Skills, StructuredProfile


def _p(i, **kwargs):
    return StructuredProfile(
        id=f"p{i}",
        name=f"Person {i}",
        bio="",
        goal=kwargs.get("goal", "grade_A"),
        availability=list(kwargs.get("availability", ["weekday_evening"])),
        skills=Skills(),
        hours=kwargs.get("hours", 8),
        role=kwargs.get("role", "either"),
    )


def test_pipeline_small():
    course = CourseContext(name="94-800 Negotiation", grading_notes="", team_size_min=3, team_size_max=4)
    people = [
        _p(0, goal="research", availability=["weekday_evening"], hours=10),
        _p(1, goal="pass", availability=["weekend"], hours=4),
        _p(2, goal="grade_A", availability=["weekday_evening"], hours=12),
        _p(3, goal="deep_mastery", availability=["weekday_evening", "weekend"], hours=9),
        _p(4, goal="grade_A", availability=["weekday_evening"], hours=7, role="lead"),
        _p(5, goal="research", availability=["weekday_evening"], hours=11),
        _p(6, goal="pass", availability=["weekend"], hours=3),
        _p(7, goal="deep_mastery", availability=["weekday_morning", "weekday_evening"], hours=13),
    ]
    opt = optimize(OptimizeRequest(course=course, profiles=people, vetoes=[]))
    assert len(opt.teams) >= 2
    assert all(3 <= len(t.members) <= 4 for t in opt.teams)
    assert sum(len(t.members) for t in opt.teams) == 8

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
    assert sum(len(t.members) for t in flagged_resp.teams) == 8
