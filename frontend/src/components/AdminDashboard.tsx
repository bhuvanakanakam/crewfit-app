import { useEffect, useMemo, useState } from "react";
import { Plus, Users, X } from "lucide-react";
import { addCourseStaff, loadRoster, moveStudent, optimizeTeams, resolveConcern, setRematchPermission } from "../api";
import {
  FLAG_REASON_LABELS,
  CONFLICT_LABELS,
  GOAL_LABELS,
  ROLE_LABELS,
  courseSkillFields,
  isPendingProfile,
  toCourseContext,
  type ConcernRecord,
  type Course,
  type OptimizeResponse,
  type RosterResponse,
  type StructuredProfile,
} from "../types";
import Chip from "./Chip";
import HoursBar from "./HoursBar";
import Initials from "./Initials";
import PageIntro from "./PageIntro";
import SearchField from "./SearchField";
import StatCard from "./StatCard";
import AvailabilityStrip from "./AvailabilityStrip";
import { SkillBars } from "./WeekCalendar";
import { moveMemberOnTeams, teamPlan, teamPlanHint } from "../lib/teams";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";

interface Props {
  course: Course;
  actor: string;
  canManageStaff?: boolean;
  focusName?: string | null;
  reloadToken?: number;
  deskTab?: "students" | "teams";
}

type Filter = "all" | "flagged" | "open";

function TeamMoveForm({
  teamId,
  members,
  destinations,
  disabled,
  onMove,
}: {
  teamId: string;
  members: { id: string; name: string }[];
  destinations: { id: string; label: string }[];
  disabled: boolean;
  onMove: (personId: string, targetIndex: number) => void;
}) {
  const [personId, setPersonId] = useState(members[0]?.id ?? "");
  const [targetId, setTargetId] = useState(destinations[0]?.id ?? "");

  useEffect(() => {
    if (!members.some((m) => m.id === personId)) setPersonId(members[0]?.id ?? "");
  }, [members, personId]);

  useEffect(() => {
    if (!destinations.some((d) => d.id === targetId)) setTargetId(destinations[0]?.id ?? "");
  }, [destinations, targetId]);

  return (
    <div className="mt-5 space-y-2">
      <p className="text-sm font-semibold">Move a student</p>
      <select
        aria-label={`Student to move from ${teamId}`}
        className="h-11 w-full rounded-xl border bg-background px-4 text-sm font-semibold"
        disabled={disabled || members.length === 0}
        value={personId}
        onChange={(e) => setPersonId(e.target.value)}
      >
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
      <select
        aria-label="Destination team"
        className="h-11 w-full rounded-xl border bg-background px-4 text-sm font-semibold"
        disabled={disabled || destinations.length === 0}
        value={targetId}
        onChange={(e) => setTargetId(e.target.value)}
      >
        {destinations.map((d) => (
          <option key={d.id} value={d.id}>
            {d.label}
          </option>
        ))}
      </select>
      <Button
        className="w-full"
        disabled={disabled || !personId || !targetId}
        onClick={() => onMove(personId, Number(targetId))}
      >
        {disabled ? "Moving…" : "Move to that team"}
      </Button>
    </div>
  );
}

function statusOf(concern: ConcernRecord | null, rematch: boolean, pending: boolean) {
  if (pending) return { label: "Needs chat", tone: "warn" as const };
  if (concern?.status === "open") return { label: FLAG_REASON_LABELS[concern.reason] || "Flagged", tone: "warn" as const };
  if (rematch) return { label: "Rematch", tone: "accent" as const };
  return { label: "Ready", tone: "good" as const };
}

