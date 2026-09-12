from app.models import CourseContext, ParseRequest, PersonInput, OptimizeRequest, FlagRequest
from app.main import parse, optimize, flag

SAMPLE = [
    ("Priya", "I really want to turn this into a research paper if possible. Free most weekday evenings, maybe 10 hours a week. Strong on stats, pretty weak at presenting."),
    ("Daniel", "Honestly just need to pass this one, I'm swamped this semester. Only free on weekends, maybe 4 hours a week tops. Decent at frontend."),
    ("Wei", "Aiming for an A, want to actually learn the material deeply too. Weekday evenings work, can do about 12 hours a week. Good at backend and algorithms, weak at writing."),
    ("Sanjana", "I'd love to deeply understand this subject, not just get through it. Weekday evenings and weekends both work, around 9 hours a week. Strong at data analysis, okay at everything else."),
    ("Marcus", "Trying to get an A without burning out. Weekday evenings only, about 7 hours a week. I like to lead when I can, decent at presenting."),
    ("Elena", "Would be great if this became a paper eventually — I'm applying to PhD programs. Weekday evenings, 11 hours a week. Strong at writing and analysis, weak at frontend code."),
    ("Tomas", "Just need to pass honestly, this isn't my main focus this term. Weekends only, 3 hours a week. Happy to support, not looking to lead."),
    ("Aisha", "Want to really master this topic, might use it in my thesis later. Weekday mornings and evenings, 13 hours a week. Strong at backend, weak at presenting."),
    ("Ben", "Going for an A, fairly balanced across everything. Weekday afternoons and weekends, 8 hours a week. Comfortable leading or supporting."),
    ("Carla", "I want to publish something out of this if we can. Weekday evenings, 10 hours a week. Strong at analysis and writing, weak at coding."),
    ("Youssef", "Just trying to pass, juggling two other classes. Weekends only, 4 hours a week. Prefers to rotate who leads."),
    ("Naomi", "Want to deeply understand the material, this is core to my major. Weekday evenings and mornings, 12 hours a week. Strong at frontend, weak at stats."),
    ("Owen", "Aiming for an A, want the team to escalate to the TA if we're stuck rather than argue. Weekday afternoons, 8 hours a week. Decent at backend."),
    ("Ravi", "Would like this to be publishable work eventually. Weekday evenings, 11 hours a week. Strong at algorithms, weak at presenting."),
    ("Grace", "Just need to pass, very limited time this term. Weekends only, 3 hours a week. Happy to support wherever needed."),
    ("Hana", "Want to master this deeply and maybe TA it next year. Weekday evenings and weekends, 14 hours a week. Strong at presenting and writing, weak at backend."),
]

course = CourseContext(name="94-800 Negotiation", grading_notes="Group project worth 30% of the grade", team_size_min=3, team_size_max=4)
people = [PersonInput(name=n, bio=b) for n, b in SAMPLE]

parse_resp = parse(ParseRequest(course=course, people=people))
opt_resp = optimize(OptimizeRequest(course=course, profiles=parse_resp.profiles, vetoes=[]))

print(f"Baseline: {opt_resp.baseline_score:.3f}   Improvement: {opt_resp.improvement_pct:.1f}%\n")
for t in opt_resp.teams:
    print(f"{t.team_id}: {[m.name for m in t.members]}  score={t.score:.3f} violations={t.violations}")
    print(f"  {t.rationale}")

# --- exercise the flag / local re-optimization path ---
flagged_person = opt_resp.teams[0].members[0]
print(f"\nFlagging {flagged_person.name} (reason: schedule) for local re-optimization...")
flag_resp = flag(FlagRequest(course=course, profiles=parse_resp.profiles, teams=opt_resp.teams, person_id=flagged_person.id, reason="schedule", vetoes=[]))
print(f"Flag note: {flag_resp.flag_note}")
for t in flag_resp.teams:
    print(f"{t.team_id}: {[m.name for m in t.members]}  score={t.score:.3f} violations={t.violations}")
