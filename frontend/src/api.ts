import type { CourseContext, MatchResponse, StructuredProfile } from "./types";

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

export function findMatch(profile: StructuredProfile, course: CourseContext, cohortSize = 16) {
  return post<MatchResponse>("/match", { profile, course, cohort_size: cohortSize });
}
