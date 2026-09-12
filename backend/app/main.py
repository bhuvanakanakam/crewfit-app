import copy
import re
import sys
import uuid
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .analysis import random_baseline_score, reoptimize_for_flag, team_stats
from .config import CORS_ORIGINS
from .db import load_snapshot, save_snapshot
from .facts import team_facts
from .grok_client import chat_turn, extract_profile, resolve_clarification, update_turn
from .models import (
    Account,
    ChatRequest,
    ChatResponse,
    ClarifyRequest,
    ConcernRecord,
    ConcernRequest,
    Course,
    CourseListResponse,
    CourseView,
    CreateCourseRequest,
    EnrollRequest,
    FlagRequest,
    LoginRequest,
    LoginResponse,
    MarkReadRequest,
    MatchRequest,
    MatchResponse,
    NotificationListResponse,
    NotificationRecord,
    OptimizeRequest,
    OptimizeResponse,
    ParseRequest,
    ParseResponse,
    PrefImpact,
    ProfileLookupResponse,
    PublicTeammate,
    RematchPermissionRequest,
    ResolveConcernRequest,
    RosterResponse,
    StaffRequest,
    StructuredProfile,
    SubmitResponse,
    TeamMember,
    TeamResult,
)
from .solver import solve_teams
from .synthetic import generate_cohort

