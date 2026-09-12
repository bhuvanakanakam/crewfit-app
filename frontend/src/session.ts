import type { MatchResponse, StructuredProfile } from "./types";

export type Role = "student" | "teacher";

export interface Session {
  name: string;
  role: Role;
  courseId: string | null;
}

const SESSION_KEY = "crewfit.session.v1";
const PROFILE_KEY = "crewfit.profile.v1";
const MATCHES_KEY = "crewfit.matches.v1";

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    if (!parsed.name?.trim() || (parsed.role !== "student" && parsed.role !== "teacher")) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSession(session: Session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

export function loadProfile(): StructuredProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? (JSON.parse(raw) as StructuredProfile) : null;
  } catch {
    return null;
  }
}

export function saveProfile(profile: StructuredProfile) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

function personKey(name: string) {
  return name.trim().toLowerCase();
}

export function loadMatches(name?: string): Record<string, MatchResponse> {
  try {
    const raw = localStorage.getItem(MATCHES_KEY);
    const all = raw ? (JSON.parse(raw) as Record<string, Record<string, MatchResponse> | MatchResponse>) : {};
    if (!name) return {};
    const mine = all[personKey(name)];
    if (mine && typeof mine === "object" && !("team" in mine)) {
      return mine as Record<string, MatchResponse>;
    }
    return {};
  } catch {
    return {};
  }
}

export function saveMatch(name: string, courseId: string, match: MatchResponse) {
  try {
    const raw = localStorage.getItem(MATCHES_KEY);
    const all = raw ? JSON.parse(raw) as Record<string, Record<string, MatchResponse>> : {};
    const key = personKey(name);
    all[key] = { ...(all[key] ?? {}), [courseId]: match };
    localStorage.setItem(MATCHES_KEY, JSON.stringify(all));
  } catch {
    /* ignore quota */
  }
}

export function profileFor(name: string): StructuredProfile | null {
  const stored = loadProfile();
  if (!stored) return null;
  return stored.name.trim().toLowerCase() === name.trim().toLowerCase() ? stored : null;
}
