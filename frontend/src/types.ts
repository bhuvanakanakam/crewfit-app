export type GoalType = "pass" | "grade_A" | "research" | "deep_mastery";

export interface CourseContext {
  name: string;
  grading_notes: string;
  team_size_min: number;
  team_size_max: number;
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
}

export const DEFAULT_COURSE: CourseContext = {
  name: "HackCMU Team Formation",
  grading_notes: "Collaborative project; teams of 3–4.",
  team_size_min: 3,
  team_size_max: 4,
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
