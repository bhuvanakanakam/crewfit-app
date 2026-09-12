import { useState } from "react";
import { raiseConcern, submitProfile } from "../api";
import {
  FLAG_REASONS,
  formatSlot,
  skillList,
  type Course,
  type FlagReason,
  type MatchResponse,
  type StructuredProfile,
} from "../types";

interface Props {
  result: MatchResponse;
  yourName: string;
  course: Course;
  profile?: StructuredProfile | null;
  onChangeCourse: () => void;
  onOpenChat: () => void;
}

export default function MyTeam({ result, yourName, course, profile, onChangeCourse, onOpenChat }: Props) {
  const [copied, setCopied] = useState(false);
  const [flagOpen, setFlagOpen] = useState(false);
  const [reason, setReason] = useState<FlagReason>("schedule");
  const [note, setNote] = useState("");
  const [flagState, setFlagState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [flagError, setFlagError] = useState<string | null>(null);

  const names = result.team.map((m) => (m.is_you ? yourName : m.name));

  async function copyNames() {
    try {
      await navigator.clipboard.writeText(names.join(", "));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  async function sendFlag() {
    setFlagState("sending");
    setFlagError(null);
    try {
      if (profile) await submitProfile(profile, course.id).catch(() => undefined);
      await raiseConcern(yourName, course.id, reason, note.trim());
      setFlagState("sent");
      setFlagOpen(false);
    } catch (e) {
      setFlagState("error");
      setFlagError(e instanceof Error ? e.message : "Couldn't send that concern.");
    }
  }

  return (
    <div className="match-panel">
      <p className="kicker">{course.name}</p>
      <h1>Your team</h1>
      <p className="page-dek">
        {course.team_size_min === course.team_size_max
          ? `Teams in this course are ${course.team_size_min}. `
          : `Teams in this course are ${course.team_size_min}–${course.team_size_max} people. `}
        Same assignment the teacher sees. Names plus group-level facts — not anyone else’s private
        answers.
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

      <div className="fact-grid">
        <article>
          <h3>Shared windows</h3>
          {(result.shared_windows ?? []).length > 0 ? (
            <p>{result.shared_windows.map(formatSlot).join(" · ")}</p>
          ) : (
            <p>None fully overlap — plan to work async.</p>
          )}
        </article>
        <article>
          <h3>Team goal</h3>
          <p>{result.team_goal || "Shared project aim"}</p>
        </article>
        <article>
          <h3>Coverage</h3>
          <p>
            {(result.coverage ?? []).length > 0 ? skillList(result.coverage) : "No strong coverage yet"}
            {(result.thin ?? []).length > 0 ? ` · thinner on ${skillList(result.thin).toLowerCase()}` : ""}
          </p>
        </article>
      </div>

      <div className="why-block">
        <h3>Why this team</h3>
        <p>{result.rationale}</p>
      </div>

      <div className="next-steps">
        <h3>Next steps</h3>
        <div className="form-actions">
          <button className="btn primary" type="button" onClick={() => void copyNames()}>
            {copied ? "Copied names" : "Copy names"}
          </button>
          <button className="btn ghost" type="button" onClick={() => setFlagOpen((v) => !v)}>
            Flag a concern
          </button>
        </div>

        {flagState === "sent" && (
          <p className="need-note">Concern sent to the teacher for {course.name}.</p>
        )}
        {flagError && <div className="error-banner">{flagError}</div>}

        {flagOpen && flagState !== "sent" && (
          <div className="flag-box">
            <p className="field-help">This goes to your teacher for this course — teammates don’t see it.</p>
            <div className="chip-grid">
              {FLAG_REASONS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  className={`choice${reason === r.value ? " on" : ""}`}
                  onClick={() => setReason(r.value)}
                >
                  <span className="choice-title">{r.label}</span>
                </button>
              ))}
            </div>
            <label htmlFor="flag-note">Optional note</label>
            <textarea
              id="flag-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What’s not working?"
            />
            <button
              className="btn primary"
              type="button"
              disabled={flagState === "sending"}
              onClick={() => void sendFlag()}
            >
              {flagState === "sending" ? "Sending…" : "Send to teacher"}
            </button>
          </div>
        )}
      </div>

      <div className="form-actions">
        <button className="btn ghost" type="button" onClick={onOpenChat}>
          Update profile in chat
        </button>
        <button className="text-link" type="button" onClick={onChangeCourse}>
          Use this profile in another course
        </button>
      </div>
    </div>
  );
}
