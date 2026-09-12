import { useState } from "react";
import type { FlagReason, OptimizeResponse, TeamResult } from "../types";
import { GOAL_LABEL } from "../types";

interface Props {
  results: OptimizeResponse;
  onFlag: (personId: string, reason: FlagReason) => Promise<void>;
  onBack: () => void;
}

const REASONS: { key: FlagReason; label: string }[] = [
  { key: "schedule", label: "Schedule" },
  { key: "goal", label: "Goal mismatch" },
  { key: "workload", label: "Workload" },
  { key: "other", label: "Other" },
];

function fmt(x: number) {
  return Math.round(x * 100);
}

export default function TeamResultsView({ results, onFlag, onBack }: Props) {
  const [flaggedRow, setFlaggedRow] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const optimizedAvg = results.teams.length ? results.teams.reduce((sum, t) => sum + t.score, 0) / results.teams.length : 0;

  async function handleReason(personId: string, reason: FlagReason) {
    setBusy(true);
    try {
      await onFlag(personId, reason);
    } finally {
      setBusy(false);
      setFlaggedRow(null);
    }
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Teams</h2>
        <p>Greedy assignment solved with OR-Tools CP-SAT, scored on goal alignment, schedule overlap, skill coverage, and workload fit.</p>
      </div>

      <div className="compare-row">
        <div className="stat-tile good">
          <span className="stat-label">CrewFit score</span>
          <span className="stat-value">{fmt(optimizedAvg)}</span>
        </div>
        <div className="stat-tile">
          <span className="stat-label">Random baseline</span>
          <span className="stat-value">{fmt(results.baseline_score)}</span>
        </div>
        <div className="stat-tile">
          <span className="stat-label">Improvement</span>
          <span className="stat-value">
            {results.improvement_pct >= 0 ? "+" : ""}
            {Math.round(results.improvement_pct)}%
          </span>
          <span className="stat-sub">vs. randomly grouping the same roster</span>
        </div>
      </div>

      <div className="teams-grid">
        {results.teams.map((team) => (
          <TeamCard
            key={team.team_id}
            team={team}
            flaggedRow={flaggedRow}
            setFlaggedRow={setFlaggedRow}
            onReason={handleReason}
            busy={busy}
          />
        ))}
      </div>

      <div className="panel-actions">
        <button className="btn ghost" type="button" onClick={onBack}>
          ← Back to profiles
        </button>
      </div>
    </section>
  );
}

function TeamCard({
  team,
  flaggedRow,
  setFlaggedRow,
  onReason,
  busy,
}: {
  team: TeamResult;
  flaggedRow: string | null;
  setFlaggedRow: (id: string | null) => void;
  onReason: (personId: string, reason: FlagReason) => void;
  busy: boolean;
}) {
  const bd = team.breakdown;
  return (
    <div className="team-card">
      <div className="team-card-head">
        <h3>{team.team_id.replace("team-", "Team ")}</h3>
        <span className={`team-score${team.violations === 0 ? " clean" : ""}`}>
          {fmt(team.score)}
          {team.violations > 0 ? ` · ${team.violations} conflict${team.violations > 1 ? "s" : ""}` : ""}
        </span>
      </div>

      {team.members.map((m) => (
        <div className={`member-row${flaggedRow === m.id ? " flagged" : ""}`} key={m.id}>
          <div>
            <div>{m.name}</div>
            <div className="member-meta">
              {GOAL_LABEL[m.goal]} · {m.hours}h/wk
            </div>
          </div>
          <button
            className="flag-btn"
            type="button"
            title="Flag: doesn't want this team"
            onClick={() => setFlaggedRow(flaggedRow === m.id ? null : m.id)}
          >
            ⚑
          </button>
          {flaggedRow === m.id && (
            <div className="reason-chips">
              {REASONS.map((r) => (
                <button key={r.key} className="chip" type="button" disabled={busy} onClick={() => onReason(m.id, r.key)}>
                  {r.label}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}

      <div className="breakdown">
        {(
          [
            ["Goal", bd.goal],
            ["Avail.", bd.avail],
            ["Skill", bd.skill],
            ["Workload", bd.workload],
          ] as const
        ).map(([label, value]) => (
          <div className="bd-row" key={label}>
            <span>{label}</span>
            <div className="bd-track">
              <div className="bd-fill" style={{ width: `${Math.max(0, Math.round(value * 100))}%` }} />
            </div>
            <span>{fmt(value)}</span>
          </div>
        ))}
      </div>

      <div className="rationale">{team.rationale}</div>

      {team.violations > 0 && (
        <span className="violation-tag">⚠ {team.violations} pair{team.violations > 1 ? "s" : ""} with no real schedule overlap</span>
      )}
    </div>
  );
}
