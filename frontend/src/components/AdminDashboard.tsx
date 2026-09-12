import { useEffect, useState } from "react";
import { addCourseStaff, flagStudent, loadRoster, optimizeTeams, resolveConcern, setRematchPermission } from "../api";
import {
  BREAKDOWN_LABELS,
  CONFLICT_LABELS,
  FLAG_REASONS,
  GOAL_LABELS,
  ROLE_LABELS,
  FLAG_REASON_LABELS,
  SKILL_FIELDS,
  skillList,
  toCourseContext,
  type Course,
  type FlagReason,
  type OptimizeResponse,
  type RosterResponse,
  type StructuredProfile,
} from "../types";
import AvailCalendar from "./AvailCalendar";

interface Props {
  course: Course;
  actor: string;
  canManageStaff?: boolean;
  focusName?: string | null;
  reloadToken?: number;
}

export default function AdminDashboard({ course, actor, canManageStaff, focusName, reloadToken = 0 }: Props) {
  const [roster, setRoster] = useState<RosterResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [result, setResult] = useState<OptimizeResponse | null>(null);
  const [busy, setBusy] = useState<"load" | "opt" | "flag" | "staff" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"students" | "teams">("students");
  const [taName, setTaName] = useState("");

  const profiles = roster?.profiles ?? [];
  const selected = profiles.find((p) => p.id === selectedId) ?? null;
  const ctx = toCourseContext(course);

  async function refreshRoster(opts?: { jumpTeams?: boolean }) {
    setBusy("load");
    setError(null);
    try {
      const res = await loadRoster(course.id, 16, actor);
      setRoster(res);
      setSelectedId((cur) => (cur && res.profiles.some((p) => p.id === cur) ? cur : res.profiles[0]?.id ?? null));
      setResult(res.assignment ?? null);
      if (opts?.jumpTeams && res.assignment) setTab("teams");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the roster.");
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    setResult(null);
    setTab("students");
    void refreshRoster({ jumpTeams: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course.id]);

  useEffect(() => {
    if (!reloadToken) return;
    void refreshRoster();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadToken]);

  useEffect(() => {
    if (!focusName || !roster) return;
    const hit = roster.profiles.find((p) => p.name.toLowerCase() === focusName.toLowerCase());
    if (hit) {
      setSelectedId(hit.id);
      setTab("students");
    }
  }, [focusName, roster]);

  async function formTeams() {
    if (profiles.length < 4 && !(course.team_size_min <= profiles.length)) return;
    setBusy("opt");
    setError(null);
    try {
      const res = await optimizeTeams(profiles, ctx, course.id);
      setResult(res);
      setTab("teams");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't form teams.");
    } finally {
      setBusy(null);
    }
  }

  async function flag(personId: string, reason: FlagReason) {
    if (!result) return;
    setBusy("flag");
    setError(null);
    try {
      const res = await flagStudent(profiles, result.teams, personId, reason, ctx, course.id);
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't re-optimize.");
    } finally {
      setBusy(null);
    }
  }

  function concernFor(p: StructuredProfile) {
    return roster?.concerns[p.name] ?? null;
  }

  function rematchOn(p: StructuredProfile) {
    const map = roster?.rematch_allowed ?? {};
    return Boolean(map[p.name] || map[p.name.trim().toLowerCase()]);
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
      await refreshRoster();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add that TA.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="admin">
      <div className="page-head">
        <p className="kicker">{course.access === "ta" ? "TA desk" : "Instructor desk"}</p>
        <h1>{course.name}</h1>
        <p className="page-dek">
          Flags, preference changes, and new teams land in the bell. Students never see each other’s private prefs.
        </p>
      </div>
      <div className="admin-toolbar">
        <div>
          <p className="admin-meta">
            {busy === "load" && profiles.length === 0
              ? "Loading…"
              : `${profiles.length} students`}
          </p>
        </div>
        <div className="admin-actions">
          <button className="btn ghost" type="button" disabled={busy !== null} onClick={() => void refreshRoster()}>
            {busy === "load" ? "Loading…" : "Refresh"}
          </button>
          <button
            className="btn primary"
            type="button"
            disabled={busy !== null || profiles.length < course.team_size_min}
            onClick={() => void formTeams()}
          >
            {busy === "opt" ? "Solving…" : "Form teams"}
          </button>
        </div>
      </div>

      {canManageStaff && (
        <form
          className="staff-row"
          onSubmit={(e) => {
            e.preventDefault();
            void addTa();
          }}
        >
          <label htmlFor="ta-name">Add a TA</label>
          <input
            id="ta-name"
            value={taName}
            onChange={(e) => setTaName(e.target.value)}
            placeholder="Student name"
          />
          <button className="btn ghost" type="submit" disabled={!taName.trim() || busy !== null}>
            {busy === "staff" ? "Adding…" : "Add TA"}
          </button>
        </form>
      )}

      {error && <div className="error-banner">{error}</div>}

      <div className="admin-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "students"} className={tab === "students" ? "active" : ""} onClick={() => setTab("students")}>
          Students
        </button>
        <button type="button" role="tab" aria-selected={tab === "teams"} className={tab === "teams" ? "active" : ""} onClick={() => setTab("teams")}>
          Teams{result ? ` · ${result.teams.length}` : ""}
        </button>
      </div>

      {tab === "students" && (
        <div className="admin-split">
          <div className="roster-table-wrap">
            <table className="roster-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Goal</th>
                  <th>Hours</th>
                  <th>Role</th>
                  <th>Skills</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((p) => (
                  <tr key={p.id} className={p.id === selectedId ? "on" : ""} onClick={() => setSelectedId(p.id)}>
                    <td>
                      <strong>{p.name}</strong>
                      {concernFor(p) && (concernFor(p)?.status ?? "open") === "open" && (
                        <span className="live-tag warn">Flagged</span>
                      )}
                      {rematchOn(p) && <span className="live-tag">Rematch</span>}
                    </td>
                    <td>{GOAL_LABELS[p.goal]}</td>
                    <td>{p.hours}</td>
                    <td>{ROLE_LABELS[p.role]}</td>
                    <td className="skill-cell">{SKILL_FIELDS.map((s) => p.skills[s.key]).join(" / ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {selected && (
            <aside className="student-detail" aria-label={`${selected.name} profile`}>
              <h2>{selected.name}</h2>
              {concernFor(selected) && (
                <p className="violations">
                  {FLAG_REASON_LABELS[concernFor(selected)!.reason]}
                  {concernFor(selected)?.note ? `: ${concernFor(selected)?.note}` : ""}
                  {concernFor(selected)?.status && concernFor(selected)?.status !== "open"
                    ? ` · ${concernFor(selected)?.status}`
                    : ""}
                </p>
              )}

              <div className="form-actions">
                {concernFor(selected) && concernFor(selected)?.status !== "approved" && (
                  <button
                    className="btn primary"
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void decideConcern(selected, "approved")}
                  >
                    Approve rematch
                  </button>
                )}
                {concernFor(selected) && (
                  <button
                    className="btn ghost"
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void decideConcern(selected, "denied")}
                  >
                    Dismiss concern
                  </button>
                )}
                <button
                  className="btn ghost"
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void toggleRematch(selected, !rematchOn(selected))}
                >
                  {rematchOn(selected) ? "Lock their team" : "Allow rematch"}
                </button>
              </div>

              <dl className="mini-facts">
                <div>
                  <dt>Goal</dt>
                  <dd>{GOAL_LABELS[selected.goal]}</dd>
                </div>
                <div>
                  <dt>Hours / week</dt>
                  <dd>{selected.hours}</dd>
                </div>
                <div>
                  <dt>Role</dt>
                  <dd>{ROLE_LABELS[selected.role]}</dd>
                </div>
                <div>
                  <dt>Conflicts</dt>
                  <dd>{CONFLICT_LABELS[selected.conflict_mode]}</dd>
                </div>
              </dl>

              <h3>Availability</h3>
              <AvailCalendar slots={selected.availability} compact />

              <h3>Skills</h3>
              <div className="skill-list compact">
                {SKILL_FIELDS.map((s) => (
                  <div className="skill-row" key={s.key}>
                    <div>
                      <strong>{s.label}</strong>
                    </div>
                    <div className="bar" aria-hidden>
                      <i style={{ width: `${(selected.skills[s.key] / 5) * 100}%` }} />
                    </div>
                    <em>{selected.skills[s.key]}</em>
                  </div>
                ))}
              </div>

              {selected.bio && (
                <>
                  <h3>What they said</h3>
                  <p className="bio-block">{selected.bio}</p>
                </>
              )}
            </aside>
          )}
        </div>
      )}

      {tab === "teams" && !result && (
        <p className="page-dek">No teams yet. Form teams, or wait for a student to match.</p>
      )}

      {tab === "teams" && result && (
        <div className="teams-view">
          <div className="baseline-banner">
            <p>
              Average fit {(result.teams.reduce((s, t) => s + t.score, 0) / result.teams.length).toFixed(2)}
              <em>
                {result.improvement_pct >= 0 ? " +" : " "}
                {result.improvement_pct.toFixed(0)}% vs random
              </em>
            </p>
          </div>

          {result.flag_note && <div className="need-box">{result.flag_note}</div>}

          <div className="team-grid">
            {result.teams.map((team, idx) => (
              <article className="team-card" key={team.team_id}>
                <header>
                  <h3>Team {idx + 1}</h3>
                  <span className="score">{team.score.toFixed(2)}</span>
                </header>
                {team.violations > 0 && (
                  <p className="violations">
                    ⚠ {team.violations} schedule conflict{team.violations === 1 ? "" : "s"}
                  </p>
                )}
                <p className="teammate-sub">
                  {team.team_goal}
                  {team.coverage.length > 0 ? ` · covers ${skillList(team.coverage)}` : ""}
                </p>
                <AvailCalendar slots={team.shared_windows} compact />
                <ul>
                  {team.members.map((m) => {
                    const full = profiles.find((p) => p.id === m.id);
                    return (
                      <li key={m.id}>
                        <div>
                          <strong>{m.name}</strong>
                          <span className="teammate-sub">
                            {GOAL_LABELS[m.goal]} · {m.hours}h
                            {full ? ` · ${ROLE_LABELS[full.role]}` : ""}
                          </span>
                        </div>
                        <label className="flag-wrap">
                          <span className="visually-hidden">Flag {m.name}</span>
                          <select
                            disabled={busy !== null}
                            defaultValue=""
                            onChange={(e) => {
                              const value = e.target.value as FlagReason;
                              if (value) void flag(m.id, value);
                              e.target.value = "";
                            }}
                          >
                            <option value="">Move…</option>
                            {FLAG_REASONS.map((r) => (
                              <option key={r.value} value={r.value}>
                                {r.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      </li>
                    );
                  })}
                </ul>
                <div className="bars">
                  {Object.entries(BREAKDOWN_LABELS).map(([key, label]) => {
                    const v = team.breakdown[key] ?? 0;
                    return (
                      <div key={key}>
                        <span>
                          {label} <em>{v.toFixed(2)}</em>
                        </span>
                        <div className="bar">
                          <i style={{ width: `${Math.max(0, Math.min(1, v)) * 100}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="rationale">{team.rationale}</p>
              </article>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
