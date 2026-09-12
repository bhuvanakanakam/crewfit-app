import type {
  ChatMessage,
  ChatResponse,
  ConcernRecord,
  Course,
  CourseContext,
  FlagReason,
  LoginResponse,
  MatchResponse,
  NotificationRecord,
  OptimizeResponse,
  RosterResponse,
  StructuredProfile,
  SubmitResponse,
  TeamResult,
} from "./types";

const BASE = import.meta.env.VITE_API_BASE ?? "";

function apiErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const detail = (payload as { detail?: unknown }).detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const parts = detail
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "msg" in item) return String((item as { msg: unknown }).msg);
        return "";
      })
      .filter(Boolean);
    if (parts.length) return parts.join(" ");
  }
  if (detail && typeof detail === "object" && "msg" in detail) {
    return String((detail as { msg: unknown }).msg);
  }
  return fallback;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const { headers: extraHeaders, ...rest } = init ?? {};
  const res = await fetch(`${BASE}/api${path}`, {
    ...rest,
    headers: { "Content-Type": "application/json", ...(extraHeaders ?? {}) },
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(apiErrorMessage(payload, `Request to ${path} failed (${res.status})`));
  }
  return res.json();
}

function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: "POST", body: JSON.stringify(body) });
}

export function listCourses(name?: string, role?: "student" | "teacher") {
  const q = new URLSearchParams();
  if (name) q.set("name", name);
  if (role) q.set("role", role);
  const suffix = q.toString() ? `?${q}` : "";
  return request<{ courses: Course[] }>(`/courses${suffix}`);
}

export function loginAccount(opts: {
  requested_role: "student" | "teacher";
  id_token?: string;
  name?: string;
  email?: string;
  password?: string;
}) {
  const token = typeof opts.id_token === "string" ? opts.id_token.trim() : "";
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return request<LoginResponse>("/auth/login", {
    method: "POST",
    headers,
    body: JSON.stringify({
      requested_role: opts.requested_role,
      ...(token ? { id_token: token } : {}),
      ...(opts.name?.trim() ? { name: opts.name.trim() } : {}),
      ...(opts.email?.trim() ? { email: opts.email.trim() } : {}),
      ...(opts.password ? { password: opts.password } : {}),
    }),
  });
}

export function enrollInCourse(courseId: string, name: string) {
  return post<{ ok: boolean }>(`/courses/${encodeURIComponent(courseId)}/enroll`, { name });
}

export function addCourseStaff(courseId: string, actor: string, name: string) {
  return post<{ ok: boolean; name: string; kind: string }>(`/courses/${encodeURIComponent(courseId)}/staff`, {
    actor,
    name,
    kind: "ta",
  });
}

export function createCourse(body: {
  name: string;
  grading_notes?: string;
  objective?: string;
  team_size_min?: number;
  team_size_max?: number;
  team_count?: number | null;
  focus_skills?: string[];
  skill_labels?: Record<string, string>;
  actor: string;
}) {
  return post<Course>("/courses", body);
}

export function lookupProfile(name: string, courseId?: string) {
  const q = new URLSearchParams({ name });
  if (courseId) q.set("course_id", courseId);
  return request<{
    profile: StructuredProfile | null;
    match: MatchResponse | null;
    rematch_allowed?: boolean;
    concern?: ConcernRecord | null;
  }>(`/profile?${q}`);
}

export interface ChatRequestOpts {
  mode?: "intake" | "update";
  profile?: StructuredProfile;
  focus?: "goal" | "hours" | "availability" | "skills" | "role" | "any";
}

export function sendChat(
  name: string,
  messages: ChatMessage[],
  course: CourseContext,
  opts?: ChatRequestOpts,
) {
  return post<ChatResponse>("/chat", {
    name,
    messages,
    course,
    mode: opts?.mode ?? "intake",
    profile: opts?.profile,
    focus: opts?.focus,
  });
}

export function findMatch(
  profile: StructuredProfile,
  course: CourseContext,
  courseId: string,
  cohortSize = 20,
) {
  return post<MatchResponse>("/match", { profile, course, course_id: courseId, cohort_size: cohortSize });
}

export function submitProfile(profile: StructuredProfile, courseId?: string) {
  const q = courseId ? `?course_id=${encodeURIComponent(courseId)}` : "";
  return post<SubmitResponse>(`/submit${q}`, profile);
}

export function loadRoster(courseId: string, fill = 20, actor?: string) {
  const q = new URLSearchParams({ course_id: courseId, fill: String(fill) });
  if (actor) q.set("actor", actor);
  return request<RosterResponse>(`/roster?${q}`);
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

export function moveStudent(
  profiles: StructuredProfile[],
  teams: TeamResult[],
  personId: string,
  targetTeamId: string,
  course: CourseContext,
  courseId?: string,
  targetTeamIndex?: number,
) {
  return post<OptimizeResponse>("/move", {
    course,
    profiles,
    teams,
    person_id: personId,
    target_team_id: targetTeamId,
    target_team_index: targetTeamIndex,
    course_id: courseId,
  });
}

export function markNotificationsRead(ids: string[]) {
  return post<{ ok: boolean }>("/notifications/read", { ids });
}

export function listNotifications(courseId: string, name: string, role: "student" | "teacher") {
  const q = new URLSearchParams({ course_id: courseId, name, role });
  return request<{ notifications: NotificationRecord[] }>(`/notifications?${q}`);
}

export function raiseConcern(name: string, courseId: string, reason: FlagReason, note = "") {
  return post<ConcernRecord>("/concern", { name, course_id: courseId, reason, note });
}

export function resolveConcern(name: string, courseId: string, status: "approved" | "denied") {
  return post<ConcernRecord>("/concern/resolve", { name, course_id: courseId, status });
}

export function setRematchPermission(name: string, courseId: string, allowed: boolean) {
  return post<{ name: string; course_id: string; allowed: boolean }>("/rematch", {
    name,
    course_id: courseId,
    allowed,
  });
}
