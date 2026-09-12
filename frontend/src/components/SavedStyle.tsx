import type { Course, MatchResponse, StructuredProfile } from "../types";
import ProfileCard from "./ProfileCard";

interface Props {
  profile: StructuredProfile;
  course: Course;
  onMatch: () => void;
  onUpdate: () => void;
  onViewTeam?: () => void;
  onRematch?: () => void;
  hasTeam?: boolean;
  rematchAllowed?: boolean;
  matching?: boolean;
  team?: MatchResponse | null;
}

export default function SavedStyle({
  profile,
  course,
  onMatch,
  onUpdate,
  onViewTeam,
  onRematch,
  hasTeam,
  rematchAllowed,
  matching,
  team,
}: Props) {
  const teammates = (team?.team ?? []).filter((m) => !m.is_you).map((m) => m.name);

  return (
    <div className="saved-style">
      <div className="page-head">
        <p className="kicker">{course.name}</p>
        <h1>Your working style</h1>
        <p className="page-dek">
          {hasTeam
            ? rematchAllowed
              ? "Rematch is unlocked. Update preferences, or match again."
              : "You’re on a team. Preferences can change; the team stays unless a flag is approved."
            : "We’ll reuse this profile for this course."}
        </p>
      </div>

      <div className="saved-layout">
        <ProfileCard profile={profile} />

        <aside className="cta-card">
          {hasTeam ? (
            <>
              <p className="kicker">Assigned</p>
              <h2>You’re on a team</h2>
              {teammates.length > 0 && (
                <ul className="pref-chips">
                  {teammates.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}
              <p>Names and shared windows are on Your team. Preferences stay private.</p>
              <button className="btn primary lg wide" type="button" onClick={onViewTeam}>
                Open your team
              </button>
              <button className="btn ghost wide" type="button" onClick={onUpdate}>
                Update preferences
              </button>
              {rematchAllowed && (
                <button className="btn ghost wide" type="button" disabled={matching} onClick={onRematch}>
                  Redo team matching
                </button>
              )}
            </>
          ) : (
            <>
              <p className="kicker">Next</p>
              <h2>Find a team</h2>
              <p>We’ll place you with people whose hours, goals, and skills line up for {course.name}.</p>
              <button className="btn primary lg wide" type="button" disabled={matching} onClick={onMatch}>
                {matching ? "Finding your team…" : "Find my team"}
              </button>
              <button className="btn ghost wide" type="button" disabled={matching} onClick={onUpdate}>
                Tweak preferences first
              </button>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