export default function AdminDashboard({
  course,
  actor,
  canManageStaff,
  focusName,
  reloadToken = 0,
  deskTab,
}: Props) {
  const [roster, setRoster] = useState<RosterResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [result, setResult] = useState<OptimizeResponse | null>(null);
  const [busy, setBusy] = useState<"load" | "opt" | "flag" | "move" | "staff" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"students" | "teams">("students");
  const [taOpen, setTaOpen] = useState(false);
  const [taName, setTaName] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const profiles = roster?.profiles ?? [];
  const selected =
    profiles.find((p) => p.id === selectedId) ??
    profiles[0] ??
    ({
      name: "Student",
      goal: "pass",
      hours: 0,
      role: "either",
      skills: { technical: 0, writing: 0, analysis: 0, presentation: 0 },
      id: "",
      bio: "",
      availability: [],
      conflict_mode: "vote",
      confidence: 0,
      clarifying_questions: [],
    } as StructuredProfile);
  const ctx = toCourseContext(course);

  function concernFor(p: StructuredProfile) {
    return roster?.concerns[p.name] ?? null;
  }

  function rematchOn(p: StructuredProfile) {
    const map = roster?.rematch_allowed ?? {};
    return Boolean(map[p.name] || map[p.name.trim().toLowerCase()]);
  }

  const readyProfiles = profiles.filter((p) => !isPendingProfile(p));
  const flagged = profiles.filter((p) => concernFor(p)?.status === "open").length;
  const plan = teamPlan(readyProfiles.length, course.team_size_min, course.team_size_max);
  const planHint = teamPlanHint(readyProfiles.length, course.team_size_min, course.team_size_max);
  const liveAssignment = Boolean(result?.teams.length);
  const assigned = new Set(result?.teams.flatMap((t) => t.members.map((m) => m.name.trim().toLowerCase())) ?? []);
  const placed = readyProfiles.filter((p) => assigned.has(p.name.trim().toLowerCase())).length;
  const unassigned = profiles.filter((p) => !assigned.has(p.name.trim().toLowerCase())).length;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return profiles.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q)) return false;
      const open = concernFor(p)?.status === "open";
      if (filter === "flagged") return open;
      if (filter === "open") return !liveAssignment || !assigned.has(p.name.trim().toLowerCase());
      return true;
    });
  }, [assigned, filter, liveAssignment, profiles, query, result, roster]);

  async function refreshRoster(opts?: { jumpTeams?: boolean; silent?: boolean }) {
    if (!opts?.silent) {
      setBusy("load");
      setError(null);
    }
    try {
      const res = await loadRoster(course.id, 20, actor);
      setRoster(res);
      setSelectedId((cur) => (cur && res.profiles.some((p) => p.id === cur) ? cur : res.profiles[0]?.id ?? null));
      if (res.assignment?.teams.length) {
        setResult(res.assignment);
        if (opts?.jumpTeams) setTab("teams");
      } else if (!opts?.silent) {
        setResult(null);
      }
    } catch (e) {
      if (!opts?.silent) setError(e instanceof Error ? e.message : "Couldn't load the roster.");
    } finally {
      if (!opts?.silent) setBusy(null);
    }
  }

  useEffect(() => {
    setResult(null);
    setTab("students");
    setQuery("");
    setFilter("all");
    void refreshRoster();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course.id]);

  useEffect(() => {
    if (!reloadToken) return;
    void refreshRoster();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadToken]);

  useEffect(() => {
    if (deskTab) setTab(deskTab);
  }, [deskTab]);

  useEffect(() => {
    if (!focusName || !roster) return;
    const hit = roster.profiles.find((p) => p.name.toLowerCase() === focusName.toLowerCase());
    if (hit) {
      setSelectedId(hit.id);
      setTab("students");
    }
  }, [focusName, roster]);

  async function formTeams() {
    if (readyProfiles.length < course.team_size_min) return;
    setBusy("opt");
    setError(null);
    try {
      await optimizeTeams(readyProfiles, ctx, course.id);
      await refreshRoster({ jumpTeams: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't form teams.");
    } finally {
      setBusy(null);
    }
  }

  async function move(personId: string, targetIndex: number) {
    if (!result || !personId || !Number.isFinite(targetIndex)) return;
    const preview = moveMemberOnTeams(
      result.teams,
      personId,
      targetIndex,
      course.team_size_min,
      course.team_size_max,
    );
    if (!preview) {
      setError("Couldn't move that student.");
      return;
    }
    setResult({ ...result, teams: preview.teams });
    setNote(preview.note);
    setError(null);
    setTab("teams");
    setBusy("move");
    try {
      const res = await moveStudent(
        readyProfiles,
        result.teams,
        personId,
        result.teams[targetIndex]?.team_id ?? "",
        ctx,
        course.id,
        targetIndex,
      );
      if (res.teams.length) setResult(res);
      setNote(res.flag_note || preview.note);
      await refreshRoster({ jumpTeams: true, silent: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't move that student.");
    } finally {
      setBusy(null);
    }
  }

  async function decideConcern(p: StructuredProfile, status: "approved" | "denied") {
    setBusy("flag");
    setError(null);
    try {
      await resolveConcern(p.name, course.id, status);
      await refreshRoster();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't update that concern.");
    } finally {
      setBusy(null);
    }
  }

  async function toggleRematch(p: StructuredProfile, allowed: boolean) {
    setBusy("flag");
    setError(null);
    try {
      await setRematchPermission(p.name, course.id, allowed);
      await refreshRoster();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't update rematch permission.");
    } finally {
      setBusy(null);
    }
  }

  async function addTa() {
    const who = taName.trim();
    if (!who || busy) return;
    setBusy("staff");
    setError(null);
    try {
      await addCourseStaff(course.id, actor, who);
      setTaName("");
      setTaOpen(false);
      await refreshRoster();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add that TA.");
    } finally {
      setBusy(null);
    }
  }

  const selectedConcern = profiles.length ? concernFor(selected) : null;
  const skillFields = courseSkillFields(course);
  const topSkills = (p: StructuredProfile) => skillFields.filter((s) => p.skills[s.key] >= 4);

  return (
    <div>
      <div className="flex flex-col justify-between gap-6 xl:flex-row xl:items-end">
        <div>
          <PageIntro
            kicker={course.access === "ta" ? "TA desk" : "Instructor desk"}
            title={course.name}
            body={course.objective || course.grading_notes || "Review the roster, form teams, and keep an eye on fit."}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            {skillFields.map((s) => (
              <Chip key={s.key} tone="accent" size="sm">
                {s.label}
              </Chip>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManageStaff && (
            <Button variant="outline" onClick={() => setTaOpen(true)}>
              <Plus /> Add a TA
            </Button>
          )}
          <Button disabled={busy !== null || readyProfiles.length < course.team_size_min} onClick={() => void formTeams()}>
            <Users /> {busy === "opt" ? "Solving…" : liveAssignment ? "Re-form teams" : "Form teams"}
          </Button>
        </div>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Roster"
          value={profiles.length}
          hint={planHint}
        />
        <StatCard label="Flagged" value={flagged} hint={flagged ? "Need a look" : "None open"} />
        <StatCard
          label="Teams"
          value={liveAssignment ? result?.teams.length ?? 0 : plan.count}
          hint={
            liveAssignment
              ? `${placed} placed · ${result?.teams.length} teams`
              : plan.count
                ? `Will form ${planHint}`
                : "Not enough students yet"
          }
        />
        <StatCard
          label="Unassigned"
          value={unassigned}
          hint={liveAssignment ? (unassigned ? "Left out of a team" : "Everyone is placed") : "Waiting on Form teams"}
        />
      </div>

      {error && <p className="mt-5 rounded-xl bg-warn-soft p-3 text-sm font-semibold text-warn">{error}</p>}
      {note && !error && <p className="mt-5 rounded-xl bg-accent-soft p-3 text-sm font-semibold">{note}</p>}

      <div className="mt-8 flex gap-1 border-b">
        {(["students", "teams"] as const).map((id) => (
          <Button
            key={id}
            variant="ghost"
            className={cn("rounded-none border-b-2 px-5", tab === id ? "border-primary text-primary" : "border-transparent")}
            onClick={() => setTab(id)}
          >
            {id === "students"
              ? `Students · ${profiles.length}`
              : `Teams · ${liveAssignment ? result?.teams.length ?? plan.count : plan.count}`}
          </Button>
        ))}
      </div>

      {tab === "students" && (
        <div className="mt-6 space-y-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <SearchField value={query} onChange={setQuery} placeholder="Search students" />
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["all", "All"],
                  ["flagged", "Flagged"],
                  ["open", "Unassigned"],
                ] as const
              ).map(([id, label]) => (
                <Button key={id} variant={filter === id ? "secondary" : "outline"} onClick={() => setFilter(id)}>
                  {label}
                </Button>
              ))}
            </div>
          </div>

          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
            <div className="overflow-hidden rounded-2xl border bg-card paper-shadow">
              {busy === "load" && !roster ? (
                <p className="p-8 text-base text-foreground">Loading roster…</p>
              ) : profiles.length === 0 ? (
                <p className="p-8 text-base text-foreground">No students on this course yet. Add people or form a course so the demo roster can fill.</p>
              ) : visible.length === 0 ? (
                <p className="p-8 text-base text-foreground">No students match that filter.</p>
              ) : (
                <div className="overflow-x-auto">
                  <div className="flex items-center justify-between border-b px-6 py-3 text-sm text-muted-foreground">
                    <span>
                      Showing <span className="font-semibold text-foreground">{visible.length}</span> of {profiles.length}
                    </span>
                    {query || filter !== "all" ? (
                      <button type="button" className="font-semibold text-primary" onClick={() => { setQuery(""); setFilter("all"); }}>
                        Clear filters
                      </button>
                    ) : null}
                  </div>
                  <table className="w-full min-w-[1080px] text-left">
                    <thead className="bg-muted/70 text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="min-w-[240px] px-6 py-4 font-semibold">Student</th>
                        <th className="min-w-[130px] px-5 py-4 font-semibold">Goal</th>
                        <th className="min-w-[160px] px-5 py-4 font-semibold">Hours</th>
                        <th className="min-w-[130px] px-5 py-4 font-semibold">Role</th>
                        <th className="min-w-[140px] px-5 py-4 font-semibold">Strengths</th>
                        <th className="min-w-[120px] px-6 py-4 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((p) => {
                        const status = statusOf(concernFor(p), rematchOn(p), isPendingProfile(p));
                        return (
                          <tr
                            key={`${p.id}-${p.name}`}
                            className={cn(
                              "cursor-pointer border-t transition-colors hover:bg-accent-soft/60",
                              p.id === selected.id && "bg-accent-soft",
                            )}
                            onClick={() => setSelectedId(p.id)}
                          >
                            <td className="px-6 py-5">
                              <span className="flex items-center gap-3">
                                <Initials name={p.name} />
                                <span className="font-semibold">{p.name}</span>
                              </span>
                            </td>
                            <td className="px-5 py-5">
                              <Chip>{GOAL_LABELS[p.goal]}</Chip>
                            </td>
                            <td className="px-5 py-5">
                              <HoursBar hours={p.hours} />
                            </td>
                            <td className="px-5 py-5 text-sm font-semibold">{ROLE_LABELS[p.role]}</td>
                            <td className="px-5 py-5">
                              <span className="flex flex-wrap gap-1">
                                {topSkills(p).length
                                  ? topSkills(p).map((s) => (
                                      <Chip key={s.key} size="sm">
                                        {s.label}
                                      </Chip>
                                    ))
                                  : <span className="text-sm text-muted-foreground">—</span>}
                              </span>
                            </td>
                            <td className="px-6 py-5">
                              <Chip tone={status.tone}>{status.label}</Chip>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {profiles.length > 0 && (
              <aside className="rounded-2xl border bg-card p-6 paper-shadow xl:sticky xl:top-24">
                <div className="flex items-start gap-4">
                  <Initials name={selected.name} className="size-12 text-sm" />
                  <div className="min-w-0">
                    <div className="kicker">Student detail</div>
                    <h2 className="mt-1 truncate font-display text-2xl font-medium tracking-[-0.03em]">{selected.name}</h2>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {selectedConcern?.status === "open" && (
                        <Chip tone="warn">{FLAG_REASON_LABELS[selectedConcern.reason]}</Chip>
                      )}
                      {rematchOn(selected) && <Chip tone="accent">Rematch</Chip>}
                      <Chip>{liveAssignment && assigned.has(selected.name.trim().toLowerCase()) ? "On a team" : "Unassigned"}</Chip>
                    </div>
                  </div>
                </div>
                <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-5 text-sm">
                  <div>
                    <dt className="text-muted-foreground">Goal</dt>
                    <dd className="mt-1 font-semibold">{GOAL_LABELS[selected.goal]}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Hours</dt>
                    <dd className="mt-1 font-semibold">{selected.hours}/week</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Role</dt>
                    <dd className="mt-1 font-semibold">{ROLE_LABELS[selected.role]}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Conflicts</dt>
                    <dd className="mt-1 font-semibold">{CONFLICT_LABELS[selected.conflict_mode]}</dd>
                  </div>
                </dl>
                <div className="mt-6">
                  <p className="mb-2 text-sm font-semibold">Availability · {selected.availability.length} windows</p>
                  <AvailabilityStrip slots={selected.availability} />
                </div>
                <div className="mt-6">
                  <p className="mb-3 text-sm font-semibold">Skills</p>
                  <SkillBars
                    compact
                    privateView
                    skills={selected.skills}
                    keys={skillFields.map((s) => s.key)}
                    labels={Object.fromEntries(skillFields.map((s) => [s.key, s.label]))}
                  />
                </div>
                {selectedConcern?.status === "open" && (
                  <div className="mt-6 rounded-xl bg-warn-soft p-4">
                    <p className="text-sm font-bold text-warn">{FLAG_REASON_LABELS[selectedConcern.reason]}</p>
                    <p className="mt-1 text-sm leading-relaxed">
                      {selectedConcern.note || "A student asked the instructor to look at this team."}
                    </p>
                    <div className="mt-4 grid gap-2">
                      <Button disabled={busy !== null} onClick={() => void decideConcern(selected, "approved")}>
                        Approve rematch
                      </Button>
                      <Button variant="outline" disabled={busy !== null} onClick={() => void decideConcern(selected, "denied")}>
                        Dismiss
                      </Button>
                    </div>
                  </div>
                )}
                <Button
                  variant="ghost"
                  className="mt-4 w-full"
                  disabled={busy !== null}
                  onClick={() => void toggleRematch(selected, !rematchOn(selected))}
                >
                  {rematchOn(selected) ? "Lock their team" : "Allow rematch later"}
                </Button>
              </aside>
            )}
          </div>
        </div>
      )}

      {tab === "teams" && !liveAssignment && (
        <div className="mt-8 rounded-2xl border bg-card px-8 py-16 text-center paper-shadow">
          <Users className="mx-auto text-primary" />
          <h2 className="mt-4 font-display text-2xl font-medium tracking-[-0.03em]">No teams yet</h2>
          <p className="mt-2 text-muted-foreground">
            {planHint}. Students still in chat stay unassigned until they finish.
          </p>
          <Button className="mt-6" disabled={busy !== null || readyProfiles.length < course.team_size_min} onClick={() => void formTeams()}>
            <Users /> Form teams
          </Button>
        </div>
      )}

      {tab === "teams" && liveAssignment && result && (
        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          {result.teams.map((team, idx) => {
            const scorePct = Math.round(Math.max(0, Math.min(1, team.score)) * 100);
            const peaks = Object.fromEntries(
              skillFields.map((s) => [
                s.key,
                team.skill_peaks?.[s.key] ??
                  Math.max(
                    0,
                    ...team.members.map((m) => {
                      const full = profiles.find((p) => p.id === m.id);
                      return full?.skills[s.key] ?? m.skills?.[s.key] ?? 0;
                    }),
                  ),
              ]),
            );
            return (
              <article key={team.team_id} className="rounded-2xl border bg-card p-6 paper-shadow">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="kicker">Team {String(idx + 1).padStart(2, "0")} · {team.members.length} people</div>
                    <h3 className="mt-1 font-display text-2xl font-medium tracking-[-0.03em]">{scorePct}% fit</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{team.team_goal}</p>
                  </div>
                  <Chip tone={scorePct > 82 ? "good" : "accent"}>{scorePct > 82 ? "Strong" : "Solid"}</Chip>
                </div>
                <ul className="mt-5 space-y-2">
                  {team.members.map((m) => {
                    const full = profiles.find((p) => p.id === m.id);
                    return (
                      <li key={m.id} className="flex items-center justify-between gap-3 rounded-xl bg-muted/70 px-3 py-2">
                        <span className="flex min-w-0 items-center gap-3">
                          <Initials name={m.name} className="size-8" />
                          <span className="min-w-0">
                            <span className="block truncate font-semibold">{m.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {GOAL_LABELS[full?.goal ?? m.goal]} · {ROLE_LABELS[full?.role ?? m.role ?? "either"]}
                            </span>
                          </span>
                        </span>
                        <span className="shrink-0 text-sm font-semibold">{full?.hours ?? m.hours}h</span>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-5 text-sm leading-relaxed text-muted-foreground">{team.rationale}</p>
                <div className="mt-5">
                  <SkillBars
                    compact
                    privateView
                    skills={peaks}
                    coverage={team.coverage}
                    thin={team.thin}
                    keys={skillFields.map((s) => s.key)}
                    labels={Object.fromEntries(skillFields.map((s) => [s.key, s.label]))}
                  />
                </div>
                <TeamMoveForm
                  teamId={team.team_id}
                  members={team.members.map((m) => ({ id: m.id, name: m.name }))}
                  destinations={result.teams
                    .map((other, otherIdx) => ({
                      id: String(otherIdx),
                      label: `Team ${String(otherIdx + 1).padStart(2, "0")} · ${other.members.length} people`,
                    }))
                    .filter((other) => other.id !== String(idx))}
                  disabled={busy === "move"}
                  onMove={(personId, targetIndex) => void move(personId, targetIndex)}
                />
              </article>
            );
          })}
        </div>
      )}

      {taOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/35 p-4" onMouseDown={() => setTaOpen(false)}>
          <section className="w-full max-w-md rounded-2xl border bg-card p-6 paper-shadow" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div>
                <div className="kicker">Course staff</div>
                <h2 className="mt-1 font-display text-2xl font-medium tracking-[-0.03em]">Add a TA</h2>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setTaOpen(false)}>
                <X />
              </Button>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              They only get this course on the teacher desk. Student enrollment here is removed.
            </p>
            <input
              className="mt-5 h-11 w-full rounded-xl bg-background px-4"
              placeholder="Student name or email"
              value={taName}
              onChange={(e) => setTaName(e.target.value)}
            />
            <Button className="mt-4 w-full" disabled={!taName.trim() || busy !== null} onClick={() => void addTa()}>
              {busy === "staff" ? "Adding…" : "Add as TA"}
            </Button>
          </section>
        </div>
      )}
    </div>
  );
}
