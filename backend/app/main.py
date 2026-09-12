from collections import Counter

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .analysis import random_baseline_score, reoptimize_for_flag, team_stats
from .grok_client import chat_turn, extract_profile, generate_rationale, resolve_clarification
from .models import (
    ChatRequest,
    ChatResponse,
    ClarifyRequest,
    FlagRequest,
    MatchRequest,
    MatchResponse,
    OptimizeRequest,
    OptimizeResponse,
    ParseRequest,
    ParseResponse,
    PublicTeammate,
    StructuredProfile,
    TeamMember,
    TeamResult,
)
from .solver import solve_teams
from .synthetic import generate_cohort

app = FastAPI(title="CrewFit API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"status": "ok"}


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
    """Place the student into a team against a Faker synthetic cohort.

    Response exposes only teammate names + Grok rationale — never other
    students' preferences or answers.
    """
    you = req.profile.model_copy(update={"id": "you", "name": req.profile.name.strip() or "You"})
    others_n = max(3, req.cohort_size - 1)
    others = generate_cohort(exclude_name=you.name, count=others_n)
    roster = [you, *others]

    try:
        raw_teams = solve_teams(roster, req.course.team_size_min, req.course.team_size_max, set())
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))

    your_team = next((t for t in raw_teams if any(m.id == "you" for m in t)), None)
    if your_team is None:
        raise HTTPException(status_code=500, detail="Solver finished but you were not assigned to a team.")

    stats = team_stats(your_team, set())
    dominant_goal = Counter(m.goal for m in your_team).most_common(1)[0][0]
    rationale = generate_rationale([m.name for m in your_team], stats["breakdown"], dominant_goal)

    team = [PublicTeammate(id=m.id, name=m.name, is_you=(m.id == "you")) for m in your_team]
    team.sort(key=lambda m: (not m.is_you, m.name.lower()))

    return MatchResponse(team=team, rationale=rationale, cohort_size=len(roster))


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
    dominant_goal = Counter(m.goal for m in members).most_common(1)[0][0]
    rationale = generate_rationale([m.name for m in members], stats["breakdown"], dominant_goal)
    return TeamResult(
        team_id=team_id,
        members=[TeamMember(id=m.id, name=m.name, goal=m.goal, hours=m.hours) for m in members],
        score=stats["avg"],
        breakdown=stats["breakdown"],
        violations=stats["violations"],
        rationale=rationale,
    )


@app.post("/api/optimize", response_model=OptimizeResponse)
def optimize(req: OptimizeRequest):
    vetoes = {tuple(sorted(pair)) for pair in req.vetoes}
    try:
        raw_teams = solve_teams(req.profiles, req.course.team_size_min, req.course.team_size_max, vetoes)
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))

    teams = [_to_team_result(f"team-{i}", members, vetoes) for i, members in enumerate(raw_teams)]

    optimized_avg = sum(t.score for t in teams) / len(teams) if teams else 0.0
    baseline_avg = random_baseline_score(
        req.profiles, vetoes, req.course.team_size_min, req.course.team_size_max
    )
    improvement_pct = ((optimized_avg - baseline_avg) / abs(baseline_avg) * 100) if baseline_avg else 0.0

    return OptimizeResponse(teams=teams, baseline_score=baseline_avg, improvement_pct=improvement_pct)


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

    teams = [
        _to_team_result(team_ids[i], members, vetoes)
        for i, members in enumerate(teams_as_people)
    ]
    optimized_avg = sum(t.score for t in teams) / len(teams) if teams else 0.0
    baseline_avg = random_baseline_score(
        req.profiles, vetoes, req.course.team_size_min, req.course.team_size_max
    )
    improvement_pct = ((optimized_avg - baseline_avg) / abs(baseline_avg) * 100) if baseline_avg else 0.0

    return OptimizeResponse(
        teams=teams,
        baseline_score=baseline_avg,
        improvement_pct=improvement_pct,
        flag_note=flag_note,
    )
