export type GoalType = "pass" | "grade_A" | "research" | "deep_mastery";

export const ALL_SKILL_KEYS = ["technical", "writing", "analysis", "presentation"] as const;
export type SkillKey = (typeof ALL_SKILL_KEYS)[number];

export interface CourseContext {
  name: string;
  grading_notes: string;
  team_size_min: number;
  team_size_max: number;
  team_count?: number | null;
  objective?: string;
  focus_skills?: string[];
  skill_labels?: Record<string, string>;
}

export interface Course {
  id: string;
  name: string;
  grading_notes: string;
  team_size_min: number;
  team_size_max: number;
  team_count?: number | null;
  objective?: string;
  focus_skills?: string[];
  skill_labels?: Record<string, string>;
  access?: "student" | "teacher" | "ta";
  enrolled?: boolean;
}

export function toCourseContext(course: Course): CourseContext {
  return {
    name: course.name,
    grading_notes: course.objective || course.grading_notes,
    team_size_min: course.team_size_min,
    team_size_max: course.team_size_max,
    team_count: null,
    objective: course.objective || course.grading_notes,
    focus_skills: course.focus_skills,
    skill_labels: course.skill_labels,
  };
}

export interface Skills {
  technical: number;
  writing: number;
  analysis: number;
  presentation: number;
}

/** Full profile for the student only. */
export interface StructuredProfile {
  id: string;
  name: string;
  bio: string;
  goal: GoalType;
  availability: string[];
  skills: Skills;
  hours: number;
  role: "lead" | "contributor" | "either";
  conflict_mode: "vote" | "rotate_lead" | "escalate" | "defer_to_invested";
  confidence: number;
  clarifying_questions: string[];
}

export interface PublicTeammate {
  id: string;
  name: string;
  is_you: boolean;
}

export interface MatchResponse {
  team: PublicTeammate[];
  rationale: string;
  cohort_size: number;
  shared_windows: string[];
  team_goal: string;
  coverage: string[];
  thin: string[];
  course_id: string;
  course_name: string;
  team_id?: string;
  team_label?: string;
  waiting?: boolean;
  skill_peaks?: Record<string, number>;
}

export function isPendingProfile(profile: StructuredProfile | null | undefined): boolean {
  if (!profile) return true;
  if (profile.id.startsWith("enroll-") || profile.id.startsWith("pending-") || profile.id === "you") return true;
  return (profile.bio || "").trim() === "Enrolled in the course.";
}

export function hasOfficialTeam(match: MatchResponse | null | undefined): boolean {
  return Boolean(match && !match.waiting && match.team.length);
}

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatResponse {
  reply: string;
  ready: boolean;
  profile: StructuredProfile | null;
}

export interface TeamMember {
  id: string;
  name: string;
  goal: GoalType;
  hours: number;
  role?: "lead" | "contributor" | "either";
  skills?: Skills;
}

export interface TeamResult {
  team_id: string;
  members: TeamMember[];
  score: number;
  breakdown: Record<string, number>;
  violations: number;
  rationale: string;
  shared_windows: string[];
  team_goal: string;
  coverage: string[];
  thin: string[];
  skill_peaks?: Record<string, number>;
}

export interface PrefImpact {
  before: number;
  after: number;
  delta_pct: number;
  hurts_team: boolean;
  message: string;
  teammates: string[];
}

export interface SubmitResponse {
  profile: StructuredProfile;
  impact?: PrefImpact | null;
}

export interface NotificationRecord {
  id: string;
  course_id: string;
  to_name: string;
  to_role: "student" | "teacher";
  kind: "concern" | "pref_update" | "score_drop" | "rematch" | "team" | "staff";
  title: string;
  body: string;
  read: boolean;
  created_at: string;
  student?: string | null;
  reason?: string | null;
}

export interface ConcernRecord {
  name: string;
  course_id: string;
  reason: FlagReason;
  note: string;
  status?: "open" | "approved" | "denied";
  allow_rematch?: boolean;
}

export interface RosterResponse {
  profiles: StructuredProfile[];
  concerns: Record<string, ConcernRecord>;
  rematch_allowed?: Record<string, boolean>;
  course: Course;
  assignment?: OptimizeResponse | null;
}

export interface OptimizeResponse {
  teams: TeamResult[];
  baseline_score: number;
  improvement_pct: number;
  flag_note?: string | null;
}

