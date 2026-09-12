"""Synthetic cohort generation with Faker — fills the rest of the class so a
single student can demo the match flow without uploading a real roster."""

from __future__ import annotations

import random

from faker import Faker

from .models import Skills, StructuredProfile
from .slots import ALL_SLOTS

GOALS = ["pass", "grade_A", "research", "deep_mastery"]
ROLES = ["lead", "contributor", "either"]
CONFLICTS = ["vote", "rotate_lead", "escalate", "defer_to_invested"]

GOAL_WEIGHTS = [0.2, 0.4, 0.15, 0.25]
ROLE_WEIGHTS = [0.2, 0.35, 0.45]


def generate_cohort(exclude_name: str, count: int = 15, seed: int | None = None) -> list[StructuredProfile]:
    fake = Faker()
    if seed is not None:
        Faker.seed(seed)
        random.seed(seed)

    profiles: list[StructuredProfile] = []
    used_names: set[str] = {exclude_name.strip().lower()}

    for i in range(count):
        name = fake.first_name()
        while name.lower() in used_names:
            name = fake.first_name()
        used_names.add(name.lower())

        goal = random.choices(GOALS, weights=GOAL_WEIGHTS, k=1)[0]
        # 3–6 concrete day×time windows — mirrors how students actually block time.
        n_slots = random.choice([3, 4, 5, 6])
        availability = sorted(random.sample(list(ALL_SLOTS), k=n_slots))
        hours = {
            "pass": random.randint(3, 6),
            "grade_A": random.randint(6, 10),
            "research": random.randint(9, 14),
            "deep_mastery": random.randint(10, 15),
        }[goal]

        skills = {
            "technical": random.randint(2, 5),
            "writing": random.randint(2, 5),
            "analysis": random.randint(2, 5),
            "presentation": random.randint(2, 5),
        }
        strong = random.choice(list(skills))
        weak = random.choice([k for k in skills if k != strong])
        skills[strong] = 5
        skills[weak] = 1

        profiles.append(
            StructuredProfile(
                id=f"syn-{i}",
                name=name,
                bio=fake.sentence(nb_words=12),
                goal=goal,  # type: ignore[arg-type]
                availability=availability,
                skills=Skills(**skills),
                hours=hours,
                role=random.choices(ROLES, weights=ROLE_WEIGHTS, k=1)[0],  # type: ignore[arg-type]
                conflict_mode=random.choice(CONFLICTS),  # type: ignore[arg-type]
                confidence=1.0,
                clarifying_questions=[],
            )
        )

    return profiles
