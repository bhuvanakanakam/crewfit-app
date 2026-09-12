import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { sendChat } from "../api";
import ProfileCard from "./ProfileCard";
import AvailCalendar from "./AvailCalendar";
import { ChatBody } from "./ChatBody";
import {
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
  const [availSlots, setAvailSlots] = useState<string[]>([]);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, course.id]);

  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant")?.content ?? "";
  const askingAvail = /free to meet|when you can meet|mornings, afternoons|evenings/i.test(lastAssistant);

  async function send(textOverride?: string) {
    const text = (textOverride ?? draft).trim();
    if (!text || busy || profile) return;
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setDraft("");
    setAvailSlots([]);
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
      inputRef.current?.focus();
    }
  }

  function toggleAvail(slot: string) {
    setAvailSlots((cur) => (cur.includes(slot) ? cur.filter((s) => s !== slot) : [...cur, slot]));
  }

  function sendAvail() {
    if (availSlots.length === 0) return;
    const ordered = availSlots.slice().sort();
    void send(ordered.map(formatSlot).join(", "));
  }

  function onComposerKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div className="chat-wrap">
      <div className="page-head">
        <p className="kicker">{course.name}</p>
        <h1>How do you work?</h1>
        <p className="page-dek">Talk normally. I’ll pull out what I need and ask if something’s still unclear.</p>
      </div>

      <div className="chat-panel">
        <div className="chat-thread" ref={scroller} role="log" aria-live="polite">
          {messages.map((m, i) => (
            <div key={`${m.role}-${i}`} className={`bubble ${m.role}`}>
              <span className="bubble-who">{m.role === "assistant" ? "Assistant" : name}</span>
              <ChatBody text={m.content} />
            </div>
          ))}
          {busy && (
            <div className="bubble assistant">
              <span className="bubble-who">Assistant</span>
              <p className="typing">Thinking…</p>
            </div>
          )}
        </div>

        {error && <div className="error-banner chat-error">{error}</div>}

        {!profile && (
          <>
            {askingAvail && (
              <div className="avail-composer">
                <AvailCalendar slots={availSlots} onToggle={toggleAvail} />
                <button
                  className="btn ghost"
                  type="button"
                  disabled={busy || availSlots.length === 0}
                  onClick={sendAvail}
                >
                  Use these slots
                </button>
              </div>
            )}
            <div className="chat-composer">
              <textarea
                ref={inputRef}
                rows={3}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onComposerKey}
                placeholder="Type anything — a sentence or a whole paragraph."
                disabled={busy}
              />
              <button className="btn primary" type="button" disabled={!draft.trim() || busy} onClick={() => void send()}>
                Send
              </button>
            </div>
          </>
        )}

        {profile && (
          <div className="chat-ready">
            <div className="cta-card nested">
              <p className="kicker">Ready</p>
              <h3>Profile saved</h3>
              <p>We’ll match you on hours, goals, and skills — not on a personality quiz dump.</p>
              <button className="btn primary lg" type="button" onClick={() => onReady(profile)}>
                Find my team
              </button>
            </div>
            <ProfileCard profile={profile} compact />
          </div>
        )}
      </div>
    </div>
  );
}
