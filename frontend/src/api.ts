import type {
  CourseContext,
  OptimizeResponse,
  PersonInput,
  StructuredProfile,
  FlagReason,
} from "./types";

// In dev, Vite proxies /api to the FastAPI backend (see vite.config.ts).
// In production, set VITE_API_BASE to your deployed backend URL.
const BASE = import.meta.env.VITE_API_BASE ?? "";

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail ?? `Request to ${path} failed (${res.status})`);
  }
  return res.json();
}

export function parseProfiles(course: CourseContext, people: PersonInput[]) {
  return post<{ profiles: StructuredProfile[] }>("/parse", { course, people });
}

export interface ClarifyAnswer {
  profile_id: string;
  question: string;
  answer: string;
}

export function clarifyProfiles(course: CourseContext, profiles: StructuredProfile[], answers: ClarifyAnswer[]) {
  return post<{ profiles: StructuredProfile[] }>("/clarify", { course, profiles, answers });
}

export function optimizeTeams(course: CourseContext, profiles: StructuredProfile[], vetoes: [string, string][] = []) {
  return post<OptimizeResponse>("/optimize", { course, profiles, vetoes });
}

export function flagTeammate(
  course: CourseContext,
  profiles: StructuredProfile[],
  teams: OptimizeResponse["teams"],
  personId: string,
  reason: FlagReason
) {
  return post<OptimizeResponse>("/flag", { course, profiles, teams, person_id: personId, reason });
}
