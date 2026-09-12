import { useEffect, useRef, useState } from "react";
import { Bell, X } from "lucide-react";
import { listNotifications, markNotificationsRead, resolveConcern } from "../api";
import type { NotificationRecord } from "../types";
import Chip from "./Chip";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";

interface Props {
  courseId: string;
  name: string;
  role: "student" | "teacher";
  onOpenStudent?: (name: string) => void;
  onOpenTeam?: () => void;
  onChanged?: () => void;
}

const KIND_LABEL: Record<NotificationRecord["kind"], string> = {
  concern: "Flag",
  pref_update: "Prefs",
  score_drop: "Fit drop",
  rematch: "Rematch",
  team: "Team",
  staff: "Roster",
};

function relTime(iso: string) {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export default function NotifyMenu({ courseId, name, role, onOpenStudent, onOpenTeam, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRecord[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  async function refresh() {
    try {
      const res = await listNotifications(courseId, name, role);
      setItems(res.notifications);
    } catch {
      /* keep last list */
    }
  }

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 12000);
    return () => window.clearInterval(id);
  }, [courseId, name, role]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, courseId, name, role]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const unread = items.filter((n) => !n.read);

  async function markRead(ids: string[]) {
    const pending = ids.filter(Boolean);
    if (pending.length === 0) return;
    setItems((cur) => cur.map((n) => (pending.includes(n.id) ? { ...n, read: true } : n)));
    await markNotificationsRead(pending).catch(() => undefined);
  }

  async function decide(n: NotificationRecord, status: "approved" | "denied") {
    const who = n.student || n.to_name;
    if (!who) return;
    setBusy(`${n.id}:${status}`);
    try {
      await resolveConcern(who, courseId, status);
      await markRead([n.id]);
      await refresh();
      onChanged?.();
    } finally {
      setBusy(null);
    }
  }

  const warn = (n: NotificationRecord) => n.kind === "concern" || n.kind === "score_drop";

  return (
    <div className="relative" ref={wrap}>
      <Button
        variant="ghost"
        size="icon"
        className="relative"
        aria-label={unread.length ? `${unread.length} notifications` : "Notifications"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Bell />
        {unread.length > 0 && (
          <span className="absolute right-1 top-1 grid size-4 place-items-center rounded-full bg-coral text-[10px] text-white">
            {unread.length > 9 ? "9+" : unread.length}
          </span>
        )}
      </Button>

      {open && (
        <aside className="fixed right-3 top-[5.75rem] z-50 w-[calc(100%-1.5rem)] max-w-[380px] overflow-hidden rounded-2xl border bg-card paper-shadow sm:right-6">
          <div className="flex items-center justify-between border-b p-5">
            <div>
              <div className="kicker">This course</div>
              <h2 className="font-display text-xl font-medium tracking-[-0.03em]">Notifications</h2>
            </div>
            <Button variant="ghost" size="icon" aria-label="Close notifications" onClick={() => setOpen(false)}>
              <X />
            </Button>
          </div>
          <div className="max-h-[520px] overflow-y-auto p-2">
            {items.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">Nothing new.</p>
            ) : (
              items.map((n) => (
                <Button
                  key={n.id}
                  variant="ghost"
                  className="h-auto w-full items-start justify-start whitespace-normal rounded-xl p-3 text-left"
                  onClick={() => {
                    void markRead([n.id]);
                    if (role === "teacher" && warn(n) && (n.student || n.to_name)) {
                      onOpenStudent?.(n.student || n.to_name);
                    } else {
                      onOpenTeam?.();
                    }
                    setOpen(false);
                  }}
                >
                  <span className={cn("mt-1 block size-2 shrink-0 rounded-full", warn(n) ? "bg-warn" : "bg-primary")} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <Chip tone={warn(n) ? "warn" : "accent"}>{KIND_LABEL[n.kind] ?? n.kind}</Chip>
                      <span className="text-xs font-normal text-muted-foreground">{relTime(n.created_at)}</span>
                    </span>
                    <strong className="mt-2 block font-semibold">{n.title}</strong>
                    <span className="mt-0.5 block text-sm font-normal text-muted-foreground">{n.body}</span>
                    {role === "teacher" && warn(n) && n.student && (
                      <span className="mt-3 flex gap-2">
                        <span
                          className="rounded-full bg-primary px-3 py-1 text-xs text-primary-foreground"
                          onClick={(e) => {
                            e.stopPropagation();
                            void decide(n, "approved");
                          }}
                        >
                          {busy === `${n.id}:approved` ? "…" : "Approve rematch"}
                        </span>
                        <span
                          className="rounded-full border px-3 py-1 text-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            void decide(n, "denied");
                          }}
                        >
                          Dismiss
                        </span>
                      </span>
                    )}
                  </span>
                </Button>
              ))
            )}
          </div>
        </aside>
      )}
    </div>
  );
}
