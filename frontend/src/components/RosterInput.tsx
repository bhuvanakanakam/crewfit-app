import type { PersonInput } from "../types";
import { SAMPLE_ROSTER } from "../sampleData";

interface Props {
  people: PersonInput[];
  onChange: (people: PersonInput[]) => void;
  onBack: () => void;
  onSubmit: () => void;
  loading: boolean;
}

export default function RosterInput({ people, onChange, onBack, onSubmit, loading }: Props) {
  function updatePerson(index: number, field: keyof PersonInput, value: string) {
    const next = people.slice();
    next[index] = { ...next[index], [field]: value };
    onChange(next);
  }

  function addPerson() {
    onChange([...people, { name: "", bio: "" }]);
  }

  function removePerson(index: number) {
    onChange(people.filter((_, i) => i !== index));
  }

  const canSubmit = people.length >= 3 && people.every((p) => p.name.trim() && p.bio.trim());

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Roster</h2>
        <p>One entry per person, written the way they'd actually describe themselves — goals, schedule, skills, hours, all in plain language.</p>
      </div>

      <div className="panel-actions">
        <button className="btn ghost" type="button" onClick={() => onChange(SAMPLE_ROSTER)}>
          Load sample cohort ({SAMPLE_ROSTER.length})
        </button>
        <button className="btn ghost" type="button" onClick={addPerson}>
          + Add person
        </button>
      </div>

      <div className="roster-list">
        {people.map((person, idx) => (
          <div className="roster-row" key={idx}>
            <input
              value={person.name}
              onChange={(e) => updatePerson(idx, "name", e.target.value)}
              placeholder="Name"
            />
            <textarea
              value={person.bio}
              onChange={(e) => updatePerson(idx, "bio", e.target.value)}
              placeholder="I want to turn this into a research paper, free weekday evenings, strong at stats, weak at presenting, about 10 hours a week..."
              rows={2}
            />
            <button className="icon-btn" type="button" onClick={() => removePerson(idx)} title="Remove">
              ✕
            </button>
          </div>
        ))}
        {people.length === 0 && (
          <p className="hint">No one on the roster yet — add people one at a time, or load the sample cohort to try it out.</p>
        )}
      </div>

      <p className="hint">
        Parsing sends each bio to Grok along with the course context above, and comes back with a structured
        profile — if anything's genuinely ambiguous, it comes back with a clarifying question instead of a guess.
      </p>

      <div className="panel-actions">
        <button className="btn ghost" type="button" onClick={onBack}>
          ← Edit course
        </button>
        <button className="btn primary" type="button" disabled={!canSubmit || loading} onClick={onSubmit}>
          {loading ? "Parsing…" : "Parse profiles →"}
        </button>
      </div>
    </section>
  );
}
