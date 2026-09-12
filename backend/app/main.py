from collections import Counter

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .analysis import apply_swap, best_swap_for_person, random_baseline_score, team_stats
from .grok_client import extract_profile, generate_rationale, resolve_clarification
from .models import (
    ClarifyRequest,
    FlagRequest,
    OptimizeRequest,
    OptimizeResponse,
    ParseRequest,
    ParseResponse,
    StructuredProfile,
    TeamMember,
    TeamResult,
)
from .solver import solve_teams

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
    baseline_avg = random_baseline_score(req.profiles, vetoes, req.course.team_size_max)
    improvement_pct = ((optimized_avg - baseline_avg) / abs(baseline_avg) * 100) if baseline_avg else 0.0

    return OptimizeResponse(teams=teams, baseline_score=baseline_avg, improvement_pct=improvement_pct)


@app.post("/api/flag", response_model=OptimizeResponse)
def flag(req: FlagRequest):
    vetoes = {tuple(sorted(pair)) for pair in req.vetoes} if hasattr(req, "vetoes") else set()
    profiles_by_id = {p.id: p for p in req.profiles}

    teams_as_people: list[list[StructuredProfile]] = [
        [profiles_by_id[m.id] for m in t.members] for t in req.teams
    ]

    swap = best_swap_for_person(teams_as_people, req.person_id, vetoes)
    if swap and swap["delta"] > 0:
        teams_as_people = apply_swap(teams_as_people, swap)

    teams = [_to_team_result(req.teams[i].team_id, members, vetoes) for i, members in enumerate(teams_as_people)]
    optimized_avg = sum(t.score for t in teams) / len(teams) if teams else 0.0
    baseline_avg = random_baseline_score(req.profiles, vetoes, req.course.team_size_max)
    improvement_pct = ((optimized_avg - baseline_avg) / abs(baseline_avg) * 100) if baseline_avg else 0.0

    return OptimizeResponse(teams=teams, baseline_score=baseline_avg, improvement_pct=improvement_pct)
