import type {
  ChatMessage,
  ChatResponse,
  ConcernRecord,
  Course,
  CourseContext,
  FlagReason,
  MatchResponse,
  OptimizeResponse,
  RosterResponse,
  StructuredProfile,
  TeamResult,
} from "./types";

const BASE = import.meta.env.VITE_API_BASE ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail ?? `Request to ${path} failed (${res.status})`);
  }
  return res.json();
}

function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: "POST", body: JSON.stringify(body) });
}

export function listCourses() {
  return request<{ courses: Course[] }>("/courses");
}

export function createCourse(body: {
  name: string;
  grading_notes?: string;
  team_size_min?: number;
  team_size_max?: number;
}) {
  return post<Course>("/courses", body);
}

export function lookupProfile(name: string, courseId?: string) {
  const q = new URLSearchParams({ name });
  if (courseId) q.set("course_id", courseId);
  return request<{ profile: StructuredProfile | null; match: MatchResponse | null }>(`/profile?${q}`);
}

export function sendChat(name: string, messages: ChatMessage[], course: CourseContext) {
  return post<ChatResponse>("/chat", { name, messages, course });
}

export function findMatch(
  profile: StructuredProfile,
  course: CourseContext,
  courseId: string,
  cohortSize = 16,
) {
  return post<MatchResponse>("/match", { profile, course, course_id: courseId, cohort_size: cohortSize });
}

export function submitProfile(profile: StructuredProfile, courseId?: string) {
  const q = courseId ? `?course_id=${encodeURIComponent(courseId)}` : "";
  return post<StructuredProfile>(`/submit${q}`, profile);
}

export function loadRoster(courseId: string, fill = 16) {
  return request<RosterResponse>(`/roster?course_id=${encodeURIComponent(courseId)}&fill=${fill}`);
}

export function optimizeTeams(profiles: StructuredProfile[], course: CourseContext, courseId?: string) {
  return post<OptimizeResponse>("/optimize", { course, profiles, vetoes: [], course_id: courseId });
}

export function flagStudent(
  profiles: StructuredProfile[],
  teams: TeamResult[],
  personId: string,
  reason: FlagReason,
  course: CourseContext,
  courseId?: string,
) {
  return post<OptimizeResponse>("/flag", {
    course,
    profiles,
    teams,
    person_id: personId,
    reason,
    vetoes: [],
    course_id: courseId,
  });
}

export function raiseConcern(name: string, courseId: string, reason: FlagReason, note = "") {
  return post<ConcernRecord>("/concern", { name, course_id: courseId, reason, note });
}
