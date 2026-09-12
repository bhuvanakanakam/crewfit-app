import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { sendChat } from "../api";
import ProfileCard from "./ProfileCard";
import AvailCalendar from "./AvailCalendar";
import { ChatBody } from "./ChatBody";
import {
  INTERVIEWER_NAME,
  formatSlot,
  toCourseContext,
  type ChatMessage,
  type Course,
  type StructuredProfile,
} from "../types";
import { startTalk, type TalkSession, type TalkStatus, type VoiceTurn } from "../voice/grokRealtime";

/** A thread entry. Spoken turns carry the realtime turn id so captions update in place. */
type Turn = ChatMessage & { voiceId?: string; pending?: boolean };

function wire(list: Turn[]): ChatMessage[] {
  return list.filter((m) => m.content.trim()).map(({ role, content }) => ({ role, content }));
}

function isAffirmation(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[.!?,]/g, "");
  return /^(y|yes|yeah|yep|yup|ok|okay|sure|correct|perfect|confirmed|all good|looks good|sounds good|that'?s (right|fine|good)|we'?re good)( find my team| that'?s it| we'?re done)?$/.test(
    t,
  );
}

interface Props {
  name: string;
  course: Course;
  onReady: (profile: StructuredProfile) => void;
}

export default function ChatInterview({ name, course, onReady }: Props) {
  const [messages, setMessages] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<StructuredProfile | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [availSlots, setAvailSlots] = useState<string[]>([]);
  const [voiceOn, setVoiceOn] = useState(false);
  const [talkStatus, setTalkStatus] = useState<TalkStatus>("idle");
  const [phase, setPhase] = useState<"interview" | "confirm" | "locked">("interview");
  const phaseRef = useRef(phase);
  const profileRef = useRef(profile);
  const messagesRef = useRef(messages);
  phaseRef.current = phase;
  profileRef.current = profile;
  messagesRef.current = messages;
  const scroller = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const reviewRef = useRef<HTMLDivElement>(null);
  const pinThread = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const talkRef = useRef<TalkSession | null>(null);
  const ctx = toCourseContext(course);

  function commit(next: Turn[]) {
    messagesRef.current = next;
    setMessages(next);
  }

  function hangUpVoice(afterSpeech = false) {
    const session = talkRef.current;
    if (afterSpeech && session) {
      // Keep the handle so unmount can still cut it off; onStatus("idle") clears it.
      session.stopAfterSpeech();
    } else {
      talkRef.current = null;
      session?.stop();
    }
    setVoiceOn(false);
    setTalkStatus("idle");
  }

  function enterConfirm(next: StructuredProfile) {
    setProfile(next);
    setPhase("confirm");
    // Let Scotty land the sentence that pivots to the review before the mic closes.
    hangUpVoice(true);
    window.setTimeout(() => {
      reviewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  function finishInterview(next: StructuredProfile) {
    hangUpVoice();
    setPhase("locked");
    setProfile(next);
    onReady(next);
  }

  function applyProfile(raw: StructuredProfile, nextMessages: ChatMessage[]) {
    const next = {
      ...raw,
      id: raw.id || "you",
      name,
      bio: raw.bio || nextMessages.filter((m) => m.role === "user").map((m) => m.content).join("\n"),
    };
    enterConfirm(next);
  }

  function syncProfile(next: ChatMessage[]) {
    void sendChat(name, next, ctx)
      .then((res) => {
        setNotes(res.notes ?? []);
        if (res.profile) applyProfile(res.profile, next);
        else {
          setProfile(null);
          setPhase("interview");
        }
      })
      .catch(() => undefined);
  }

  /**
   * At the review point the interview is over: fold the requested change into the profile
   * on screen and stay put, rather than running another intake turn from the top.
   */
  function correctProfile(text: string) {
    const base = profileRef.current;
    if (!base) return;
    setBusy(true);
    void sendChat(name, [{ role: "user", content: text }], ctx, {
      mode: "update",
      profile: base,
      focus: "any",
    })
      .then((res) => {
        setNotes(res.notes ?? []);
        if (res.profile) setProfile({ ...res.profile, id: base.id, name, bio: res.profile.bio || base.bio });
        // With voice on, Scotty says his own version out loud; don't print a second one.
        if (res.reply.trim() && !voiceOn) {
          commit([...messagesRef.current, { role: "assistant", content: res.reply }]);
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't apply that change."))
      .finally(() => {
        setBusy(false);
        inputRef.current?.focus();
      });
  }

  /** Spoken turns are keyed by id, so a caption update replaces its own bubble instead of adding one. */
  function applyVoiceTurn(turn: VoiceTurn) {
    const cur = messagesRef.current;
    const entry: Turn = {
      role: turn.role,
      content: turn.text,
      voiceId: turn.id,
      pending: !turn.done,
    };
    const at = cur.findIndex((m) => m.voiceId === turn.id);
    const next = at >= 0 ? [...cur.slice(0, at), entry, ...cur.slice(at + 1)] : [...cur, entry];
    commit(next);
    if (!turn.done) return;
    if (phaseRef.current === "locked") return;
    if (turn.role === "assistant") {
      // Only the interview re-reads the whole thread; the review edits the profile directly.
      if (phaseRef.current === "interview") syncProfile(wire(next));
      return;
    }
    if (phaseRef.current !== "confirm") return;
    const ready = profileRef.current;
    if (!ready) return;
    if (isAffirmation(turn.text)) finishInterview(ready);
    else correctProfile(turn.text);
  }

  function onThreadScroll() {
    const node = scroller.current;
    if (!node) return;
    pinThread.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
  }

  useEffect(() => {
    if (!pinThread.current) return;
    const node = scroller.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, busy]);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setError(null);
    sendChat(name, [], ctx)
      .then((res) => {
        if (!cancelled) commit([{ role: "assistant", content: res.reply }]);
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
      talkRef.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, course.id]);

  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant")?.content ?? "";
  const askingAvail =
    /free to meet|when you can meet|mornings|afternoons|evenings|schedule|availab|meet during|time of day|windows/i.test(
      lastAssistant,
    );

  async function send(textOverride?: string) {
    const text = (textOverride ?? draft).trim();
    if (!text || (busy && !voiceOn)) return;
    if (phase === "locked") return;
    setDraft("");
    setAvailSlots([]);
    setError(null);

    if (phase === "confirm" && profile) {
      commit([...messagesRef.current, { role: "user", content: text }]);
      if (isAffirmation(text)) {
        finishInterview(profile);
        return;
      }
      // Voice stays in the loop if it is on, so Scotty answers the change out loud.
      talkRef.current?.sendText(text);
      correctProfile(text);
      return;
    }

    const next: Turn[] = [...messagesRef.current, { role: "user", content: text }];

    if (voiceOn && talkRef.current && phase === "interview") {
      if (!talkRef.current.sendText(text)) {
        setDraft(text);
        setError("Let Scotty finish, then send that.");
        return;
      }
      commit(next);
      return;
    }

    commit(next);
    setBusy(true);
    try {
      const res = await sendChat(name, wire(next), ctx);
      commit([...next, { role: "assistant", content: res.reply }]);
      setNotes(res.notes ?? []);
      if (res.profile) applyProfile(res.profile, wire(next));
      else {
        setProfile(null);
        setPhase("interview");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send that message.");
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  async function setVoiceEnabled(on: boolean) {
    if (phase === "locked") return;
    if (on === voiceOn) return;
    if (!on) {
      hangUpVoice();
      return;
    }
    setError(null);
    setVoiceOn(true);
    try {
      const session = await startTalk(name, ctx, { history: messagesRef.current, review: profile }, {
        onStatus: (status) => {
          setTalkStatus(status);
          if (status === "idle" || status === "error") {
            setVoiceOn(false);
            talkRef.current = null;
          }
        },
        onTurn: applyVoiceTurn,
        onError: (message) => {
          setError(message);
          setVoiceOn(false);
        },
      });
      talkRef.current = session;
    } catch (e) {
      setVoiceOn(false);
      setTalkStatus("error");
      setError(e instanceof Error ? e.message : "Couldn't start voice.");
    }
  }

  function toggleAvail(slot: string) {
    setAvailSlots((cur) => (cur.includes(slot) ? cur.filter((s) => s !== slot) : [...cur, slot]));
  }

  function sendAvail() {
    if (availSlots.length === 0) return;
    void send(availSlots.slice().sort().map(formatSlot).join(", "));
  }

  function onComposerKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  const inReview = phase === "confirm" || phase === "locked";
  const locked = phase === "locked";
  const voiceHint =
    talkStatus === "connecting"
      ? "Connecting voice…"
      : talkStatus === "speaking"
        ? "Scotty is talking. Mic paused so he isn’t interrupted."
        : talkStatus === "listening"
          ? "Your turn. Speak, or type and he’ll answer out loud."
          : inReview
            ? "Voice is off for the review. Answer by text, or turn it back on."
            : "Voice off. Toggle on for a spoken back-and-forth.";

  return (
    <div className="chat-wrap">
      <div className="page-head">
        <p className="kicker">{course.name}</p>
        <h1>How do you work?</h1>
        <p className="page-dek">
          Type anytime. Voice is a turn-taking conversation: you speak, captions follow, then
          Scotty talks. The mic waits until he’s done.
        </p>
      </div>

      <div className="chat-panel">
        <div className="chat-thread" ref={scroller} role="log" aria-live="polite" onScroll={onThreadScroll}>
          {messages
            .filter((m) => m.content.trim())
            .map((m, i) => (
              <div
                key={m.voiceId ?? `${m.role}-${i}`}
                className={`bubble ${m.role}${m.pending ? " live" : ""}`}
              >
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
          <div ref={bottomRef} />
        </div>

        {error && <div className="error-banner chat-error">{error}</div>}

        {inReview && profile && (
          <div className="chat-ready" ref={reviewRef}>
            <div className="cta-card nested">
              <p className="kicker">Personality evaluation</p>
              <h3>{locked ? "Locked in" : "Here’s the picture so far"}</h3>
              <p>
                {locked
                  ? "Scotty’s done. This is what we’ll use to find your team."
                  : "Does this look right? Yes and we’re done. If not, tell Scotty what to change."}
              </p>
              {notes.length > 0 && !locked && (
                <ul className="review-notes">
                  {notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}
              {!locked && (
                <button className="btn primary lg" type="button" onClick={() => finishInterview(profile)}>
                  Yes, find my team
                </button>
              )}
            </div>
            <ProfileCard profile={profile} compact />
          </div>
        )}

        {askingAvail && !voiceOn && (
          <div className="avail-composer">
            <AvailCalendar slots={availSlots} onToggle={toggleAvail} />
            <button className="btn ghost" type="button" disabled={busy || availSlots.length === 0} onClick={sendAvail}>
              Use these slots
            </button>
          </div>
        )}

        {!locked && (
        <div className="chat-composer">
          <p className="talk-live">{voiceHint}</p>
          <textarea
            ref={inputRef}
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onComposerKey}
            placeholder={
              phase === "confirm"
                ? "Yes, or tell me what to change…"
                : "e.g. I want an A, I code most nights, writing isn’t my thing…"
            }
            disabled={busy && !voiceOn}
          />
          <div className="composer-actions">
            <label className={`voice-switch${voiceOn ? " on" : ""}`}>
              <input
                type="checkbox"
                checked={voiceOn}
                onChange={(e) => void setVoiceEnabled(e.target.checked)}
              />
              <span className="voice-switch-track" aria-hidden="true" />
              <span className="voice-switch-label">Voice</span>
            </label>
            <button
              className="btn primary"
              type="button"
              disabled={!draft.trim() || (busy && !voiceOn)}
              onClick={() => void send()}
            >
              Send
            </button>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
