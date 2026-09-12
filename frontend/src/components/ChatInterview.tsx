import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { CalendarDays, Users } from "lucide-react";
import { sendChat } from "../api";
import { ChatBody } from "./ChatBody";
import PageIntro from "./PageIntro";
import TerminalChrome from "./TerminalChrome";
import { WeekCalendar } from "./WeekCalendar";
import { Button } from "./ui/button";
import {
  GOAL_LABELS,
  ROLE_LABELS,
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
  const inputRef = useRef<HTMLInputElement>(null);
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
  const askingAvail = /free to meet|when you can meet|mornings, afternoons|evenings|reliably meet/i.test(lastAssistant);

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

  return (
    <div className="space-y-6">
      <PageIntro
        kicker="How do you work?"
        title="A short conversation, then we match."
        body="Your answers stay private. Teammates only see names and shared facts."
      />

      <TerminalChrome title="chat" bodyClassName="space-y-4 p-5 sm:p-7">
        <div className="space-y-4" ref={scroller} role="log" aria-live="polite">
          {messages.map((m, i) =>
            m.role === "assistant" ? (
              <div key={i} className="max-w-[90%] rounded-xl border bg-background/80 px-4 py-3 font-mono text-sm">
                <ChatBody text={m.content} />
              </div>
            ) : (
              <div key={i} className="ml-auto max-w-[86%] rounded-xl bg-primary px-4 py-3 font-mono text-sm text-primary-foreground">
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

        {!profile && askingAvail && (
          <div className="border-t border-primary/20 pt-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="font-mono text-lg font-semibold tracking-[-0.03em]">Your week</h3>
                <p className="text-sm text-muted-foreground">Click the times you can reliably meet.</p>
              </div>
              <CalendarDays className="text-primary" />
            </div>
            <WeekCalendar slots={availSlots} onToggle={(slot) => setAvailSlots((cur) => (cur.includes(slot) ? cur.filter((s) => s !== slot) : [...cur, slot]))} />
            <Button className="mt-4" variant="outline" disabled={busy || availSlots.length === 0} onClick={sendAvail}>
              Use these slots
            </Button>
          </div>
        )}

        {!profile && (
          <div className="border-t border-primary/20 pt-4">
            <div className="flex gap-3">
              <span className="hidden items-center font-mono text-primary sm:flex">$</span>
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onComposerKey}
                placeholder="write a short answer…"
                disabled={busy}
                className="h-11 flex-1 rounded-md border border-primary/25 bg-background px-3 font-mono text-sm outline-none ring-ring focus-visible:ring-2"
              />
              <Button disabled={!draft.trim() || busy} onClick={() => void send()}>
                send
              </Button>
            </div>
          </div>
        )}
      </TerminalChrome>

      {profile && (
        <div className="rounded-md border border-primary bg-accent-soft p-6 sm:flex sm:items-center sm:justify-between">
          <div>
            <div className="kicker">Ready to match</div>
            <h2 className="mt-1 font-mono text-2xl font-semibold tracking-[-0.03em]">Your working style is saved.</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {profile.hours} hours · {GOAL_LABELS[profile.goal]} · {ROLE_LABELS[profile.role]}
            </p>
          </div>
          <Button size="lg" className="mt-5 w-full sm:mt-0 sm:w-auto" onClick={() => onReady(profile)}>
            Find my team <Users />
          </Button>
        </div>
      )}
    </div>
  );
}
