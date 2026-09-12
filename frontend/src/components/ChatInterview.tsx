import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { CalendarDays, Mic, MicOff, Users } from "lucide-react";
import { sendChat } from "../api";
import { ChatBody } from "./ChatBody";
import Chip from "./Chip";
import PageIntro from "./PageIntro";
import TerminalChrome from "./TerminalChrome";
import { SkillBars, WeekCalendar } from "./WeekCalendar";
import { Button } from "./ui/button";
import {
  CONFLICT_LABELS,
  GOAL_LABELS,
  INTERVIEWER_NAME,
  ROLE_LABELS,
  courseSkillFields,
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
  const reviewRef = useRef<HTMLDivElement>(null);
  const pinThread = useRef(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const talkRef = useRef<TalkSession | null>(null);
  const ctx = toCourseContext(course);
  const skillFields = courseSkillFields(course);

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
    enterConfirm({
      ...raw,
      id: raw.id || "you",
      name,
      bio: raw.bio || nextMessages.filter((m) => m.role === "user").map((m) => m.content).join("\n"),
    });
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
  }, [messages, busy, profile]);

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
  // The opener lists "schedule" among the things he'll look for, so the topic alone is not
  // enough: he has to actually be asking before the week grid is any use.
  const askingAvail =
    lastAssistant.includes("?") &&
    /free to meet|can you meet|when you can meet|reliably meet|meet during|mornings|afternoons|evenings|schedule|availab|times? of day|what times|which times|windows/i.test(
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
        setError(`Let ${INTERVIEWER_NAME} finish, then send that.`);
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

  function sendAvail() {
    if (availSlots.length === 0) return;
    void send(availSlots.slice().sort().map(formatSlot).join(", "));
  }

  function onComposerKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
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
        ? `${INTERVIEWER_NAME} is talking. Mic paused so he isn’t interrupted.`
        : talkStatus === "listening"
          ? "Your turn. Speak, or type and he’ll answer out loud."
          : inReview
            ? "Voice is off for the review. Answer by text, or turn it back on."
            : "Voice off. Toggle on for a spoken back-and-forth.";

  return (
    <div className="space-y-6">
      <PageIntro
        kicker="How do you work?"
        title="A short conversation, then we match."
        body={`${INTERVIEWER_NAME}, a Grok powered AI assistant, runs this. Type anytime, or switch voice on for a spoken back-and-forth. Your answers stay private.`}
      />

      <TerminalChrome title={`chat with ${INTERVIEWER_NAME.toLowerCase()}`} bodyClassName="space-y-4 p-5 sm:p-7">
        <div
          className="max-h-[55vh] space-y-4 overflow-y-auto"
          ref={scroller}
          role="log"
          aria-live="polite"
          onScroll={onThreadScroll}
        >
          {messages
            .filter((m) => m.content.trim())
            .map((m, i) =>
              m.role === "assistant" ? (
                <div
                  key={m.voiceId ?? `${m.role}-${i}`}
                  className={`max-w-[90%] rounded-xl border bg-background/80 px-4 py-3 font-mono text-sm ${m.pending ? "border-primary/60" : ""}`}
                >
                  <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-primary">
                    {INTERVIEWER_NAME}
                  </span>
                  <ChatBody text={m.content} />
                  {m.pending && <span className="animate-pulse text-primary">▌</span>}
                </div>
              ) : (
                <div
                  key={m.voiceId ?? `${m.role}-${i}`}
                  className="ml-auto max-w-[86%] rounded-xl bg-primary px-4 py-3 font-mono text-sm text-primary-foreground"
                >
                  <ChatBody text={m.content} />
                </div>
              ),
            )}
          {busy && (
            <div className="max-w-[90%] rounded-xl border bg-background/80 px-4 py-3 font-mono text-sm text-muted-foreground">
              Thinking…
            </div>
          )}
        </div>

        {error && <p className="rounded-md bg-warn-soft p-3 font-mono text-sm text-warn">{error}</p>}

        {!inReview && askingAvail && !voiceOn && (
          <div className="border-t border-primary/20 pt-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="font-mono text-lg font-semibold tracking-[-0.03em]">Your week</h3>
                <p className="text-sm text-muted-foreground">Click the times you can reliably meet.</p>
              </div>
              <CalendarDays className="text-primary" />
            </div>
            <WeekCalendar
              slots={availSlots}
              onToggle={(slot) => setAvailSlots((cur) => (cur.includes(slot) ? cur.filter((s) => s !== slot) : [...cur, slot]))}
            />
            <Button className="mt-4" variant="outline" disabled={busy || availSlots.length === 0} onClick={sendAvail}>
              Use these slots
            </Button>
          </div>
        )}

        {!locked && (
          <div className="border-t border-primary/20 pt-4">
            <p className="mb-3 font-mono text-xs text-muted-foreground">{voiceHint}</p>
            <div className="flex gap-3">
              <span className="hidden items-center font-mono text-primary sm:flex">$</span>
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onComposerKey}
                placeholder={phase === "confirm" ? "Yes, or tell me what to change…" : "write a short answer…"}
                disabled={busy && !voiceOn}
                className="h-11 flex-1 rounded-md border border-primary/25 bg-background px-3 font-mono text-sm outline-none ring-ring focus-visible:ring-2"
              />
              <Button
                variant={voiceOn ? "default" : "outline"}
                aria-pressed={voiceOn}
                title={voiceOn ? "Turn voice off" : "Turn voice on"}
                onClick={() => void setVoiceEnabled(!voiceOn)}
              >
                {voiceOn ? <Mic /> : <MicOff />} voice
              </Button>
              <Button disabled={!draft.trim() || (busy && !voiceOn)} onClick={() => void send()}>
                send
              </Button>
            </div>
          </div>
        )}
      </TerminalChrome>

      {inReview && profile && (
        <div className="grid gap-5 md:grid-cols-[1fr_290px]" ref={reviewRef}>
          <section className="rounded-2xl border bg-card p-6 paper-shadow">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="kicker">Personality evaluation</div>
                <h2 className="mt-1 font-display text-2xl font-medium tracking-[-0.03em]">
                  {locked ? "Locked in" : "Here’s the picture so far"}
                </h2>
              </div>
              <Chip tone={locked ? "good" : "accent"}>{locked ? "Saved" : "Draft"}</Chip>
            </div>
            <dl className="mt-6 grid gap-5 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-bold uppercase text-muted-foreground">Goal</dt>
                <dd className="mt-1 text-lg font-semibold">{GOAL_LABELS[profile.goal]}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase text-muted-foreground">Hours</dt>
                <dd className="mt-1 text-lg font-semibold">{profile.hours} per week</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase text-muted-foreground">Team role</dt>
                <dd className="mt-1 text-lg font-semibold">{ROLE_LABELS[profile.role]}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase text-muted-foreground">Conflict style</dt>
                <dd className="mt-1 text-lg font-semibold">{CONFLICT_LABELS[profile.conflict_mode]}</dd>
              </div>
            </dl>
            <div className="mt-7 border-t pt-6">
              <p className="mb-4 font-semibold">Skill confidence</p>
              <SkillBars
                privateView
                skills={profile.skills}
                keys={skillFields.map((s) => s.key)}
                labels={course.skill_labels}
              />
            </div>
            <div className="mt-7 border-t pt-6">
              <p className="mb-4 font-semibold">When you can meet</p>
              <WeekCalendar slots={profile.availability} compact />
            </div>
          </section>

          <aside className="rounded-2xl border bg-foreground p-6 text-primary-foreground paper-shadow">
            <Users className="text-peach" />
            <h2 className="mt-8 font-display text-2xl font-medium tracking-[-0.03em]">
              {locked ? "Finding your team…" : "Does this look right?"}
            </h2>
            <p className="mt-2 text-sm opacity-75">
              {locked
                ? `${INTERVIEWER_NAME} is done. This is what we’ll use to find your team.`
                : `Yes and we’re done. If not, tell ${INTERVIEWER_NAME} what to change and he’ll fix it here.`}
            </p>
            {notes.length > 0 && !locked && (
              <ul className="mt-4 list-disc space-y-1 pl-4 text-sm opacity-75">
                {notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
            {!locked && (
              <Button
                size="lg"
                className="mt-6 w-full bg-card text-foreground hover:bg-accent-soft"
                onClick={() => finishInterview(profile)}
              >
                Yes, find my team <Users />
              </Button>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