app = FastAPI(title="CrewFit API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS or ["*"],
    allow_origin_regex=r"https://.*\.vercel\.app",
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
_rematch_ok: dict[str, bool] = {}
_assignments: dict[str, OptimizeResponse] = {}
_assignment_teams: dict[str, list[list[StructuredProfile]]] = {}
_notifications: list[NotificationRecord] = []
_accounts: dict[str, Account] = {}
# course_id -> { name_key: "teacher" | "ta" }
_staff: dict[str, dict[str, str]] = {}
_seq = 0
_ROSTER_FILL = 16
_SCORE_DROP_PCT = 10.0
_saving = False
_DEMO_TEACHER = "Priya Chen"
_DEMO_TA = "Alex Kim"


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
        _staff.setdefault(course.id, {})


def _ensure_account(name: str, home_role: str) -> Account:
    key = _name_key(name)
    existing = _accounts.get(key)
    if existing is not None:
        if home_role == "teacher" and existing.home_role != "teacher":
            existing = existing.model_copy(update={"home_role": "teacher"})
            _accounts[key] = existing
        return existing
    acc = Account(name=name.strip(), home_role=home_role, created_at=_now())  # type: ignore[arg-type]
    _accounts[key] = acc
    return acc


def _seed_staff() -> None:
    _ensure_account(_DEMO_TEACHER, "teacher")
    _ensure_account(_DEMO_TA, "student")
    for cid in _courses:
        bucket = _staff.setdefault(cid, {})
        bucket.setdefault(_name_key(_DEMO_TEACHER), "teacher")
    _staff.setdefault("15112", {}).setdefault(_name_key(_DEMO_TA), "ta")


_seed_courses()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _dump_state() -> dict:
    return {
        "people": {k: p.model_dump() for k, p in _people.items()},
        "courses": {k: c.model_dump() for k, c in _courses.items()},
        "enroll": {k: sorted(v) for k, v in _enroll.items()},
        "matches": {k: m.model_dump() for k, m in _matches.items()},
        "concerns": {k: c.model_dump() for k, c in _concerns.items()},
        "rematch_ok": dict(_rematch_ok),
        "assignments": {k: a.model_dump() for k, a in _assignments.items()},
        "assignment_teams": {
            cid: [[p.model_dump() for p in team] for team in teams]
            for cid, teams in _assignment_teams.items()
        },
        "notifications": [n.model_dump() for n in _notifications],
        "accounts": {k: a.model_dump() for k, a in _accounts.items()},
        "staff": {cid: dict(members) for cid, members in _staff.items()},
        "seq": _seq,
    }


def _save() -> None:
    global _saving
    if _saving or "pytest" in sys.modules:
        return
    _saving = True
    try:
        save_snapshot(_dump_state())
    finally:
        _saving = False


def _restore() -> None:
    global _seq, _notifications
    if "pytest" in sys.modules:
        return
    snap = load_snapshot()
    if not snap:
        return
    for key, raw in (snap.get("people") or {}).items():
        _people[key] = StructuredProfile.model_validate(raw)
    for key, raw in (snap.get("courses") or {}).items():
        _courses[key] = Course.model_validate(raw)
        _enroll.setdefault(key, set())
    for key, names in (snap.get("enroll") or {}).items():
        _enroll[key] = set(names)
    for key, raw in (snap.get("matches") or {}).items():
        _matches[key] = MatchResponse.model_validate(raw)
    for key, raw in (snap.get("concerns") or {}).items():
        _concerns[key] = ConcernRecord.model_validate(raw)
    _rematch_ok.update({k: bool(v) for k, v in (snap.get("rematch_ok") or {}).items()})
    for key, raw in (snap.get("assignments") or {}).items():
        _assignments[key] = OptimizeResponse.model_validate(raw)
    for cid, teams in (snap.get("assignment_teams") or {}).items():
        _assignment_teams[cid] = [
            [StructuredProfile.model_validate(p) for p in team] for team in teams
        ]
    _notifications = [NotificationRecord.model_validate(n) for n in (snap.get("notifications") or [])]
    for key, raw in (snap.get("accounts") or {}).items():
        _accounts[key] = Account.model_validate(raw)
    for cid, members in (snap.get("staff") or {}).items():
        _staff[cid] = {str(k): str(v) for k, v in dict(members).items()}
    _seq = int(snap.get("seq") or _seq)


_restore()
_seed_staff()


def _course_view(course: Course, access: str, enrolled: bool = False) -> CourseView:
    return CourseView(
        id=course.id,
        name=course.name,
        grading_notes=course.grading_notes or "",
        team_size_min=course.team_size_min,
        team_size_max=course.team_size_max,
        access=access,  # type: ignore[arg-type]
        enrolled=enrolled,
    )


def _staff_kind_for(name: str, course_id: str | None = None) -> str | None:
    key = _name_key(name)
    if course_id:
        kind = _staff.get(course_id, {}).get(key)
        return kind or None
    kinds = {members.get(key) for members in _staff.values()}
    if "teacher" in kinds:
        return "teacher"
    if "ta" in kinds:
        return "ta"
    return None


def _is_instructor(name: str) -> bool:
    acc = _accounts.get(_name_key(name))
    if acc and acc.home_role == "teacher":
        return True
    return _staff_kind_for(name) == "teacher"


def _require_staff(course_id: str, name: str, *, need_teacher: bool = False) -> str:
    kind = _staff.get(course_id, {}).get(_name_key(name))
    if not kind:
        raise HTTPException(status_code=403, detail="You don't staff this course.")
    if need_teacher and kind != "teacher":
        raise HTTPException(status_code=403, detail="Only the course instructor can do that.")
    return kind


def _visible_courses(name: str, role: str) -> list[CourseView]:
    key = _name_key(name)
    views: list[CourseView] = []
    for course in _courses.values():
        kind = _staff.get(course.id, {}).get(key)
        if role == "teacher":
            if kind:
                views.append(_course_view(course, kind, enrolled=False))
            continue
        if kind:
            continue
        enrolled = key in _enroll.get(course.id, set())
        views.append(_course_view(course, "student", enrolled=enrolled))
    return views


def _notify(
    *,
    course_id: str,
    to_name: str,
    to_role: str,
    kind: str,
    title: str,
    body: str,
    student: str | None = None,
    reason: str | None = None,
) -> NotificationRecord:
    rec = NotificationRecord(
        id=uuid.uuid4().hex[:12],
        course_id=course_id,
        to_name=to_name,
        to_role=to_role,  # type: ignore[arg-type]
        kind=kind,  # type: ignore[arg-type]
        title=title,
        body=body,
        created_at=_now(),
        student=student,
        reason=reason,
    )
    _notifications.append(rec)
    return rec


def _score_hurts(before: float, after: float) -> bool:
    if after >= before - 1e-9:
        return False
    drop = before - after
    if abs(before) < 0.05:
        return drop >= 0.08
    return (drop / abs(before)) * 100 >= _SCORE_DROP_PCT


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
    if course_id and course_id in _courses and not _staff.get(course_id, {}).get(key):
        _enroll.setdefault(course_id, set()).add(key)
    _save()
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


def _rematch_map(course_id: str) -> dict[str, bool]:
    out: dict[str, bool] = {}
    prefix = f"{course_id}:"
    for key, allowed in _rematch_ok.items():
        if allowed and key.startswith(prefix):
            nk = key[len(prefix) :]
            person = _people.get(nk)
            out[nk] = True
            if person:
                out[person.name] = True
    for rec in _concerns.values():
        if rec.course_id == course_id and rec.allow_rematch:
            out[rec.name] = True
            out[_name_key(rec.name)] = True
    return out


def _can_rematch(course_id: str, name: str) -> bool:
    key = _match_key(course_id, name)
    rec = _concerns.get(key)
    return bool(_rematch_ok.get(key) or (rec and rec.allow_rematch))


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
    _save()


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
def list_courses(name: str = "", role: str = "student"):
    who = name.strip()
    if who and role in ("student", "teacher"):
        return CourseListResponse(courses=_visible_courses(who, role))
    return CourseListResponse(courses=[_course_view(c, "student") for c in _courses.values()])


@app.post("/api/auth/login", response_model=LoginResponse)
def login(req: LoginRequest):
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Enter a name to sign in.")
    staff_kind = _staff_kind_for(name) or "none"
    if req.requested_role == "teacher":
        if staff_kind == "none":
            raise HTTPException(
                status_code=403,
                detail=(
                    "That name isn't an instructor or TA. Sign in as a student, "
                    f"or ask an instructor to add you as a TA. Demo instructor: {_DEMO_TEACHER}."
                ),
            )
        acc = _accounts.get(_name_key(name)) or _ensure_account(name, "student")
        return LoginResponse(
            name=acc.name,
            role="teacher",
            staff_kind=staff_kind,  # type: ignore[arg-type]
            can_create_course=_is_instructor(acc.name),
            courses=_visible_courses(acc.name, "teacher"),
        )
    acc = _accounts.get(_name_key(name))
    if acc is None:
        acc = _ensure_account(name, "student")
    _save()
    return LoginResponse(
        name=acc.name,
        role="student",
        staff_kind=staff_kind,  # type: ignore[arg-type]
        can_create_course=False,
        courses=_visible_courses(acc.name, "student"),
    )


@app.post("/api/courses", response_model=CourseView)
def create_course(req: CreateCourseRequest):
    actor = req.actor.strip()
    if not actor or not _is_instructor(actor):
        raise HTTPException(status_code=403, detail="Only instructors can create courses.")
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
    _staff.setdefault(cid, {})[_name_key(actor)] = "teacher"
    _ensure_account(actor, "teacher")
    _save()
    return _course_view(course, "teacher")


@app.post("/api/courses/{course_id}/enroll")
def enroll_student(course_id: str, req: EnrollRequest):
    course = _course_or_404(course_id)
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name required.")
    if _staff.get(course_id, {}).get(_name_key(name)):
        raise HTTPException(
            status_code=403,
            detail="You staff this course, so it stays on your instructor/TA view.",
        )
    acc = _ensure_account(name, "student")
    bucket = _enroll.setdefault(course_id, set())
    first = _name_key(acc.name) not in bucket
    bucket.add(_name_key(acc.name))
    if first:
        _notify(
            course_id=course_id,
            to_name="",
            to_role="teacher",
            kind="staff",
            title=f"{acc.name} joined the roster",
            body=f"{acc.name} enrolled in {course.name}.",
            student=acc.name,
        )
    _save()
    return {"ok": True, "course_id": course_id, "name": acc.name}


@app.post("/api/courses/{course_id}/staff")
def add_staff(course_id: str, req: StaffRequest):
    course = _course_or_404(course_id)
    _require_staff(course_id, req.actor, need_teacher=True)
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Enter the TA's name.")
    key = _name_key(name)
    if key == _name_key(req.actor):
        raise HTTPException(status_code=400, detail="You already staff this course.")
    existing = _staff.get(course_id, {}).get(key)
    if existing == "teacher":
        raise HTTPException(status_code=400, detail="That person already teaches this course.")
    acc = _accounts.get(key) or _ensure_account(name, "student")
    if acc.home_role == "teacher":
        raise HTTPException(status_code=400, detail="Instructors are added as teachers, not TAs.")
    _staff.setdefault(course_id, {})[key] = "ta"
    _enroll.setdefault(course_id, set()).discard(key)
    _matches.pop(_match_key(course_id, acc.name), None)
    _notify(
        course_id=course_id,
        to_name=acc.name,
        to_role="student",
        kind="staff",
        title=f"You're a TA for {course.name}",
        body="Sign in as Teacher to open this course. Your other student courses stay on the student view.",
        student=acc.name,
    )
    _notify(
        course_id=course_id,
        to_name="",
        to_role="teacher",
        kind="staff",
        title=f"{acc.name} is now a TA",
        body=f"{acc.name} can open {course.name} as staff. They no longer appear as a student here.",
        student=acc.name,
    )
    _save()
    return {"ok": True, "name": acc.name, "kind": "ta", "course_id": course_id}


@app.get("/api/profile", response_model=ProfileLookupResponse)
def lookup_profile(name: str, course_id: str | None = None):
    stored = _people.get(_name_key(name))
    match = _matches.get(_match_key(course_id, name)) if course_id else None
    rec = _concerns.get(_match_key(course_id, name)) if course_id else None
    return ProfileLookupResponse(
        profile=stored,
        match=match,
        rematch_allowed=_can_rematch(course_id, name) if course_id else False,
        concern=rec,
    )


def _apply_pref_to_team(course: Course, stored: StructuredProfile) -> PrefImpact | None:
    raw = _assignment_teams.get(course.id)
    opt = _assignments.get(course.id)
    if not raw:
        return None
    team_idx = None
    member_idx = None
    for ti, team in enumerate(raw):
        for mi, member in enumerate(team):
            if _name_key(member.name) == _name_key(stored.name):
                team_idx, member_idx = ti, mi
                break
        if team_idx is not None:
            break
    if team_idx is None or member_idx is None:
        return None

    team = raw[team_idx]
    before_stats = team_stats(team, set())
    before = before_stats["avg"]
    before_v = before_stats["violations"]
    teammates = [m.name for m in team if _name_key(m.name) != _name_key(stored.name)]
    team[member_idx] = stored
    after_stats = team_stats(team, set())
    after = after_stats["avg"]
    delta_pct = ((after - before) / abs(before) * 100) if abs(before) > 1e-6 else 0.0
    hurts = _score_hurts(before, after) or after_stats["violations"] > before_v
    if opt is not None:
        team_id = opt.teams[team_idx].team_id if team_idx < len(opt.teams) else f"team-{team_idx}"
        updated = _to_team_result(team_id, team, set())
        teams = list(opt.teams)
        if team_idx < len(teams):
            teams[team_idx] = updated
        else:
            teams.append(updated)
        _assignments[course.id] = opt.model_copy(update={"teams": teams})
    _assignment_teams[course.id] = raw
    _sync_matches(course, raw)

    if hurts:
        note = (
            f"{stored.name} updated preferences and team fit dropped "
            f"{abs(delta_pct):.0f}% ({before:.2f} → {after:.2f})."
        )
        rec = ConcernRecord(
            name=stored.name.strip(),
            course_id=course.id,
            reason="other",
            note=note,
        )
        _concerns[_match_key(course.id, stored.name)] = rec
        message = (
            f"This update lowered your team's fit by {abs(delta_pct):.0f}%. "
            "Your teacher was notified. Teammates can still work with you — "
            "the team stays unless a rematch is approved."
        )
        teacher_title = f"{stored.name} is affecting their team"
        teacher_body = note
        teacher_kind = "score_drop"
    else:
        message = "Teammates were notified of your update. Team fit is about the same."
        teacher_title = f"{stored.name} updated preferences"
        teacher_body = (
            f"{stored.name} saved working-style changes in {course.name}. "
            f"Team fit is {after:.2f} ({delta_pct:+.0f}%)."
        )
        teacher_kind = "pref_update"

    _notify(
        course_id=course.id,
        to_name="",
        to_role="teacher",
        kind=teacher_kind,
        title=teacher_title,
        body=teacher_body,
        student=stored.name,
        reason="other" if hurts else None,
    )

    for mate in teammates:
        _notify(
            course_id=course.id,
            to_name=mate,
            to_role="student",
            kind="score_drop" if hurts else "pref_update",
            title=f"{stored.name} updated preferences",
            body=(
                f"{stored.name} changed working-style prefs. Team fit is now {after:.2f} "
                f"({delta_pct:+.0f}%)."
                if hurts
                else f"{stored.name} updated their working-style prefs. Your team is unchanged."
            ),
            student=stored.name,
        )
    if hurts:
        _notify(
            course_id=course.id,
            to_name=stored.name,
            to_role="student",
            kind="score_drop",
            title="Your update is affecting this team",
            body=message,
            student=stored.name,
        )
    else:
        _notify(
            course_id=course.id,
            to_name=stored.name,
            to_role="student",
            kind="pref_update",
            title="Preferences saved",
            body=message,
            student=stored.name,
        )
    return PrefImpact(
        before=round(before, 4),
        after=round(after, 4),
        delta_pct=round(delta_pct, 1),
        hurts_team=hurts,
        message=message,
        teammates=teammates,
    )


@app.post("/api/submit", response_model=SubmitResponse)
def submit(profile: StructuredProfile, course_id: str | None = Query(None)):
    """Save a student's working style. If they already have a team, rescore it."""
    if course_id:
        course = _course_or_404(course_id)
    else:
        course = None
    stored = _store_profile(profile, course_id)
    impact = _apply_pref_to_team(course, stored) if course is not None else None
    _save()
    return SubmitResponse(profile=stored, impact=impact)


@app.get("/api/roster", response_model=RosterResponse)
def roster(
    course_id: str = Query("hackcmu"),
    fill: int = Query(16, ge=0, le=40),
    seed: int | None = Query(None),
    actor: str | None = Query(None),
):
    course = _course_or_404(course_id)
    if actor:
        _require_staff(course_id, actor)
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
        rematch_allowed=_rematch_map(course_id),
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
    if req.mode == "update" and req.profile is not None:
        raw = update_turn(name, messages, course_context, req.profile.model_dump(), req.focus)
    else:
        raw = chat_turn(name, messages, course_context)

    profile = None
    if raw.get("ready") and raw.get("profile"):
        p = raw["profile"]
        bio_parts = [m.content for m in req.messages if m.role == "user"]
        profile = StructuredProfile(
            id=req.profile.id if req.profile else "you",
            name=name,
            bio="\n".join(bio_parts) or (req.profile.bio if req.profile else "Shared via chat"),
            goal=p["goal"],
            availability=p["availability"],
            skills=p["skills"],
            hours=p["hours"],
            role=p["role"],
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

    key = _match_key(course.id, req.profile.name)
    existing = _matches.get(key)
    allowed = _can_rematch(course.id, req.profile.name)
    if existing is not None and not allowed:
        return existing

    stored = _store_profile(req.profile, course.id)
    roster = _build_roster(course, fill=req.cohort_size)
    assigned = _assignment_teams.get(course.id)

    if existing is not None and allowed and assigned:
        raw_teams = copy.deepcopy(assigned)
        found = False
        for team in raw_teams:
            for i, member in enumerate(team):
                if _name_key(member.name) == _name_key(stored.name):
                    team[i] = stored
                    found = True
        if found:
            current_team = next(t for t in raw_teams if any(m.id == stored.id for m in t))
            vetoes = {
                tuple(sorted((stored.id, m.id)))
                for m in current_team
                if m.id != stored.id
            }
            raw_teams, note = reoptimize_for_flag(
                raw_teams,
                stored.id,
                vetoes,
                course.team_size_min,
                course.team_size_max,
            )
            opt = _build_optimize_response(raw_teams, roster, course, vetoes, flag_note=note)
            _persist_assignment(course, raw_teams, opt)
        elif _assignment_stale(course.id, roster):
            try:
                raw_teams = solve_teams(roster, course.team_size_min, course.team_size_max, set())
            except RuntimeError as e:
                raise HTTPException(status_code=400, detail=str(e))
            opt = _build_optimize_response(raw_teams, roster, course, set())
            _persist_assignment(course, raw_teams, opt)
        else:
            raw_teams = assigned
    elif existing is None or _assignment_stale(course.id, roster):
        try:
            raw_teams = solve_teams(roster, course.team_size_min, course.team_size_max, set())
        except RuntimeError as e:
            raise HTTPException(status_code=400, detail=str(e))
        opt = _build_optimize_response(raw_teams, roster, course, set())
        _persist_assignment(course, raw_teams, opt)
    else:
        raw_teams = assigned or []

    your_team = next(
        (t for t in raw_teams if any(_name_key(m.name) == _name_key(stored.name) for m in t)),
        None,
    )
    if your_team is None:
        raise HTTPException(status_code=500, detail="Solver finished but you were not assigned to a team.")

    result = _to_match(course, len(roster), your_team, stored.name)
    _matches[_match_key(course.id, stored.name)] = result
    _rematch_ok.pop(key, None)
    rec = _concerns.get(key)
    if rec is not None:
        _concerns[key] = rec.model_copy(update={"allow_rematch": False, "status": rec.status})
    names = ", ".join(m.name for m in your_team)
    _notify(
        course_id=course.id,
        to_name="",
        to_role="teacher",
        kind="team",
        title=f"{stored.name} {'re-matched' if existing is not None else 'found a team'}",
        body=f"{stored.name} is on a team of {len(your_team)}: {names}.",
        student=stored.name,
    )
    _save()
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
    _notify(
        course_id=req.course_id,
        to_name="",
        to_role="teacher",
        kind="concern",
        title=f"{rec.name} flagged a concern",
        body=rec.note or rec.reason,
        student=rec.name,
        reason=rec.reason,
    )
    _save()
    return rec


@app.get("/api/concerns")
def list_concerns(course_id: str = Query(...)):
    _course_or_404(course_id)
    return {"concerns": list(_concerns_for(course_id).values())}


@app.get("/api/notifications", response_model=NotificationListResponse)
def list_notifications(
    course_id: str = Query(...),
    name: str = Query(""),
    role: str = Query("student"),
):
    _course_or_404(course_id)
    who = _name_key(name)
    items: list[NotificationRecord] = []
    for rec in reversed(_notifications):
        if rec.course_id != course_id:
            continue
        if role == "teacher" and rec.to_role == "teacher":
            items.append(rec)
        elif role == "student" and rec.to_role == "student" and _name_key(rec.to_name) == who:
            items.append(rec)
        if len(items) >= 40:
            break
    return NotificationListResponse(notifications=items)


@app.post("/api/notifications/read")
def mark_notifications_read(req: MarkReadRequest):
    wanted = set(req.ids)
    for i, rec in enumerate(_notifications):
        if rec.id in wanted:
            _notifications[i] = rec.model_copy(update={"read": True})
    _save()
    return {"ok": True}


@app.post("/api/concern/resolve", response_model=ConcernRecord)
def resolve_concern(req: ResolveConcernRequest):
    key = _match_key(req.course_id, req.name)
    rec = _concerns.get(key)
    if rec is None:
        raise HTTPException(status_code=404, detail="No concern for that student.")
    allowed = req.status == "approved"
    rec = rec.model_copy(update={"status": req.status, "allow_rematch": allowed})
    _concerns[key] = rec
    _rematch_ok[key] = allowed
    _notify(
        course_id=req.course_id,
        to_name=req.name.strip(),
        to_role="student",
        kind="rematch",
        title="Rematch approved" if allowed else "Concern dismissed",
        body=(
            "Your teacher unlocked rematching. You can redo team matching from Chat."
            if allowed
            else "Your teacher kept the current team. You can still update preferences."
        ),
        student=req.name.strip(),
        reason=rec.reason,
    )
    _save()
    return rec


@app.post("/api/rematch", response_model=dict)
def set_rematch_permission(req: RematchPermissionRequest):
    _course_or_404(req.course_id)
    key = _match_key(req.course_id, req.name)
    _rematch_ok[key] = req.allowed
    rec = _concerns.get(key)
    if rec is not None:
        _concerns[key] = rec.model_copy(update={"allow_rematch": req.allowed})
    _save()
    return {"name": req.name.strip(), "course_id": req.course_id, "allowed": req.allowed}


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
        _notify(
            course_id=course.id,
            to_name="",
            to_role="teacher",
            kind="team",
            title="Teams formed",
            body=f"{len(opt.teams)} teams are live for {course.name}.",
        )
        _save()
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
        person = profiles_by_id.get(req.person_id)
        who = person.name if person else req.person_id
        _notify(
            course_id=course.id,
            to_name="",
            to_role="teacher",
            kind="team",
            title=f"{who} was moved",
            body=opt.flag_note or f"{who} was reassigned after a {req.reason} flag.",
            student=who,
            reason=req.reason,
        )
        _save()
    return opt
