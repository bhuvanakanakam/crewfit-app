export type GoalType = "pass" | "grade_A" | "research" | "deep_mastery";
export type Slot = "weekday_morning" | "weekday_afternoon" | "weekday_evening" | "weekend";
export type Role = "lead" | "contributor" | "either";
export type ConflictMode = "vote" | "rotate_lead" | "escalate" | "defer_to_invested";

export const GOAL_LABEL: Record<GoalType, string> = {
  pass: "Pass",
  grade_A: "Grade A",
  research: "Research",
  deep_mastery: "Deep mastery",
};

export const SLOT_LABEL: Record<Slot, string> = {
  weekday_morning: "Weekday mornings",
  weekday_afternoon: "Weekday afternoons",
  weekday_evening: "Weekday evenings",
  weekend: "Weekends",
};

export const ROLE_LABEL: Record<Role, string> = {
  lead: "Lead",
  contributor: "Contributor",
  either: "Either",
};

export const CONFLICT_LABEL: Record<ConflictMode, string> = {
  vote: "Vote",
  rotate_lead: "Rotate lead",
  escalate: "Escalate to instructor/TA",
  defer_to_invested: "Defer to most invested",
};

export interface CourseContext {
  name: string;
  grading_notes: string;
  team_size_min: number;
  team_size_max: number;
}

export interface PersonInput {
  name: string;
  bio: string;
}

export interface Skills {
  technical: number;
  writing: number;
  analysis: number;
  presentation: number;
}

export interface StructuredProfile {
  id: string;
  name: string;
  bio: string;
  goal: GoalType;
  availability: Slot[];
  skills: Skills;
  hours: number;
  role: Role;
  conflict_mode: ConflictMode;
  confidence: number;
  clarifying_questions: string[];
}

export interface TeamMember {
  id: string;
  name: string;
  goal: GoalType;
  hours: number;
}

export interface TeamBreakdown {
  goal: number;
  avail: number;
  skill: number;
  workload: number;
}

export interface TeamResult {
  team_id: string;
  members: TeamMember[];
  score: number;
  breakdown: TeamBreakdown;
  violations: number;
  rationale: string;
}

export interface OptimizeResponse {
  teams: TeamResult[];
  baseline_score: number;
  improvement_pct: number;
}

export type FlagReason = "schedule" | "goal" | "workload" | "other";
