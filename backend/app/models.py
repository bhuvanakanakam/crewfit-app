from typing import Literal, Optional
from pydantic import BaseModel, Field, field_validator, model_validator

from .slots import normalize_availability

GoalType = Literal["pass", "grade_A", "research", "deep_mastery"]
Role = Literal["lead", "contributor", "either"]
ConflictMode = Literal["vote", "rotate_lead", "escalate", "defer_to_invested"]

SKILL_KEYS = ("technical", "writing", "analysis", "presentation")
DEFAULT_SKILL_LABELS = {
    "technical": "Technical",
    "writing": "Writing",
    "analysis": "Analysis",
    "presentation": "Presentation",
}


def normalize_focus_skills(values: list[str] | None) -> list[str]:
    keys = [key for key in (values or []) if key in SKILL_KEYS]
    return keys or list(SKILL_KEYS)


class CourseContext(BaseModel):
    name: str
    grading_notes: Optional[str] = ""
    team_size_min: int = Field(3, ge=2, le=8)
    team_size_max: int = Field(4, ge=2, le=8)
    team_count: Optional[int] = Field(None, ge=1, le=40)
    objective: Optional[str] = ""
    focus_skills: list[str] = Field(default_factory=lambda: list(SKILL_KEYS))
    skill_labels: dict[str, str] = Field(default_factory=dict)

    @field_validator("focus_skills", mode="before")
    @classmethod
    def _focus(cls, value):
        if isinstance(value, str):
            return normalize_focus_skills([part.strip() for part in value.split(",")])
        return normalize_focus_skills(list(value or []))

    @model_validator(mode="after")
    def _sizes(self):
        if self.team_size_min > self.team_size_max:
            raise ValueError("Minimum team size cannot be larger than the maximum.")
        return self


class Course(BaseModel):
    id: str
    name: str
    grading_notes: Optional[str] = ""
    team_size_min: int = Field(3, ge=2, le=8)
    team_size_max: int = Field(4, ge=2, le=8)
    team_count: Optional[int] = Field(None, ge=1, le=40)
    objective: Optional[str] = ""
    focus_skills: list[str] = Field(default_factory=lambda: list(SKILL_KEYS))
    skill_labels: dict[str, str] = Field(default_factory=dict)
    cohort_seeded: bool = False

    @field_validator("focus_skills", mode="before")
    @classmethod
    def _focus(cls, value):
        if isinstance(value, str):
            return normalize_focus_skills([part.strip() for part in value.split(",")])
        return normalize_focus_skills(list(value or []))

    @model_validator(mode="after")
    def _sizes(self):
        if self.team_size_min > self.team_size_max:
            raise ValueError("Minimum team size cannot be larger than the maximum.")
        return self

    def context(self) -> CourseContext:
        return CourseContext(
            name=self.name,
            grading_notes=self.objective or self.grading_notes or "",
            team_size_min=self.team_size_min,
            team_size_max=self.team_size_max,
            team_count=self.team_count,
            objective=self.objective or self.grading_notes or "",
            focus_skills=self.focus_skills,
            skill_labels=self.skill_labels,
        )


class CourseView(Course):
    access: Literal["student", "teacher", "ta"] = "student"
    enrolled: bool = False


class Account(BaseModel):
    name: str
    home_role: Literal["student", "teacher"]
    created_at: str = ""
    email: Optional[str] = None
    auth_sub: Optional[str] = None
    password_hash: Optional[str] = None


class PersonInput(BaseModel):
    name: str
    bio: str


class Skills(BaseModel):
    technical: int = Field(3, ge=1, le=5)  # coding / building
    writing: int = Field(3, ge=1, le=5)  # docs / reports
    analysis: int = Field(3, ge=1, le=5)  # data / research
    presentation: int = Field(3, ge=1, le=5)  # demos / pitching


class StructuredProfile(BaseModel):
    id: str
    name: str
    bio: str
    goal: GoalType
    # day×time slots, e.g. "mon_evening", "sat_afternoon"
    availability: list[str]
    skills: Skills
    hours: int = Field(8, ge=1, le=40)
    role: Role = "either"
    conflict_mode: ConflictMode = "vote"
    confidence: float = 1.0
    clarifying_questions: list[str] = []

    @field_validator("availability", mode="before")
    @classmethod
    def _normalize_slots(cls, v):
        if not isinstance(v, list):
            return ["wed_evening"]
        return normalize_availability([str(x) for x in v])


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
    vetoes: list[list[str]] = []
    course_id: Optional[str] = None


class TeamMember(BaseModel):
    id: str
    name: str
    goal: GoalType
    hours: int
    role: Role = "either"
    skills: Skills = Field(default_factory=Skills)


class TeamResult(BaseModel):
    team_id: str
    members: list[TeamMember]
    score: float
    breakdown: dict
    violations: int
    rationale: str
    shared_windows: list[str] = []
    team_goal: str = ""
    coverage: list[str] = []
    thin: list[str] = []
    skill_peaks: dict[str, int] = Field(default_factory=dict)


class OptimizeResponse(BaseModel):
    teams: list[TeamResult]
    baseline_score: float
    improvement_pct: float
    flag_note: Optional[str] = None


