import { useMemo, useState } from "react";
import {
  DAYS,
  GOAL_OPTIONS,
  SKILL_FIELDS,
  TIMES,
  type GoalType,
  type Skills,
  type StructuredProfile,
} from "../types";

interface Props {
  onSubmit: (profile: StructuredProfile) => void;
}

function slotId(day: string, time: string) {
  return `${day}_${time}`;
}

export default function IntakeForm({ onSubmit }: Props) {
  const [name, setName] = useState("");
  const [goal, setGoal] = useState<GoalType>("grade_A");
  const [hours, setHours] = useState(8);
  const [slots, setSlots] = useState<Set<string>>(() => new Set(["wed_evening", "thu_evening"]));
  const [skills, setSkills] = useState<Skills>({
    technical: 3,
    writing: 3,
    analysis: 3,
    presentation: 3,
  });
  const [note, setNote] = useState("");

  const canSubmit = name.trim().length > 0 && slots.size > 0;

  const selectedCount = slots.size;

  const preview = useMemo(() => {
    return DAYS.flatMap((d) =>
      TIMES.filter((t) => slots.has(slotId(d.id, t.id))).map(
        (t) => `${d.label} ${t.label.toLowerCase()} (${t.hint})`
      )
    );
  }, [slots]);

  function toggleSlot(day: string, time: string) {
    const id = slotId(day, time);
    setSlots((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submit() {
    if (!canSubmit) return;
    const trimmed = name.trim();
    onSubmit({
      id: "you",
      name: trimmed,
      bio: note.trim() || `Intake form for ${trimmed}`,
      goal,
      availability: Array.from(slots).sort(),
      skills,
      hours,
      role: "either",
      conflict_mode: "vote",
      confidence: 1,
      clarifying_questions: [],
    });
  }

  return (
    <div className="intake">
      <div className="need-box">
        <h2>What we need from you</h2>
        <p className="need-lead">About one minute. Four fields — then we match you.</p>
        <ol>
          <li>
            <strong>Goal</strong> — pass, grade A, research, or deep mastery
          </li>
          <li>
            <strong>Availability</strong> — specific days × morning / afternoon / evening
          </li>
          <li>
            <strong>Hours / week</strong> — how much time you can put in
          </li>
          <li>
            <strong>Skills (1–5)</strong> — Technical, Writing, Analysis, Presentation
          </li>
        </ol>
        <p className="need-note">Teammates never see your answers — only who they’re matched with.</p>
      </div>

      <div className="form-block">
        <label htmlFor="name">First name</label>
        <input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Alex"
          autoFocus
        />
      </div>

      <fieldset className="form-block">
        <legend>Project goal</legend>
        <div className="chip-grid">
          {GOAL_OPTIONS.map((g) => (
            <button
              key={g.value}
              type="button"
              className={`choice${goal === g.value ? " on" : ""}`}
              onClick={() => setGoal(g.value)}
            >
              <span className="choice-title">{g.label}</span>
              <span className="choice-hint">{g.hint}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="form-block">
        <legend>
          Availability <span className="legend-meta">{selectedCount} window{selectedCount === 1 ? "" : "s"} selected</span>
        </legend>
        <p className="field-help">
          Tap every day–time you can meet. Morning 9am–12pm · Afternoon 12–5pm · Evening 5–9pm.
        </p>
        <div className="avail-grid" role="group" aria-label="Availability grid">
          <div className="avail-corner" />
          {TIMES.map((t) => (
            <div key={t.id} className="avail-colhead">
              <span>{t.label}</span>
              <small>{t.hint}</small>
            </div>
          ))}
          {DAYS.map((d) => (
            <div className="avail-row" key={d.id}>
              <div className="avail-day">{d.label}</div>
              {TIMES.map((t) => {
                const id = slotId(d.id, t.id);
                const on = slots.has(id);
                return (
                  <button
                    key={id}
                    type="button"
                    className={`avail-cell${on ? " on" : ""}`}
                    aria-pressed={on}
                    aria-label={`${d.label} ${t.label}`}
                    onClick={() => toggleSlot(d.id, t.id)}
                  >
                    {on ? "✓" : ""}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        {preview.length > 0 && (
          <p className="avail-preview">{preview.slice(0, 6).join(" · ")}{preview.length > 6 ? "…" : ""}</p>
        )}
      </fieldset>

      <div className="form-block">
        <label htmlFor="hours">Hours per week you can commit</label>
        <input
          id="hours"
          type="number"
          min={1}
          max={40}
          value={hours}
          onChange={(e) => setHours(Math.max(1, Math.min(40, Number(e.target.value) || 1)))}
        />
      </div>

      <fieldset className="form-block">
        <legend>Skills (1 = weak · 5 = strong)</legend>
        <p className="field-help">Rate yourself in each project skill — these are the four we match on.</p>
        <div className="skill-list">
          {SKILL_FIELDS.map((s) => (
            <div className="skill-row" key={s.key}>
              <div>
                <strong>{s.label}</strong>
                <span>{s.hint}</span>
              </div>
              <input
                type="range"
                min={1}
                max={5}
                step={1}
                value={skills[s.key]}
                onChange={(e) => setSkills({ ...skills, [s.key]: Number(e.target.value) })}
                aria-label={`${s.label} skill rating`}
              />
              <em>{skills[s.key]}</em>
            </div>
          ))}
        </div>
      </fieldset>

      <div className="form-block">
        <label htmlFor="note">Anything else? (optional)</label>
        <textarea
          id="note"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Prefer to lead demos, or already teamed with someone before…"
        />
      </div>

      <div className="form-actions">
        <button className="btn primary" type="button" disabled={!canSubmit} onClick={submit}>
          Find my team →
        </button>
      </div>
    </div>
  );
}
