import { useEffect, useRef, useState } from "react";
import { listNotifications, markNotificationsRead, resolveConcern } from "../api";
import type { NotificationRecord } from "../types";

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

  return (
    <div className="header-notify" ref={wrap}>
      <button
        type="button"
        className={`notify-btn${open ? " open" : ""}`}
        aria-label={unread.length ? `${unread.length} notifications` : "Notifications"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M6 9a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9Z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <path d="M10 20a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        {unread.length > 0 && <span className="notify-badge">{unread.length}</span>}
      </button>

      {open && (
        <div className="notify-panel" role="menu" aria-label="Notifications">
          <div className="notify-head">Notifications</div>
          {items.length === 0 ? (
            <p className="notify-empty">Nothing new.</p>
          ) : (
            items.map((n) => (
              <article className={`notify-item${n.read ? " read" : ""}`} key={n.id}>
                <button
                  type="button"
                  className="notify-body"
                  onClick={() => {
                    void markRead([n.id]);
                    if (role === "teacher" && (n.student || n.to_name)) {
                      onOpenStudent?.(n.student || n.to_name);
                    } else {
                      onOpenTeam?.();
                    }
                    setOpen(false);
                  }}
                >
                  <span className={`notify-kind ${n.kind}`}>{KIND_LABEL[n.kind] ?? n.kind}</span>
                  <strong>{n.title}</strong>
                  <p>{n.body}</p>
                </button>
                {role === "teacher" && (n.kind === "concern" || n.kind === "score_drop") && n.student && (
                  <div className="notify-actions">
                    <button
                      type="button"
                      className="btn primary"
                      disabled={busy !== null}
                      onClick={() => void decide(n, "approved")}
                    >
                      {busy === `${n.id}:approved` ? "…" : "Approve rematch"}
                    </button>
                    <button
                      type="button"
                      className="btn ghost"
                      disabled={busy !== null}
                      onClick={() => void decide(n, "denied")}
                    >
                      Dismiss
                    </button>
                  </div>
                )}
              </article>
            ))
          )}
        </div>
      )}
    </div>
  );
}
