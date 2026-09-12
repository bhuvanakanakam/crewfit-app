import re

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .analysis import random_baseline_score, reoptimize_for_flag, team_stats
from .facts import team_facts
from .grok_client import chat_turn, extract_profile, resolve_clarification
from .models import (
    ChatRequest,
    ChatResponse,
    ClarifyRequest,
    ConcernRecord,
    ConcernRequest,
    Course,
    CourseListResponse,
    CreateCourseRequest,
    FlagRequest,
    MatchRequest,
    MatchResponse,
    OptimizeRequest,
    OptimizeResponse,
    ParseRequest,
    ParseResponse,
    ProfileLookupResponse,
    PublicTeammate,
    RosterResponse,
    StructuredProfile,
    TeamMember,
    TeamResult,
)
from .solver import solve_teams
from .synthetic import generate_cohort

app = FastAPI(title="CrewFit API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://localhost:5173",
        "https://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# People persist across courses. Enrollments, matches, and the official
# assignment are per-course. Student "your team" and the teacher Teams tab
# read the same solve — they used to run two independent solvers.
_people: dict[str, StructuredProfile] = {}
_courses: dict[str, Course] = {}
_enroll: dict[str, set[str]] = {}
_matches: dict[str, MatchResponse] = {}
_concerns: dict[str, ConcernRecord] = {}
_assignments: dict[str, OptimizeResponse] = {}
_assignment_teams: dict[str, list[list[StructuredProfile]]] = {}
_seq = 0
_ROSTER_FILL = 16


def _name_key(name: str) -> str:
    return name.strip().lower()


def _slug(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")
    return slug or "course"


def _seed_courses() -> None:
    seeds = [
        Course(
            id="hackcmu",
            name="HackCMU 2026",
            grading_notes="Collaborative project; teams of 3–4.",
            team_size_min=3,
            team_size_max=4,
        ),
        Course(
            id="15112",
            name="15-112 Fundamentals",
            grading_notes="Term project; teams of 3–4.",
            team_size_min=3,
            team_size_max=4,
        ),
        Course(
            id="17214",
            name="17-214 Software Construction",
            grading_notes="Homework teams of 2–3.",
            team_size_min=2,
            team_size_max=3,
        ),
    ]
    for course in seeds:
        _courses.setdefault(course.id, course)
        _enroll.setdefault(course.id, set())


_seed_courses()


def _store_profile(profile: StructuredProfile, course_id: str | None = None) -> StructuredProfile:
    global _seq
    key = _name_key(profile.name)
    existing = _people.get(key)
    pid = existing.id if existing else None
    if not pid or pid == "you":
        _seq += 1
        pid = f"stu-{_seq}"
    stored = profile.model_copy(update={"id": pid, "name": profile.name.strip() or profile.name})
    _people[key] = stored
    if course_id and course_id in _courses:
        _enroll.setdefault(course_id, set()).add(key)
    return stored


def _course_or_404(course_id: str) -> Course:
    course = _courses.get(course_id)
    if course is None:
        raise HTTPException(status_code=404, detail="Course not found.")
    return course


def _match_key(course_id: str, name: str) -> str:
    return f"{course_id}:{_name_key(name)}"


def _roster_seed(course_id: str) -> int:
    return sum(ord(c) for c in course_id) * 17 + 7


def _build_roster(course: Course, fill: int = _ROSTER_FILL) -> list[StructuredProfile]:
    keys = sorted(_enroll.get(course.id, set()))
    students = [_people[k] for k in keys if k in _people]
    taken = {p.name for p in students}
    extra_n = max(0, fill - len(students))
    extras = (
        generate_cohort(
            exclude_name=students[0].name if students else "",
            count=extra_n,
            seed=_roster_seed(course.id),
            exclude_names=taken,
        )
        if extra_n
        else []
    )
    extras = [p for p in extras if p.name.lower() not in {n.lower() for n in taken}]
    return [*students, *extras]


def _concerns_for(course_id: str) -> dict[str, ConcernRecord]:
    return {rec.name: rec for rec in _concerns.values() if rec.course_id == course_id}


def _to_match(course: Course, roster_n: int, your_team: list[StructuredProfile], you_name: str) -> MatchResponse:
    facts = team_facts(your_team)
    you = _name_key(you_name)
    team = [
        PublicTeammate(id=m.id, name=m.name, is_you=_name_key(m.name) == you)
        for m in your_team
    ]
    team.sort(key=lambda m: (not m.is_you, m.name.lower()))
    return MatchResponse(
        team=team,
        rationale=facts["rationale"],
        cohort_size=roster_n,
        shared_windows=facts["shared_windows"],
        team_goal=facts["team_goal"],
        coverage=facts["coverage"],
        thin=facts["thin"],
        course_id=course.id,
        course_name=course.name,
    )


def _assignment_ids(opt: OptimizeResponse | None) -> set[str]:
    if not opt:
        return set()
    return {m.id for t in opt.teams for m in t.members}


def _profile_sig(p: StructuredProfile) -> tuple:
    return (
        p.goal,
        tuple(p.availability),
        p.hours,
        p.role,
        p.skills.technical,
        p.skills.writing,
        p.skills.analysis,
        p.skills.presentation,
    )


def _assignment_stale(course_id: str, roster: list[StructuredProfile]) -> bool:
    existing = _assignments.get(course_id)
    if _assignment_ids(existing) != {p.id for p in roster}:
        return True
    by_id = {m.id: m for team in _assignment_teams.get(course_id, []) for m in team}
    return any(p.id not in by_id or _profile_sig(by_id[p.id]) != _profile_sig(p) for p in roster)


def _sync_matches(course: Course, raw_teams: list[list[StructuredProfile]]) -> None:
    roster_n = sum(len(t) for t in raw_teams)
    enrolled = _enroll.get(course.id, set())
    for team in raw_teams:
        for member in team:
            key = _name_key(member.name)
            if key in enrolled or key in _people:
                _matches[_match_key(course.id, member.name)] = _to_match(
                    course, roster_n, team, member.name
                )


def _persist_assignment(
    course: Course,
    raw_teams: list[list[StructuredProfile]],
    opt: OptimizeResponse,
) -> None:
    _assignment_teams[course.id] = raw_teams
    _assignments[course.id] = opt
    _sync_matches(course, raw_teams)


def _build_optimize_response(
    raw_teams: list[list[StructuredProfile]],
    profiles: list[StructuredProfile],
    course_ctx,
    vetoes: set,
    flag_note: str | None = None,
) -> OptimizeResponse:
    teams = [_to_team_result(f"team-{i}", members, vetoes) for i, members in enumerate(raw_teams)]
    optimized_avg = sum(t.score for t in teams) / len(teams) if teams else 0.0
    baseline_avg = random_baseline_score(profiles, vetoes, course_ctx.team_size_min, course_ctx.team_size_max)
    improvement_pct = ((optimized_avg - baseline_avg) / abs(baseline_avg) * 100) if baseline_avg else 0.0
    return OptimizeResponse(
        teams=teams,
        baseline_score=baseline_avg,
        improvement_pct=improvement_pct,
        flag_note=flag_note,
    )


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/courses", response_model=CourseListResponse)
def list_courses():
    return CourseListResponse(courses=list(_courses.values()))


@app.post("/api/courses", response_model=Course)
def create_course(req: CreateCourseRequest):
    base = _slug(req.name)
    cid = base
    n = 2
    while cid in _courses:
        cid = f"{base}-{n}"
        n += 1
    course = Course(
        id=cid,
        name=req.name.strip(),
        grading_notes=req.grading_notes or "",
        team_size_min=req.team_size_min,
        team_size_max=req.team_size_max,
    )
    _courses[cid] = course
    _enroll.setdefault(cid, set())
    return course


@app.get("/api/profile", response_model=ProfileLookupResponse)
def lookup_profile(name: str, course_id: str | None = None):
    stored = _people.get(_name_key(name))
    match = _matches.get(_match_key(course_id, name)) if course_id else None
    return ProfileLookupResponse(profile=stored, match=match)


@app.post("/api/submit", response_model=StructuredProfile)
def submit(profile: StructuredProfile, course_id: str | None = Query(None)):
    """Save a student's working style and optionally enroll them in a course."""
    if course_id:
        _course_or_404(course_id)
    return _store_profile(profile, course_id)


@app.get("/api/roster", response_model=RosterResponse)
def roster(
    course_id: str = Query("hackcmu"),
    fill: int = Query(16, ge=0, le=40),
    seed: int | None = Query(None),
):
    course = _course_or_404(course_id)
    if seed is not None:
        # Tests / demos may pin a seed; official fill stays course-stable.
        keys = sorted(_enroll.get(course_id, set()))
        students = [_people[k] for k in keys if k in _people]
        taken = {p.name for p in students}
        extra_n = max(0, fill - len(students))
        extras = (
            generate_cohort(
                exclude_name=students[0].name if students else "",
                count=extra_n,
                seed=seed,
                exclude_names=taken,
            )
            if extra_n
            else []
        )
        extras = [p for p in extras if p.name.lower() not in {n.lower() for n in taken}]
        profiles = [*students, *extras]
    else:
        profiles = _build_roster(course, fill)
    return RosterResponse(
        profiles=profiles,
        concerns=_concerns_for(course_id),
        course=course,
        assignment=_assignments.get(course_id),
    )


@app.get("/api/cohort", response_model=ParseResponse)
def cohort(
    count: int = Query(16, ge=4, le=40),
    seed: int | None = Query(7),
):
    """Sample class with full profile fields — organizer/demo only."""
    return ParseResponse(profiles=generate_cohort(exclude_name="", count=count, seed=seed))


@app.post("/api/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    """Student personality interview with Grok — one turn at a time."""
    name = req.name.strip() or "there"
    course_context = f"{req.course.name} — {req.course.grading_notes}".strip(" —")
    messages = [{"role": m.role, "content": m.content} for m in req.messages]
    raw = chat_turn(name, messages, course_context)

    profile = None
    if raw.get("ready") and raw.get("profile"):
        p = raw["profile"]
        bio_parts = [m.content for m in req.messages if m.role == "user"]
        profile = StructuredProfile(
            id="you",
            name=name,
            bio="\n".join(bio_parts) or "Shared via CrewFit chat",
            goal=p["goal"],
            availability=p["availability"] or ["weekday_evening"],
            skills=p["skills"],
            hours=p["hours"],
            role=p.get("role", "either"),
            conflict_mode=p.get("conflict_mode", "vote"),
            confidence=float(p.get("confidence", 0.85)),
            clarifying_questions=[],
        )

    return ChatResponse(reply=raw["reply"], ready=bool(raw.get("ready") and profile), profile=profile)


@app.post("/api/match", response_model=MatchResponse)
def match(req: MatchRequest):
    """Place the student on the course's official assignment (same teams the teacher sees)."""
    course = _courses.get(req.course_id) if req.course_id else None
    if course is None:
        course = Course(
            id=req.course_id or "hackcmu",
            name=req.course.name,
            grading_notes=req.course.grading_notes or "",
            team_size_min=req.course.team_size_min,
            team_size_max=req.course.team_size_max,
        )
        _courses.setdefault(course.id, course)
        _enroll.setdefault(course.id, set())

    stored = _store_profile(req.profile, course.id)
    roster = _build_roster(course, fill=req.cohort_size)

    if _assignment_stale(course.id, roster):
        try:
            raw_teams = solve_teams(roster, course.team_size_min, course.team_size_max, set())
        except RuntimeError as e:
            raise HTTPException(status_code=400, detail=str(e))
        opt = _build_optimize_response(raw_teams, roster, course, set())
        _persist_assignment(course, raw_teams, opt)
    else:
        raw_teams = _assignment_teams[course.id]

    your_team = next(
        (t for t in raw_teams if any(_name_key(m.name) == _name_key(stored.name) for m in t)),
        None,
    )
    if your_team is None:
        raise HTTPException(status_code=500, detail="Solver finished but you were not assigned to a team.")

    result = _to_match(course, len(roster), your_team, stored.name)
    _matches[_match_key(course.id, stored.name)] = result
    return result


@app.post("/api/concern", response_model=ConcernRecord)
def raise_concern(req: ConcernRequest):
    _course_or_404(req.course_id)
    rec = ConcernRecord(
        name=req.name.strip(),
        course_id=req.course_id,
        reason=req.reason,
        note=(req.note or "").strip(),
    )
    _concerns[_match_key(req.course_id, req.name)] = rec
    key = _name_key(req.name)
    if key in _people:
        _enroll.setdefault(req.course_id, set()).add(key)
    return rec


# --- Organizer / demo endpoints (kept for pipeline tests) -------------------


@app.post("/api/parse", response_model=ParseResponse)
def parse(req: ParseRequest):
    course_context = f"{req.course.name} — {req.course.grading_notes}".strip(" —")
    profiles = []
    for idx, person in enumerate(req.people):
        raw = extract_profile(person.name, person.bio, course_context)
        profiles.append(
            StructuredProfile(
                id=f"p{idx}",
                name=person.name,
                bio=person.bio,
                **raw,
            )
        )
    return ParseResponse(profiles=profiles)


@app.post("/api/clarify", response_model=ParseResponse)
def clarify(req: ClarifyRequest):
    course_context = f"{req.course.name} — {req.course.grading_notes}".strip(" —")
    answers_by_profile: dict[str, list[tuple[str, str]]] = {}
    for a in req.answers:
        answers_by_profile.setdefault(a.profile_id, []).append((a.question, a.answer))

    updated = []
    for profile in req.profiles:
        qa = answers_by_profile.get(profile.id)
        if not qa:
            updated.append(profile)
            continue
        raw = resolve_clarification(profile.name, profile.bio, course_context, qa)
        updated.append(
            StructuredProfile(
                id=profile.id,
                name=profile.name,
                bio=profile.bio,
                **raw,
            )
        )
    return ParseResponse(profiles=updated)


def _to_team_result(team_id: str, members: list[StructuredProfile], vetoes: set) -> TeamResult:
    stats = team_stats(members, vetoes)
    facts = team_facts(members)
    return TeamResult(
        team_id=team_id,
        members=[TeamMember(id=m.id, name=m.name, goal=m.goal, hours=m.hours) for m in members],
        score=stats["avg"],
        breakdown=stats["breakdown"],
        violations=stats["violations"],
        rationale=facts["rationale"],
        shared_windows=facts["shared_windows"],
        team_goal=facts["team_goal"],
        coverage=facts["coverage"],
        thin=facts["thin"],
    )


@app.post("/api/optimize", response_model=OptimizeResponse)
def optimize(req: OptimizeRequest):
    vetoes = {tuple(sorted(pair)) for pair in req.vetoes}
    try:
        raw_teams = solve_teams(req.profiles, req.course.team_size_min, req.course.team_size_max, vetoes)
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))

    opt = _build_optimize_response(raw_teams, req.profiles, req.course, vetoes)
    course = _courses.get(req.course_id) if req.course_id else None
    if course is not None:
        _persist_assignment(course, raw_teams, opt)
    return opt


@app.post("/api/flag", response_model=OptimizeResponse)
def flag(req: FlagRequest):
    vetoes = {tuple(sorted(pair)) for pair in req.vetoes}
    profiles_by_id = {p.id: p for p in req.profiles}

    teams_as_people: list[list[StructuredProfile]] = [
        [profiles_by_id[m.id] for m in t.members] for t in req.teams
    ]

    teams_as_people, flag_note = reoptimize_for_flag(
        teams_as_people,
        req.person_id,
        vetoes,
        req.course.team_size_min,
        req.course.team_size_max,
    )

    team_ids = [t.team_id for t in req.teams]
    while len(team_ids) < len(teams_as_people):
        team_ids.append(f"team-{len(team_ids)}")

    opt = _build_optimize_response(teams_as_people, req.profiles, req.course, vetoes, flag_note)
    # Keep teacher-assigned team_ids when the count is unchanged.
    if len(opt.teams) == len(team_ids):
        opt.teams = [
            t.model_copy(update={"team_id": team_ids[i]})
            for i, t in enumerate(opt.teams)
        ]
    course = _courses.get(req.course_id) if req.course_id else None
    if course is not None:
        _persist_assignment(course, teams_as_people, opt)
    return opt
