import type { MatchResponse } from "../types";

interface Props {
  result: MatchResponse;
  yourName: string;
  onRestart: () => void;
}

export default function MyTeam({ result, yourName, onRestart }: Props) {
  return (
    <div className="match-panel">
      <h2 className="page-title">Your team</h2>
      <p className="page-dek">
        Matched from a cohort of {result.cohort_size}. You only see who’s on your team — not their
        answers or preference details.
      </p>

      <ul className="teammate-list">
        {result.team.map((m) => (
          <li key={m.id} className={m.is_you ? "you" : ""}>
            <span className="avatar" aria-hidden>
              {(m.is_you ? yourName : m.name).charAt(0).toUpperCase()}
            </span>
            <div>
              <strong>{m.is_you ? `${yourName} (you)` : m.name}</strong>
              <span className="teammate-sub">{m.is_you ? "That’s you" : "Teammate"}</span>
            </div>
          </li>
        ))}
      </ul>

      <div className="why-block">
        <h3>Why this team</h3>
        <p>{result.rationale}</p>
      </div>

      <button className="btn ghost" type="button" onClick={onRestart}>
        ← Start over
      </button>
    </div>
  );
}
