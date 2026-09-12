import { GOAL_LABELS, ROLE_LABELS, SKILL_FIELDS, formatSlot, type Course, type StructuredProfile } from "../types";

interface Props {
  profile: StructuredProfile;
  course: Course;
  onMatch: () => void;
  onUpdate: () => void;
  onViewTeam?: () => void;
  hasTeam?: boolean;
  matching?: boolean;
}

export default function SavedStyle({
  profile,
  course,
  onMatch,
  onUpdate,
  onViewTeam,
  hasTeam,
  matching,
}: Props) {
  return (
    <div className="saved-style">
      <p className="kicker">{course.name}</p>
      <h1>Your working style</h1>
      <p className="page-dek">
        {hasTeam
          ? `You’re already on a team in ${course.name}. This is the profile we used — no need to chat again.`
          : `We’ll reuse this for ${course.name}. Chat only if you want to change it.`}
      </p>

      <dl className="mini-facts">
        <div>
          <dt>Goal</dt>
          <dd>{GOAL_LABELS[profile.goal]}</dd>
        </div>
        <div>
          <dt>Hours / week</dt>
          <dd>{profile.hours}</dd>
        </div>
        <div>
          <dt>On a team</dt>
          <dd>{ROLE_LABELS[profile.role]}</dd>
        </div>
      </dl>
      <p className="avail-preview">{profile.availability.map(formatSlot).join(" · ")}</p>
      <div className="skill-pills">
        {SKILL_FIELDS.map((s) => (
          <span key={s.key}>
            {s.label} {profile.skills[s.key]}
          </span>
        ))}
      </div>

      <div className="form-actions">
        {hasTeam ? (
          <button className="btn primary" type="button" onClick={onViewTeam}>
            Back to your team
          </button>
        ) : (
          <button className="btn primary" type="button" disabled={matching} onClick={onMatch}>
            {matching ? "Finding your team…" : `Find my team in ${course.name}`}
          </button>
        )}
        <button className="btn ghost" type="button" disabled={matching} onClick={onUpdate}>
          Redo intake chat
        </button>
      </div>
    </div>
  );
}
