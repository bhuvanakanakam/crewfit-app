import type { OptimizeResponse, StructuredProfile, TeamResult } from "../types";

export function legalTeamCounts(n: number, minSize: number, maxSize: number) {
  if (n < minSize || minSize < 1 || maxSize < minSize) return [];
  const legal: number[] = [];
  for (let k = 1; k <= n; k += 1) {
    if (k * minSize <= n && n <= k * maxSize) legal.push(k);
  }
  return legal;
}

/** Smallest legal k — same rule as the solver, so teams stay as close to max size as possible. */
export function plannedTeamCount(n: number, minSize: number, maxSize: number, forced?: number | null) {
  const legal = legalTeamCounts(n, minSize, maxSize);
  if (!legal.length) return 0;
  if (forced && legal.includes(forced)) return forced;
  return legal[0];
}

export function plannedSizes(n: number, minSize: number, maxSize: number, forced?: number | null) {
  const k = plannedTeamCount(n, minSize, maxSize, forced);
  if (!k) return [];
  const base = Math.floor(n / k);
  const extra = n % k;
  return Array.from({ length: k }, (_, i) => base + (i < extra ? 1 : 0));
}

export function teamPlan(n: number, minSize: number, maxSize: number, forced?: number | null) {
  const sizes = plannedSizes(n, minSize, maxSize, forced);
  const placed = sizes.reduce((sum, size) => sum + size, 0);
  return {
    count: sizes.length,
    sizes,
    placed,
    leftover: Math.max(0, n - placed),
  };
}

export function teamPlanHint(n: number, minSize: number, maxSize: number, forced?: number | null) {
  if (n < minSize) return `Need at least ${minSize} students to form a team.`;
  const plan = teamPlan(n, minSize, maxSize, forced);
  if (!plan.count) {
    return forced
      ? `Can't make ${forced} teams from ${n} students with teams of ${minSize}–${maxSize}.`
      : `No legal split for ${n} students with teams of ${minSize}–${maxSize}.`;
  }
  const unique = [...new Set(plan.sizes)];
  const shape = unique.length === 1 ? `${unique[0]} each` : plan.sizes.join(" + ");
  return `${plan.count} teams · ${shape}`;
}

export function assignmentNames(result: OptimizeResponse | TeamResult[] | null | undefined) {
  const teams = Array.isArray(result) ? result : result?.teams ?? [];
  return new Set(teams.flatMap((team) => team.members.map((m) => m.name.trim().toLowerCase())));
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