export interface LoginResponse {
  name: string;
  role: "student" | "teacher";
  staff_kind: "teacher" | "ta" | "none";
  can_create_course: boolean;
  hint?: string | null;
  courses: Course[];
}

export type FlagReason = "schedule" | "goal" | "workload" | "other";

export const FLAG_REASONS: { value: FlagReason; label: string }[] = [
  { value: "schedule", label: "Schedule" },
  { value: "goal", label: "Goal mismatch" },
  { value: "workload", label: "Workload" },
  { value: "other", label: "Other" },
];

export const FLAG_REASON_LABELS: Record<FlagReason, string> = {
  schedule: "Schedule",
  goal: "Goal mismatch",
  workload: "Workload",
  other: "Other",
};

export const GOAL_LABELS: Record<GoalType, string> = {
  pass: "Pass",
  grade_A: "Grade A",
  research: "Research",
  deep_mastery: "Deep mastery",
};

export const ROLE_LABELS = {
  lead: "Lead",
  contributor: "Contributor",
  either: "Either",
} as const;

export const CONFLICT_LABELS = {
  vote: "Vote",
  rotate_lead: "Rotate lead",
  escalate: "Escalate",
  defer_to_invested: "Defer to invested",
} as const;

export const BREAKDOWN_LABELS: Record<string, string> = {
  goal: "Goals",
  avail: "Schedule",
  skill: "Skills",
  workload: "Hours",
};

export const DEFAULT_COURSE: CourseContext = {
  name: "Team Formation",
  grading_notes: "Collaborative project; teams of 3–4.",
  team_size_min: 3,
  team_size_max: 4,
  focus_skills: [...ALL_SKILL_KEYS],
};

export const DAYS = [
  { id: "mon", label: "Mon" },
  { id: "tue", label: "Tue" },
  { id: "wed", label: "Wed" },
  { id: "thu", label: "Thu" },
  { id: "fri", label: "Fri" },
  { id: "sat", label: "Sat" },
  { id: "sun", label: "Sun" },
] as const;

export const TIMES = [
  { id: "morning", label: "Morning", hint: "9am–12pm" },
  { id: "afternoon", label: "Afternoon", hint: "12–5pm" },
  { id: "evening", label: "Evening", hint: "5–9pm" },
] as const;

export const SKILL_FIELDS = [
  {
    key: "technical" as const,
    label: "Technical",
    hint: "Coding, engineering, building the product",
  },
  {
    key: "writing" as const,
    label: "Writing",
    hint: "Docs, reports, README, written narrative",
  },
  {
    key: "analysis" as const,
    label: "Analysis",
    hint: "Data, research, breaking down the problem",
  },
  {
    key: "presentation" as const,
    label: "Presentation",
    hint: "Demos, pitches, speaking to an audience",
  },
];

export const GOAL_OPTIONS: { value: GoalType; label: string; hint: string }[] = [
  { value: "pass", label: "Pass", hint: "Get through the project" },
  { value: "grade_A", label: "Grade A", hint: "Strong grade, solid work" },
  { value: "research", label: "Research", hint: "Publishable / research angle" },
  { value: "deep_mastery", label: "Deep mastery", hint: "Really learn the material" },
];

export function formatSlot(slot: string): string {
  const [day, time] = slot.split("_");
  const d = DAYS.find((x) => x.id === day)?.label ?? day;
  const t = TIMES.find((x) => x.id === time)?.label ?? time;
  return `${d} ${t}`;
}

export function isLiveStudent(id: string): boolean {
  return id.startsWith("stu-");
}

export const SKILL_LABELS: Record<string, string> = {
  technical: "Technical",
  writing: "Writing",
  analysis: "Analysis",
  presentation: "Presentation",
};

export function courseSkillFields(course: { focus_skills?: string[]; skill_labels?: Record<string, string> }) {
  const wanted = course.focus_skills?.length ? course.focus_skills : ALL_SKILL_KEYS;
  return SKILL_FIELDS.filter((s) => wanted.includes(s.key)).map((s) => ({
    ...s,
    label: course.skill_labels?.[s.key] || s.label,
  }));
}

export function skillList(keys: string[]): string {
  const labels = keys.map((k) => SKILL_LABELS[k] ?? k);
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}
