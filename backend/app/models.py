from typing import Literal, Optional
from pydantic import BaseModel, Field

GoalType = Literal["pass", "grade_A", "research", "deep_mastery"]
Slot = Literal["weekday_morning", "weekday_afternoon", "weekday_evening", "weekend"]
Role = Literal["lead", "contributor", "either"]
ConflictMode = Literal["vote", "rotate_lead", "escalate", "defer_to_invested"]


class CourseContext(BaseModel):
    name: str
    grading_notes: Optional[str] = ""
    team_size_min: int = 3
    team_size_max: int = 4


class PersonInput(BaseModel):
    name: str
    bio: str


class Skills(BaseModel):
    technical: int = Field(3, ge=1, le=5)
    writing: int = Field(3, ge=1, le=5)
    analysis: int = Field(3, ge=1, le=5)
    presentation: int = Field(3, ge=1, le=5)


class StructuredProfile(BaseModel):
    id: str
    name: str
    bio: str
    goal: GoalType
    availability: list[Slot]
    skills: Skills
    hours: int = Field(8, ge=1, le=40)
    role: Role = "either"
    conflict_mode: ConflictMode = "vote"
    confidence: float = 1.0
    clarifying_questions: list[str] = []


class ParseRequest(BaseModel):
    course: CourseContext
    people: list[PersonInput]


class ParseResponse(BaseModel):
    profiles: list[StructuredProfile]


class ClarifyAnswer(BaseModel):
    profile_id: str
    question: str
    answer: str


class ClarifyRequest(BaseModel):
    course: CourseContext
    profiles: list[StructuredProfile]
    answers: list[ClarifyAnswer]


class OptimizeRequest(BaseModel):
    course: CourseContext
    profiles: list[StructuredProfile]
    vetoes: list[list[str]] = []  # list of [person_id, person_id] pairs


class TeamMember(BaseModel):
    id: str
    name: str
    goal: GoalType
    hours: int


class TeamResult(BaseModel):
    team_id: str
    members: list[TeamMember]
    score: float
    breakdown: dict
    violations: int
    rationale: str


class OptimizeResponse(BaseModel):
    teams: list[TeamResult]
    baseline_score: float
    improvement_pct: float


class FlagRequest(BaseModel):
    course: CourseContext
    profiles: list[StructuredProfile]
    teams: list[TeamResult]
    person_id: str
    reason: Literal["schedule", "goal", "workload", "other"]
