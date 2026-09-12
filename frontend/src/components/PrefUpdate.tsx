import { useRef, useState, type KeyboardEvent } from "react";
import { sendChat } from "../api";
import {
  GOAL_OPTIONS,
  INTERVIEWER_NAME,
  ROLE_LABELS,
  SKILL_FIELDS,
  toCourseContext,
  type ChatMessage,
  type Course,
  type GoalType,
  type StructuredProfile,
} from "../types";
import ProfileCard from "./ProfileCard";
import { ChatBody } from "./ChatBody";

type Focus = "goal" | "hours" | "availability" | "skills" | "role";

interface Props {
  name: string;
  course: Course;
  profile: StructuredProfile;
  onSave: (profile: StructuredProfile) => void;
  onCancel: () => void;
}

const FIELDS: { id: Focus; label: string }[] = [
  { id: "goal", label: "Goal" },
  { id: "hours", label: "Hours" },
  { id: "availability", label: "Availability" },
  { id: "skills", label: "Skills" },
  { id: "role", label: "Team role" },
];

export default function PrefUpdate({ name, course, profile, onSave, onCancel }: Props) {
  const [draft, setDraft] = useState(profile);
  const [focus, setFocus] = useState<Focus | "chat" | null>(null);
  const [hoursText, setHoursText] = useState(String(profile.hours));
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposed, setProposed] = useState<StructuredProfile | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const ctx = toCourseContext(course);

  function toggleSlot(slot: string) {
    setDraft((cur) => {
      const has = cur.availability.includes(slot);
      return {
        ...cur,
        availability: has ? cur.availability.filter((s) => s !== slot) : [...cur.availability, slot],
      };
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
      const res = await sendChat(name, next, ctx, {
        mode: "update",
        profile: draft,
        focus: focus === "chat" ? "any" : focus ?? "any",
      });
      setMessages([...next, { role: "assistant", content: res.reply }]);
      if (res.ready && res.profile) {
        setProposed({ ...res.profile, id: draft.id, name });
        setDraft({ ...res.profile, id: draft.id, name });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't update that.");
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  function onComposerKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendUpdate();
    }
  }

  function applyHours() {
    const n = Number(hoursText);
    if (!Number.isInteger(n) || n < 1 || n > 40) {
      setError("Hours should be a whole number from 1 to 40.");
      return;
    }
    setError(null);
    setDraft((cur) => ({ ...cur, hours: n }));
  }

  return (
    <div className="chat-wrap">
      <div className="page-head">
        <p className="kicker">{course.name}</p>
        <h1>Update preferences</h1>
        <p className="page-dek">Pick a field or describe the change. This does not remake your team.</p>
      </div>

      <ProfileCard profile={proposed ?? draft} onToggleAvail={toggleSlot} />

      <fieldset className="pref-pick">
        <legend>What should we change?</legend>
        {FIELDS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={focus === f.id ? "on" : ""}
            onClick={() => {
              setFocus(f.id);
              setProposed(null);
              setError(null);
            }}
          >
            {f.label}
          </button>
        ))}
        <button
          type="button"
          className={focus === "chat" ? "on" : ""}
          onClick={() => {
            setFocus("chat");
            setProposed(null);
            setError(null);
            if (messages.length === 0) {
              setMessages([
                {
                  role: "assistant",
                  content:
                    "Tell me what to change in your own words. I’ll update only what you mean. If it’s unclear I’ll ask once.",
                },
              ]);
            }
          }}
        >
          Describe it in chat
        </button>
      </fieldset>

      {focus === "goal" && (
        <div className="chip-grid">
          {GOAL_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`choice${draft.goal === opt.value ? " on" : ""}`}
              onClick={() => setDraft((cur) => ({ ...cur, goal: opt.value as GoalType }))}
            >
              <span className="choice-title">{opt.label}</span>
              <span className="choice-hint">{opt.hint}</span>
            </button>
          ))}
        </div>
      )}

      {focus === "hours" && (
        <div className="pref-edit-row">
          <label htmlFor="pref-hours">Hours per week</label>
          <input
            id="pref-hours"
            type="number"
            min={1}
            max={40}
            value={hoursText}
            onChange={(e) => setHoursText(e.target.value)}
            onBlur={applyHours}
          />
        </div>
      )}

      {focus === "role" && (
        <div className="chip-grid">
          {(Object.keys(ROLE_LABELS) as Array<keyof typeof ROLE_LABELS>).map((role) => (
            <button
              key={role}
              type="button"
              className={`choice${draft.role === role ? " on" : ""}`}
              onClick={() => setDraft((cur) => ({ ...cur, role }))}
            >
              <span className="choice-title">{ROLE_LABELS[role]}</span>
            </button>
          ))}
        </div>
      )}

      {focus === "availability" && (
        <p className="field-help">Click morning, afternoon, or evening cells on the week above.</p>
      )}

      {focus === "skills" && (
        <div className="skill-list">
          {SKILL_FIELDS.map((s) => (
            <div className="skill-row" key={s.key}>
              <div>
                <strong>{s.label}</strong>
                <span className="choice-hint">{s.hint}</span>
              </div>
              <div className="skill-nudge">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={draft.skills[s.key] === n ? "on" : ""}
                    onClick={() =>
                      setDraft((cur) => ({ ...cur, skills: { ...cur.skills, [s.key]: n } }))
                    }
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {focus === "chat" && (
        <div className="chat-panel">
          <div className="chat-thread" role="log" aria-live="polite">
            {messages.map((m, i) => (
              <div key={`${m.role}-${i}`} className={`bubble ${m.role}`}>
                <span className="bubble-who">{m.role === "assistant" ? INTERVIEWER_NAME : name}</span>
                <ChatBody text={m.content} />
              </div>
            ))}
            {busy && (
              <div className="bubble assistant">
                <span className="bubble-who">{INTERVIEWER_NAME}</span>
                <p className="typing">Thinking…</p>
              </div>
            )}
          </div>
          <div className="chat-composer">
            <textarea
              ref={inputRef}
              rows={2}
              value={chatDraft}
              onChange={(e) => setChatDraft(e.target.value)}
              onKeyDown={onComposerKey}
              placeholder="What should change?"
              disabled={busy}
            />
            <button className="btn primary" type="button" disabled={!chatDraft.trim() || busy} onClick={() => void sendUpdate()}>
              Send
            </button>
          </div>
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}

      <div className="form-actions">
        <button className="btn primary" type="button" onClick={() => {
          const n = Number(hoursText);
          const next = Number.isInteger(n) && n >= 1 && n <= 40 ? { ...draft, hours: n } : draft;
          onSave(next);
        }}>
          Save preferences
        </button>
        <button className="btn ghost" type="button" onClick={onCancel}>
          Never mind
        </button>
      </div>
    </div>
  );
}
