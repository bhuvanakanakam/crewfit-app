"""Quick end-to-end sanity check — not part of the app, just verifies the
solver + scoring + fallback pipeline works before you wire up a real API key."""

from app.models import CourseContext, ParseRequest, PersonInput, OptimizeRequest
from app.main import parse, optimize

SAMPLE = [
    ("Priya", "I really want to turn this into a research paper if possible. Free most weekday evenings, maybe 10 hours a week. Strong on stats, pretty weak at presenting."),
    ("Daniel", "Honestly just need to pass this one, I'm swamped this semester. Only free on weekends, maybe 4 hours a week tops. Decent at frontend."),
    ("Wei", "Aiming for an A, want to actually learn the material deeply too. Weekday evenings work, can do about 12 hours a week. Good at backend and algorithms, weak at writing."),
    ("Sanjana", "I'd love to deeply understand this subject. Weekday evenings and weekends both work, around 9 hours a week. Strong at data analysis."),
    ("Marcus", "Trying to get an A without burning out. Weekday evenings only, about 7 hours a week. I like to lead when I can, decent at presenting."),
    ("Elena", "Would be great if this became a paper eventually. Weekday evenings, 11 hours a week. Strong at writing and analysis, weak at frontend code."),
    ("Tomas", "Just need to pass honestly. Weekends only, 3 hours a week. Happy to support, not looking to lead."),
    ("Aisha", "Want to really master this topic. Weekday mornings and evenings, 13 hours a week. Strong at backend, weak at presenting."),
]

course = CourseContext(name="94-800 Negotiation", grading_notes="Group project worth 30% of the grade", team_size_min=3, team_size_max=4)
people = [PersonInput(name=n, bio=b) for n, b in SAMPLE]

parse_resp = parse(ParseRequest(course=course, people=people))
print(f"Parsed {len(parse_resp.profiles)} profiles.")
for p in parse_resp.profiles:
    print(f"  {p.name:10s} goal={p.goal:14s} hrs={p.hours:2d} avail={p.availability} conf={p.confidence:.2f} qs={p.clarifying_questions}")

opt_resp = optimize(OptimizeRequest(course=course, profiles=parse_resp.profiles, vetoes=[]))
print(f"Baseline score:  {opt_resp.baseline_score:.3f}")
print(f"Improvement:     {opt_resp.improvement_pct:.1f}%\n")

for t in opt_resp.teams:
    names = ", ".join(m.name for m in t.members)
    print(f"{t.team_id}: {names}")
    print(f"  score={t.score:.3f} violations={t.violations}")
    print(f"  rationale: {t.rationale}")
