import { useRef, useState, type KeyboardEvent } from "react";
import { ArrowLeft } from "lucide-react";
import { sendChat } from "../api";
import {
  CONFLICT_LABELS,
  GOAL_LABELS,
  ROLE_LABELS,
  toCourseContext,
  type ChatMessage,
  type Course,
  type GoalType,
  type StructuredProfile,
} from "../types";
import { ChatBody } from "./ChatBody";
import PageIntro from "./PageIntro";
import { SkillBars, WeekCalendar } from "./WeekCalendar";
import { Button } from "./ui/button";

interface Props {
  name: string;
  course: Course;
  profile: StructuredProfile;
  onSave: (profile: StructuredProfile) => void;
  onCancel: () => void;
}

const control = "mt-2 h-11 w-full rounded-xl border bg-background px-3";

export default function PrefUpdate({ name, course, profile, onSave, onCancel }: Props) {
  const [draft, setDraft] = useState(profile);
  const [hoursText, setHoursText] = useState(String(profile.hours));
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const ctx = toCourseContext(course);

  function toggleSlot(slot: string) {
    setDraft((cur) => {
      const has = cur.availability.includes(slot);
      return { ...cur, availability: has ? cur.availability.filter((s) => s !== slot) : [...cur.availability, slot] };
    });
  }

  async function sendUpdate() {
    const text = chatDraft.trim();
    if (!text || busy) return;
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setChatDraft("");
    setBusy(true);
    setError(null);
    try {
      const res = await sendChat(name, next, ctx, { mode: "update", profile: draft, focus: "any" });
      setMessages([...next, { role: "assistant", content: res.reply }]);
      if (res.ready && res.profile) {
        setDraft({ ...res.profile, id: draft.id, name });
        if (res.profile.hours) setHoursText(String(res.profile.hours));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't update that.");
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  function onComposerKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      void sendUpdate();
    }
  }

  return (
    <div>
      <Button variant="ghost" className="mb-5 px-0 hover:bg-transparent" onClick={onCancel}>
        <ArrowLeft /> Back
      </Button>
      <PageIntro
        kicker="Private profile"
        title="Update preferences"
        body="Saving does not remake your team. squadly rescans your current fit first."
      />

      <section className="mt-7 space-y-8 rounded-2xl border bg-card p-6 paper-shadow sm:p-8">
        <div className="grid gap-5 sm:grid-cols-3">
          <label className="text-sm font-semibold">
            Goal
            <select
              className={control}
              value={draft.goal}
              onChange={(e) => setDraft((cur) => ({ ...cur, goal: e.target.value as GoalType }))}
            >
              {(Object.keys(GOAL_LABELS) as GoalType[]).map((g) => (
                <option key={g} value={g}>
                  {GOAL_LABELS[g]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-semibold">
            Hours per week
            <input
              className="mt-2 h-11 w-full rounded-xl bg-background px-3"
              type="number"
              min={1}
              max={40}
              value={hoursText}
              onChange={(e) => setHoursText(e.target.value)}
            />
          </label>
          <label className="text-sm font-semibold">
            Team role
            <select
              className={control}
              value={draft.role}
              onChange={(e) => setDraft((cur) => ({ ...cur, role: e.target.value as StructuredProfile["role"] }))}
            >
              {(Object.keys(ROLE_LABELS) as Array<keyof typeof ROLE_LABELS>).map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div>
          <h3 className="font-display text-xl font-medium tracking-[-0.03em]">Availability</h3>
          <p className="text-sm text-muted-foreground">Choose times you can reliably protect.</p>
          <div className="mt-4">
            <WeekCalendar slots={draft.availability} onToggle={toggleSlot} />
          </div>
        </div>

        <div className="grid gap-7 border-t pt-7 md:grid-cols-2">
          <div>
            <h3 className="mb-4 font-display text-xl font-medium tracking-[-0.03em]">Skills, 1–5</h3>
            <SkillBars privateView skills={draft.skills} />
            <div className="mt-4 grid grid-cols-4 gap-2">
              {(["technical", "writing", "analysis", "presentation"] as const).map((key) => (
                <select
                  key={key}
                  className="h-10 rounded-xl border bg-background px-2 text-sm"
                  value={draft.skills[key]}
                  onChange={(e) =>
                    setDraft((cur) => ({ ...cur, skills: { ...cur.skills, [key]: Number(e.target.value) } }))
                  }
                  aria-label={key}
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              ))}
            </div>
          </div>
          <label className="text-sm font-semibold">
            Conflict style
            <select
              className={control}
              value={draft.conflict_mode}
              onChange={(e) =>
                setDraft((cur) => ({ ...cur, conflict_mode: e.target.value as StructuredProfile["conflict_mode"] }))
              }
            >
              {(Object.keys(CONFLICT_LABELS) as Array<keyof typeof CONFLICT_LABELS>).map((mode) => (
                <option key={mode} value={mode}>
                  {CONFLICT_LABELS[mode]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold">Or describe it in chat</p>
          <div className="overflow-hidden rounded-2xl border">
            {messages.length > 0 && (
              <div className="space-y-3 p-4">
                {messages.map((m, i) => (
                  <div key={i} className={m.role === "user" ? "text-right text-sm" : "text-sm"}>
                    <ChatBody text={m.content} />
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2 border-t p-3">
              <input
                ref={inputRef}
                className="h-11 flex-1 rounded-full bg-background px-4"
                value={chatDraft}
                onChange={(e) => setChatDraft(e.target.value)}
                onKeyDown={onComposerKey}
                placeholder="What should change?"
                disabled={busy}
              />
              <Button disabled={!chatDraft.trim() || busy} onClick={() => void sendUpdate()}>
                Send
              </Button>
            </div>
          </div>
        </div>

        {error && <p className="rounded-xl bg-warn-soft p-3 text-sm font-semibold text-warn">{error}</p>}

        <div className="flex flex-col items-start justify-between gap-4 border-t pt-6 sm:flex-row sm:items-center">
          <p className="text-sm text-muted-foreground">Teammates and your teacher will be notified of the update.</p>
          <Button
            size="lg"
            onClick={() => {
              const n = Number(hoursText);
              const next = Number.isInteger(n) && n >= 1 && n <= 40 ? { ...draft, hours: n } : draft;
              onSave(next);
            }}
          >
            Save preferences
          </Button>
        </div>
      </section>
    </div>
  );
}
