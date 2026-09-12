import { useEffect, useState } from "react";
import { Clipboard, Flag } from "lucide-react";
import { raiseConcern, submitProfile } from "../api";
import {
  FLAG_REASONS,
  courseSkillFields,
  type Course,
  type FlagReason,
  type MatchResponse,
  type StructuredProfile,
} from "../types";
import Chip from "./Chip";
import PageIntro from "./PageIntro";
import { SkillBars, WeekCalendar } from "./WeekCalendar";
import { Button } from "./ui/button";

const TONES = ["bg-accent-soft", "bg-secondary", "bg-good-soft", "bg-muted"];

interface Props {
  result: MatchResponse;
  yourName: string;
  course: Course;
  profile?: StructuredProfile | null;
  rematchAllowed?: boolean;
  impactNote?: string | null;
  impactHurt?: boolean;
  onChangeCourse: () => void;
  onUpdatePrefs: () => void;
  onRematch?: () => void;
}

export default function MyTeam({
  result,
  yourName,
  course,
  profile,
  rematchAllowed,
  impactNote,
  impactHurt,
  onUpdatePrefs,
  onRematch,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [flagOpen, setFlagOpen] = useState(false);
  const [reason, setReason] = useState<FlagReason>("schedule");
  const [note, setNote] = useState("");
  const [flagState, setFlagState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [flagError, setFlagError] = useState<string | null>(null);

  const names = result.team.map((m) => (m.is_you ? yourName : m.name));
  const teamLabel =
    result.team_label ||
    (result.team_id?.startsWith("team-")
      ? `Team ${String(Number(result.team_id.slice(5)) + 1).padStart(2, "0")}`
      : "Your team");

  useEffect(() => {
    if (!flagOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setFlagOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [flagOpen]);

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
    <div>
      <PageIntro
        kicker={course.name}
        title="Your team"
        body="Names and shared facts only. Everyone’s preferences stay private."
      />

      {impactNote && (
        <div className="mt-6 flex flex-col gap-4 rounded-2xl border border-warn bg-warn-soft p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-bold text-warn">{impactHurt ? "Your new availability affects team fit." : impactNote}</p>
            {impactHurt && (
              <p className="mt-1 text-sm">
                {impactNote} Your instructor has been notified; your team stays together for now.
              </p>
            )}
          </div>
          {impactHurt && <Chip tone="warn">Fit drop</Chip>}
        </div>
      )}

      <div className="mt-7 grid gap-5 lg:grid-cols-[1.25fr_.75fr]">
        <div className="space-y-5">
          <section className="rounded-2xl border bg-card p-6 paper-shadow">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-2xl font-medium tracking-[-0.03em]">{teamLabel}</h2>
              <Button variant="outline" size="sm" onClick={() => void copyNames()}>
                <Clipboard /> {copied ? "Copied names" : "Copy names"}
              </Button>
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {result.team.map((m, i) => {
                const label = m.is_you ? yourName : m.name;
                return (
                  <div key={m.id} className={`rounded-xl p-4 ${TONES[i % TONES.length]}`}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-bold">{label}</p>
                      {m.is_you && <Chip tone="accent">You</Chip>}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{m.is_you ? "You" : "Teammate"}</p>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-2xl border bg-card p-6 paper-shadow">
            <h2 className="font-display text-2xl font-medium tracking-[-0.03em]">Shared windows</h2>
            <p className="mb-5 mt-1 text-sm text-muted-foreground">Times when the full team can meet.</p>
            <WeekCalendar slots={result.shared_windows ?? []} compact />
          </section>
        </div>

        <aside className="space-y-5">
          <section className="rounded-2xl border bg-card p-6 paper-shadow">
            <div className="kicker">Team goal</div>
            <h3 className="mt-2 font-display text-2xl font-medium tracking-[-0.03em]">{result.team_goal || "Shared project aim"}</h3>
            <p className="mt-2 text-sm text-muted-foreground">Hours, goals, and skills aligned for this course.</p>
          </section>
          <section className="rounded-2xl border bg-card p-6 paper-shadow">
            <h3 className="font-display text-xl font-medium tracking-[-0.03em]">Skill coverage</h3>
            <div className="mt-5">
              <SkillBars
                coverage={result.coverage}
                thin={result.thin}
                skills={result.skill_peaks}
                keys={courseSkillFields(course).map((s) => s.key)}
                labels={Object.fromEntries(courseSkillFields(course).map((s) => [s.key, s.label]))}
              />
            </div>
          </section>
          <Button variant="outline" className="w-full" onClick={onUpdatePrefs}>
            Update preferences
          </Button>
          <Button variant="ghost" className="w-full text-warn" onClick={() => setFlagOpen(true)}>
            <Flag /> Flag a concern
          </Button>
          {flagState === "sent" && (
            <p className="text-sm text-muted-foreground">Concern sent to the teacher. Your team stays as-is until they approve a rematch.</p>
          )}
          {flagError && <p className="rounded-xl bg-warn-soft p-3 text-sm font-semibold text-warn">{flagError}</p>}
          {rematchAllowed && onRematch && (
            <Button variant="ghost" className="w-full" onClick={onRematch}>
              Redo team matching
            </Button>
          )}
        </aside>
      </div>

      <section className="mt-5 rounded-2xl border bg-accent-soft px-8 py-7">
        <h3 className="font-display text-xl font-medium tracking-[-0.03em]">Why this team</h3>
        <p className="mt-3 max-w-none text-base leading-relaxed">{result.rationale}</p>
      </section>

      {flagOpen && flagState !== "sent" && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/35 p-4" onMouseDown={() => setFlagOpen(false)}>
          <section className="w-full max-w-md rounded-2xl border bg-card p-6 paper-shadow" onMouseDown={(e) => e.stopPropagation()}>
            <div className="kicker">Teacher only</div>
            <h2 className="mt-1 font-display text-2xl font-medium tracking-[-0.03em]">Flag a concern</h2>
            <p className="mt-3 text-sm text-muted-foreground">Your teammates won’t see this report.</p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              {FLAG_REASONS.map((r) => (
                <Button key={r.value} variant="outline" className={reason === r.value ? "border-primary bg-accent-soft" : ""} onClick={() => setReason(r.value)}>
                  {r.label}
                </Button>
              ))}
            </div>
            <textarea
              className="mt-4 min-h-24 w-full rounded-xl border bg-background p-3 text-sm"
              placeholder="Optional note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <Button className="mt-4 w-full" disabled={flagState === "sending"} onClick={() => void sendFlag()}>
              {flagState === "sending" ? "Sending…" : "Send to teacher"}
            </Button>
          </section>
        </div>
      )}
    </div>
  );
}
