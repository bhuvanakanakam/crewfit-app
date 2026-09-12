"""
The compatibility model. This is the part of the system that stays entirely
yours — no LLM call happens in this file. Grok only touches the steps before
(extraction) and after (rationale wording); this scoring function is what the
solver actually optimizes.
"""

GOAL_ALIGN = {
    "pass":         {"pass": 1.0, "grade_A": 0.6, "research": 0.1, "deep_mastery": 0.3},
    "grade_A":      {"pass": 0.6, "grade_A": 1.0, "research": 0.5, "deep_mastery": 0.8},
    "research":     {"pass": 0.1, "grade_A": 0.5, "research": 1.0, "deep_mastery": 0.8},
    "deep_mastery": {"pass": 0.3, "grade_A": 0.8, "research": 0.8, "deep_mastery": 1.0},
}

WEIGHTS = {"goal": 0.35, "avail": 0.25, "skill": 0.20, "workload": 0.15, "role": 0.05}

SKILL_CATEGORIES = ["technical", "writing", "analysis", "presentation"]


def availability_overlap(a, b):
    set_a, set_b = set(a.availability), set(b.availability)
    inter = set_a & set_b
    union = set_a | set_b
    jaccard = len(inter) / len(union) if union else 0.0
    return jaccard, len(inter) > 0


def skill_score(a, b):
    total = sum(max(getattr(a.skills, c), getattr(b.skills, c)) for c in SKILL_CATEGORIES)
    return total / (len(SKILL_CATEGORIES) * 5)


def workload_sim(a, b):
    return max(0.0, 1 - abs(a.hours - b.hours) / 20)


def role_bonus(a, b):
    if a.role == "lead" and b.role == "lead":
        return -0.3
    if a.role == "either" or b.role == "either":
        return 0.1
    if a.role != b.role:
        return 0.2
    return 0.0


def veto_key(a_id: str, b_id: str):
    return tuple(sorted((a_id, b_id)))


HARD_CONFLICT_PENALTY = -1.5  # no overlapping availability: heavily discouraged, not infeasible


def pair_score(a, b, vetoes: set):
    """Returns None only for an explicit organizer veto — that's the one true
    hard constraint the solver enforces structurally.

    Zero availability overlap does NOT return None: it returns a heavily
    penalized score with hard_conflict=True. Treating it as a hard model
    constraint (as an earlier version of this did) can make the whole
    assignment infeasible on small/unlucky rosters — e.g. two weekend-only
    people who share no evening slot with anyone else. A steep penalty keeps
    the solver always feasible while still avoiding these pairings whenever
    any workable alternative exists."""
    if veto_key(a.id, b.id) in vetoes:
        return None

    jaccard, has_overlap = availability_overlap(a, b)
    if not has_overlap:
        return {
            "score": HARD_CONFLICT_PENALTY,
            "breakdown": {"goal": 0.0, "avail": 0.0, "skill": 0.0, "workload": 0.0, "role": 0.0},
            "hard_conflict": True,
        }

    goal = GOAL_ALIGN[a.goal][b.goal]
    skill = skill_score(a, b)
    workload = workload_sim(a, b)
    role = role_bonus(a, b)
    score = (
        WEIGHTS["goal"] * goal
        + WEIGHTS["avail"] * jaccard
        + WEIGHTS["skill"] * skill
        + WEIGHTS["workload"] * workload
        + WEIGHTS["role"] * role
    )
    return {
        "score": score,
        "breakdown": {"goal": goal, "avail": jaccard, "skill": skill, "workload": workload, "role": role},
        "hard_conflict": False,
    }
