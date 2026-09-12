import type { OptimizeResponse, StructuredProfile, TeamResult } from "../types";

export function legalTeamCounts(n: number, minSize: number, maxSize: number) {
  if (n < minSize || minSize < 1 || maxSize < minSize) return [];
  const legal: number[] = [];
  for (let k = 1; k <= n; k += 1) {
    if (k * minSize <= n && n <= k * maxSize) legal.push(k);
  }
  return legal;
}

export function packableCount(n: number, minSize: number, maxSize: number) {
  if (n < minSize || minSize < 1 || maxSize < minSize) return 0;
  for (let m = n; m >= minSize; m -= 1) {
    if (legalTeamCounts(m, minSize, maxSize).length) return m;
  }
  return 0;
}

/** Smallest legal k — same rule as the solver, so teams stay as close to max size as possible. */
export function plannedTeamCount(n: number, minSize: number, maxSize: number, _forced?: number | null) {
  const placed = packableCount(n, minSize, maxSize);
  const legal = legalTeamCounts(placed, minSize, maxSize);
  return legal[0] ?? 0;
}

export function plannedSizes(n: number, minSize: number, maxSize: number, _forced?: number | null) {
  const placed = packableCount(n, minSize, maxSize);
  const k = plannedTeamCount(placed, minSize, maxSize);
  if (!k) return [];
  const base = Math.floor(placed / k);
  const extra = placed % k;
  return Array.from({ length: k }, (_, i) => base + (i < extra ? 1 : 0));
}

export function teamPlan(n: number, minSize: number, maxSize: number, _forced?: number | null) {
  const sizes = plannedSizes(n, minSize, maxSize);
  const placed = sizes.reduce((sum, size) => sum + size, 0);
  return {
    count: sizes.length,
    sizes,
    placed,
    leftover: Math.max(0, n - placed),
  };
}

export function teamPlanHint(n: number, minSize: number, maxSize: number, _forced?: number | null) {
  if (n < minSize) return `Need at least ${minSize} students to form a team.`;
  const plan = teamPlan(n, minSize, maxSize);
  if (!plan.count) {
    return `No legal split for ${n} students with teams of ${minSize}–${maxSize}.`;
  }
  const unique = [...new Set(plan.sizes)];
  const shape = unique.length === 1 ? `${unique[0]} each` : plan.sizes.join(" + ");
  const core = `${plan.count} teams · ${shape}`;
  return plan.leftover ? `${core} · ${plan.leftover} waiting` : core;
}

export function assignmentNames(result: OptimizeResponse | TeamResult[] | null | undefined) {
  const teams = Array.isArray(result) ? result : result?.teams ?? [];
  return new Set(teams.flatMap((team) => team.members.map((m) => m.name.trim().toLowerCase())));
}

export function moveMemberOnTeams(
  teams: TeamResult[],
  personId: string,
  targetIndex: number,
  minSize: number,
  maxSize: number,
) {
  if (targetIndex < 0 || targetIndex >= teams.length) return null;
  const next = teams.map((team) => ({ ...team, members: [...team.members] }));
  const srcIndex = next.findIndex((team) => team.members.some((m) => m.id === personId));
  if (srcIndex < 0) return null;
  if (srcIndex === targetIndex) return { teams: next, note: "That student is already on that team." };
  const src = next[srcIndex];
  const dest = next[targetIndex];
  const person = src.members.find((m) => m.id === personId);
  if (!person) return null;
  const destLabel = `Team ${String(targetIndex + 1).padStart(2, "0")}`;
  if (dest.members.length < maxSize && src.members.length > minSize) {
    src.members = src.members.filter((m) => m.id !== personId);
    dest.members = [...dest.members, person];
    return { teams: next, note: `Moved ${person.name} to ${destLabel}.` };
  }
  const other = dest.members[0];
  if (!other) return null;
  src.members = src.members.map((m) => (m.id === personId ? other : m));
  dest.members = dest.members.map((m) => (m.id === other.id ? person : m));
  return { teams: next, note: `Moved ${person.name} to ${destLabel} (swapped with ${other.name}).` };
}

export function assignmentCoversRoster(
  result: OptimizeResponse | null | undefined,
  profiles: StructuredProfile[],
) {
  if (!result?.teams.length || !profiles.length) return false;
  const names = assignmentNames(result);
  if (names.size !== profiles.length) return false;
  return profiles.every((p) => names.has(p.name.trim().toLowerCase()));
}
