import { useState } from "react";
import type { GoalType, Role, ConflictMode, Slot, StructuredProfile } from "../types";
import { GOAL_LABEL, ROLE_LABEL, CONFLICT_LABEL, SLOT_LABEL } from "../types";

interface Props {
  profiles: StructuredProfile[];
  onChange: (profiles: StructuredProfile[]) => void;
  onResolveClarifications: (profileId: string, answers: { question: string; answer: string }[]) => Promise<void>;
  onBack: () => void;
  onSubmit: () => void;
  loading: boolean;
}

const GOALS: GoalType[] = ["pass", "grade_A", "research", "deep_mastery"];
const ROLES: Role[] = ["lead", "contributor", "either"];
const CONFLICTS: ConflictMode[] = ["vote", "rotate_lead", "escalate", "defer_to_invested"];
const SLOTS: Slot[] = ["weekday_morning", "weekday_afternoon", "weekday_evening", "weekend"];

export default function ProfileReview({ profiles, onChange, onResolveClarifications, onBack, onSubmit, loading }: Props) {
  const [drafts, setDrafts] = useState<Record<string, string[]>>({});
  const [resolving, setResolving] = useState<string | null>(null);

  function updateProfile(id: string, patch: Partial<StructuredProfile>) {
    onChange(profiles.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  function updateSkill(id: string, key: keyof StructuredProfile["skills"], value: number) {
    const profile = profiles.find((p) => p.id === id);
    if (!profile) return;
    updateProfile(id, { skills: { ...profile.skills, [key]: Math.max(1, Math.min(5, value)) } });
  }

  function setDraftAnswer(profileId: string, qIndex: number, value: string) {
    setDrafts((prev) => {
      const existing = prev[profileId] ?? [];
      const next = existing.slice();
      next[qIndex] = value;
      return { ...prev, [profileId]: next };
    });
  }

  async function submitAnswers(profile: StructuredProfile) {
    const answers = (drafts[profile.id] ?? []).map((answer, i) => ({ question: profile.clarifying_questions[i], answer: answer ?? "" }))
      .filter((a) => a.answer.trim().length > 0);
    if (answers.length === 0) return;
    setResolving(profile.id);
    try {
      await onResolveClarifications(profile.id, answers);
    } finally {
      setResolving(null);
    }
  }

  const pendingCount = profiles.filter((p) => p.clarifying_questions.length > 0).length;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Structured profiles</h2>
        <p>
          {pendingCount > 0
            ? `Grok flagged ${pendingCount} ${pendingCount === 1 ? "profile" : "profiles"} as ambiguous — answer inline, or just edit the field directly below.`
            : "Everything parsed with reasonable confidence. Review and correct anything before optimizing."}
        </p>
      </div>

      <div className="clarify-list">
        {profiles.filter((p) => p.clarifying_questions.length > 0).map((p) => (
          <div className="clarify-card" key={p.id}>
            <h4>{p.name} — needs a quick answer</h4>
            {p.clarifying_questions.map((q, i) => (
              <div className="clarify-question" key={i}>
                <p>{q}</p>
                <input
                  value={drafts[p.id]?.[i] ?? ""}
                  onChange={(e) => setDraftAnswer(p.id, i, e.target.value)}
                  placeholder="Type an answer…"
                />
              </div>
            ))}
            <div className="panel-actions">
              <button className="btn small primary" type="button" disabled={resolving === p.id} onClick={() => submitAnswers(p)}>
                {resolving === p.id ? "Resolving…" : "Resolve →"}
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="table-wrap">
        <table className="profile-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Confidence</th>
              <th>Goal</th>
              <th>Availability</th>
              <th>Tech</th>
              <th>Write</th>
              <th>Analysis</th>
              <th>Present</th>
              <th>Hrs/wk</th>
              <th>Role</th>
              <th>Conflict mode</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((p) => (
              <tr key={p.id}>
                <td className="name-cell">{p.name}</td>
                <td>
                  <span className={`confidence-pill${p.confidence < 0.7 ? " low" : ""}`}>{Math.round(p.confidence * 100)}%</span>
                </td>
                <td>
                  <select value={p.goal} onChange={(e) => updateProfile(p.id, { goal: e.target.value as GoalType })}>
                    {GOALS.map((g) => (
                      <option key={g} value={g}>{GOAL_LABEL[g]}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    value={p.availability[0] ?? "weekday_evening"}
                    onChange={(e) => updateProfile(p.id, { availability: [e.target.value as Slot] })}
                  >
                    {SLOTS.map((s) => (
                      <option key={s} value={s}>{SLOT_LABEL[s]}</option>
                    ))}
                  </select>
                </td>
                {(["technical", "writing", "analysis", "presentation"] as const).map((cat) => (
                  <td key={cat}>
                    <input
                      type="number"
                      min={1}
                      max={5}
                      value={p.skills[cat]}
                      onChange={(e) => updateSkill(p.id, cat, Number(e.target.value))}
                    />
                  </td>
                ))}
                <td>
                  <input
                    type="number"
                    min={1}
                    max={40}
                    value={p.hours}
                    onChange={(e) => updateProfile(p.id, { hours: Number(e.target.value) })}
                  />
                </td>
                <td>
                  <select value={p.role} onChange={(e) => updateProfile(p.id, { role: e.target.value as Role })}>
                    {ROLES.map((r) => (
                      <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <select value={p.conflict_mode} onChange={(e) => updateProfile(p.id, { conflict_mode: e.target.value as ConflictMode })}>
                    {CONFLICTS.map((c) => (
                      <option key={c} value={c}>{CONFLICT_LABEL[c]}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel-actions">
        <button className="btn ghost" type="button" onClick={onBack}>
          ← Edit roster
        </button>
        <button className="btn primary" type="button" disabled={loading} onClick={onSubmit}>
          {loading ? "Optimizing…" : "Optimize teams →"}
        </button>
      </div>
    </section>
  );
}
