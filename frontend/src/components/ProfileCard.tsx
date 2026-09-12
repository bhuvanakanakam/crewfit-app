import {
  GOAL_LABELS,
  ROLE_LABELS,
  SKILL_FIELDS,
  type StructuredProfile,
} from "../types";
import AvailCalendar from "./AvailCalendar";

interface Props {
  profile: StructuredProfile;
  compact?: boolean;
  onToggleAvail?: (slot: string) => void;
}

export default function ProfileCard({ profile, compact, onToggleAvail }: Props) {
  return (
    <div className={`pref-card${compact ? " compact" : ""}`}>
      <dl className="pref-grid">
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

      <div className="pref-block">
        <h3>Availability</h3>
        <AvailCalendar slots={profile.availability} compact={compact} onToggle={onToggleAvail} />
      </div>

      <div className="pref-block">
        <h3>Skills</h3>
        <ul className="pref-skills">
          {SKILL_FIELDS.map((s) => (
            <li key={s.key}>
              <span>{s.label}</span>
              <span className="pref-skill-bar" aria-hidden>
                <i style={{ width: `${(profile.skills[s.key] / 5) * 100}%` }} />
              </span>
              <em>{profile.skills[s.key]}/5</em>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