class FlagRequest(BaseModel):
    course: CourseContext
    profiles: list[StructuredProfile]
    teams: list[TeamResult]
    person_id: str
    reason: Literal["schedule", "goal", "workload", "other"]
    vetoes: list[list[str]] = []
    course_id: Optional[str] = None


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    name: str
    messages: list[ChatMessage]
    course: CourseContext = Field(
        default_factory=lambda: CourseContext(
            name="Team Formation",
            grading_notes="Collaborative project; teams of 3–4.",
            team_size_min=3,
            team_size_max=4,
        )
    )
    mode: Literal["intake", "update"] = "intake"
    profile: Optional[StructuredProfile] = None
    focus: Optional[Literal["goal", "hours", "availability", "skills", "role", "any"]] = None


class ChatResponse(BaseModel):
    reply: str
    ready: bool = False
    profile: Optional[StructuredProfile] = None


class PublicTeammate(BaseModel):
    id: str
    name: str
    is_you: bool = False


class MatchRequest(BaseModel):
    profile: StructuredProfile
    course: CourseContext = Field(
        default_factory=lambda: CourseContext(
            name="Team Formation",
            grading_notes="Collaborative project; teams of 3–4.",
            team_size_min=3,
            team_size_max=4,
        )
    )
    course_id: Optional[str] = None
    cohort_size: int = Field(16, ge=4, le=40)


class MatchResponse(BaseModel):
    team: list[PublicTeammate]
    rationale: str
    cohort_size: int
    shared_windows: list[str] = []
    team_goal: str = ""
    coverage: list[str] = []
    thin: list[str] = []
    course_id: str = ""
    course_name: str = ""
    team_id: str = ""
    team_label: str = ""
    waiting: bool = False
    skill_peaks: dict[str, int] = Field(default_factory=dict)


class CreateCourseRequest(BaseModel):
    name: str
    grading_notes: Optional[str] = ""
    team_size_min: int = Field(3, ge=2, le=8)
    team_size_max: int = Field(4, ge=2, le=8)
    team_count: Optional[int] = Field(None, ge=1, le=40)
    objective: Optional[str] = ""
    focus_skills: list[str] = Field(default_factory=lambda: list(SKILL_KEYS))
    skill_labels: dict[str, str] = Field(default_factory=dict)
    actor: str = ""

    @field_validator("focus_skills", mode="before")
    @classmethod
    def _focus(cls, value):
        if isinstance(value, str):
            return normalize_focus_skills([part.strip() for part in value.split(",")])
        return normalize_focus_skills(list(value or []))

    @model_validator(mode="after")
    def _sizes(self):
        if self.team_size_min > self.team_size_max:
            raise ValueError("Minimum team size cannot be larger than the maximum.")
        return self


class CourseListResponse(BaseModel):
    courses: list[CourseView]


class LoginRequest(BaseModel):
    name: Optional[str] = None
    id_token: Optional[str] = None
    email: Optional[str] = None
    password: Optional[str] = None
    requested_role: Literal["student", "teacher"]


class LoginResponse(BaseModel):
    name: str
    role: Literal["student", "teacher"]
    staff_kind: Literal["teacher", "ta", "none"]
    can_create_course: bool
    hint: Optional[str] = None
    courses: list[CourseView]


class EnrollRequest(BaseModel):
    name: str


class StaffRequest(BaseModel):
    actor: str
    name: str
    kind: Literal["ta"] = "ta"


class ProfileLookupResponse(BaseModel):
    profile: Optional[StructuredProfile] = None
    match: Optional[MatchResponse] = None
    rematch_allowed: bool = False
    concern: Optional["ConcernRecord"] = None


class ConcernRequest(BaseModel):
    name: str
    course_id: str
    reason: Literal["schedule", "goal", "workload", "other"]
    note: Optional[str] = ""


class ConcernRecord(BaseModel):
    name: str
    course_id: str
    reason: Literal["schedule", "goal", "workload", "other"]
    note: str = ""
    status: Literal["open", "approved", "denied"] = "open"
    allow_rematch: bool = False


class ResolveConcernRequest(BaseModel):
    name: str
    course_id: str
    status: Literal["approved", "denied"]


class RematchPermissionRequest(BaseModel):
    name: str
    course_id: str
    allowed: bool = True


class PrefImpact(BaseModel):
    before: float
    after: float
    delta_pct: float
    hurts_team: bool
    message: str
    teammates: list[str] = []


class SubmitResponse(BaseModel):
    profile: StructuredProfile
    impact: Optional[PrefImpact] = None


class NotificationRecord(BaseModel):
    id: str
    course_id: str
    to_name: str
    to_role: Literal["student", "teacher"]
    kind: Literal["concern", "pref_update", "score_drop", "rematch", "team", "staff"]
    title: str
    body: str
    read: bool = False
    created_at: str = ""
    student: Optional[str] = None
    reason: Optional[str] = None


class NotificationListResponse(BaseModel):
    notifications: list[NotificationRecord]


class MarkReadRequest(BaseModel):
    ids: list[str]


class RosterResponse(BaseModel):
    profiles: list[StructuredProfile]
    concerns: dict[str, ConcernRecord] = {}
    rematch_allowed: dict[str, bool] = {}
    course: Course
    assignment: Optional[OptimizeResponse] = None


ProfileLookupResponse.model_rebuild()
