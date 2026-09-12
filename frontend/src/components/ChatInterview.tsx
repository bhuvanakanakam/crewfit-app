import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { sendChat } from "../api";
import {
  GOAL_LABELS,
  ROLE_LABELS,
  SKILL_FIELDS,
  formatSlot,
  toCourseContext,
  type ChatMessage,
  type Course,
  type StructuredProfile,
} from "../types";

interface Props {
  name: string;
  course: Course;
  onReady: (profile: StructuredProfile) => void;
}

export default function ChatInterview({ name, course, onReady }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<StructuredProfile | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const ctx = toCourseContext(course);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy, profile]);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setError(null);
    sendChat(name, [], ctx)
      .then((res) => {
        if (!cancelled) setMessages([{ role: "assistant", content: res.reply }]);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't start the chat.");
      })
      .finally(() => {
        if (!cancelled) {
          setBusy(false);
          inputRef.current?.focus();
        }
      });
    return () => {
      cancelled = true;
    };
    // Course context is stable for this mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, course.id]);

  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant")?.content ?? "";
  const askingSkillRating = /from 1 to 5|number from 1 to 5/i.test(lastAssistant);
  const askingTeamRole = /lead, contribute, or either|lead, contribute, or are you fine/i.test(lastAssistant);

  function parseSkillDraft(text: string): number | null {
    const nums = text.match(/\d+/g)?.map(Number) ?? [];
    if (nums.length !== 1) return null;
    const n = nums[0];
    return n >= 1 && n <= 5 ? n : null;
  }

  async function send() {
    const text = draft.trim();
    if (!text || busy || profile) return;
    if (askingSkillRating && parseSkillDraft(text) == null) {
      setError("Enter a whole number from 1 to 5.");
      return;
    }
    if (askingTeamRole && !/lead|contribut|either|support|no preference|don't mind|flexible/i.test(text)) {
      setError("Please pick lead, contribute, or either.");
      return;
    }
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setDraft("");
    setBusy(true);
    setError(null);
    try {
      const res = await sendChat(name, next, ctx);
      setMessages([...next, { role: "assistant", content: res.reply }]);
      if (res.ready && res.profile) {
        setProfile({
          ...res.profile,
          id: res.profile.id || "you",
          name,
          bio: res.profile.bio || next.filter((m) => m.role === "user").map((m) => m.content).join("\n"),
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send that message.");
    } finally {
      setBusy(false);
    }
  }

  function onComposerKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div className="chat-wrap">
      <p className="kicker">{course.name}</p>
      <h1>How do you work?</h1>
      <p className="page-dek">
        A few short questions, one at a time — including each kind of work we match on.
        Answer in your own words; we’ll save this and reuse it on other courses.
      </p>

      <div className="chat-panel">
        <div className="chat-thread" ref={scroller} role="log" aria-live="polite">
          {messages.map((m, i) => (
            <div key={`${m.role}-${i}`} className={`bubble ${m.role}`}>
              <span className="bubble-who">{m.role === "assistant" ? "CrewFit" : name}</span>
              <p>{m.content}</p>
            </div>
          ))}
          {busy && (
            <div className="bubble assistant">
              <span className="bubble-who">CrewFit</span>
              <p className="typing">Thinking…</p>
            </div>
          )}
        </div>

        {error && <div className="error-banner chat-error">{error}</div>}

        {!profile && (
          <div className="chat-composer">
            <textarea
              ref={inputRef}
              rows={2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onComposerKey}
              placeholder={
                askingSkillRating
                  ? "Type a number from 1 to 5"
                  : askingTeamRole
                    ? "Lead, contribute, or either"
                    : "Write a normal reply…"
              }
              disabled={busy}
            />
            <button className="btn primary" type="button" disabled={!draft.trim() || busy} onClick={() => void send()}>
              Send
            </button>
          </div>
        )}

        {profile && (
          <div className="chat-ready">
            <h3>Saved — we’ll reuse this across courses</h3>
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
            <p className="avail-preview">{profile.availability.slice(0, 8).map(formatSlot).join(" · ")}</p>
            <div className="skill-pills">
              {SKILL_FIELDS.map((s) => (
                <span key={s.key}>
                  {s.label} {profile.skills[s.key]}
                </span>
              ))}
            </div>
            <button className="btn primary" type="button" onClick={() => onReady(profile)}>
              Find my team in {course.name}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
