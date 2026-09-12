import { useEffect, useMemo, useState } from "react";
import { flagStudent, loadRoster, optimizeTeams } from "../api";
import {
  BREAKDOWN_LABELS,
  CONFLICT_LABELS,
  FLAG_REASONS,
  GOAL_LABELS,
  ROLE_LABELS,
  SKILL_FIELDS,
  formatSlot,
  isLiveStudent,
  skillList,
  toCourseContext,
  type Course,
  type FlagReason,
  type OptimizeResponse,
  type RosterResponse,
  type StructuredProfile,
} from "../types";

interface Props {
  course: Course;
}

export default function AdminDashboard({ course }: Props) {
  const [roster, setRoster] = useState<RosterResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [result, setResult] = useState<OptimizeResponse | null>(null);
  const [busy, setBusy] = useState<"load" | "opt" | "flag" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"students" | "teams">("students");

  const profiles = roster?.profiles ?? [];
  const selected = profiles.find((p) => p.id === selectedId) ?? null;
  const liveCount = useMemo(() => profiles.filter((p) => isLiveStudent(p.id)).length, [profiles]);
  const ctx = toCourseContext(course);

  async function refreshRoster() {
    setBusy("load");
    setError(null);
    try {
      const res = await loadRoster(course.id, 16);
      setRoster(res);
      setSelectedId((cur) => (cur && res.profiles.some((p) => p.id === cur) ? cur : res.profiles[0]?.id ?? null));
      setResult(res.assignment ?? null);
      if (res.assignment) setTab("teams");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the roster.");
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    setResult(null);
    setTab("students");
    void refreshRoster();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course.id]);

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

  return (
    <div className="admin">
      <div className="admin-toolbar">
        <div>
          <p className="admin-meta">
            {busy === "load" && profiles.length === 0
              ? "Loading class…"
              : `${profiles.length} students${liveCount > 0 ? ` · ${liveCount} enrolled` : " · sample fill"}`}
          </p>
          <p className="field-help">
            Enrolled students keep one working-style profile across courses. Sample classmates fill
            the rest of this section. Teams here are the same assignment each student sees.
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
                      {isLiveStudent(p.id) && <span className="live-tag">Enrolled</span>}
                      {concernFor(p) && <span className="live-tag warn">Flagged</span>}
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
              <p className="teammate-sub">
                {isLiveStudent(selected.id) ? "Enrolled — same profile across courses" : "Sample classmate"} ·
                confidence {Math.round(selected.confidence * 100)}%
              </p>

              {concernFor(selected) && (
                <p className="violations">
                  Flagged: {concernFor(selected)?.reason}
                  {concernFor(selected)?.note ? ` — ${concernFor(selected)?.note}` : ""}
                </p>
              )}

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
              <div className="slot-chips">
                {selected.availability.map((s) => (
                  <span key={s}>{formatSlot(s)}</span>
                ))}
              </div>

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
        <p className="page-dek">
          No official teams yet. Form teams here, or have a student find a team — both write the same
          assignment.
        </p>
      )}

      {tab === "teams" && result && (
        <div className="teams-view">
          <div className="baseline-banner">
            <strong>CrewFit vs random</strong>
            <p>
              Optimized{" "}
              {(result.teams.reduce((s, t) => s + t.score, 0) / result.teams.length).toFixed(2)} ·
              random {result.baseline_score.toFixed(2)} ·{" "}
              <em>
                {result.improvement_pct >= 0 ? "+" : ""}
                {result.improvement_pct.toFixed(1)}%
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
                  {team.shared_windows.length > 0
                    ? ` · ${team.shared_windows.map(formatSlot).join(", ")}`
                    : " · no shared window"}
                  {team.coverage.length > 0 ? ` · covers ${skillList(team.coverage)}` : ""}
                </p>
                <ul>
                  {team.members.map((m) => {
                    const full = profiles.find((p) => p.id === m.id);
                    return (
                      <li key={m.id}>
                        <div>
                          <strong>{m.name}</strong>
                          {full && isLiveStudent(full.id) && <span className="live-tag">Enrolled</span>}
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
                            <option value="">Flag…</option>
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
