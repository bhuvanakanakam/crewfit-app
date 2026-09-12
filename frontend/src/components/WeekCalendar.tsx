import { DAYS, SKILL_FIELDS, TIMES, type Skills } from "../types";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";

interface SkillBarsProps {
  privateView?: boolean;
  compact?: boolean;
  skills?: Skills | Record<string, number>;
  coverage?: string[];
  thin?: string[];
  labels?: Record<string, string>;
  keys?: string[];
}

export function SkillBars({ privateView, compact, skills, coverage, labels, keys }: SkillBarsProps) {
  const fields = keys?.length ? SKILL_FIELDS.filter((s) => keys.includes(s.key)) : SKILL_FIELDS;
  return (
    <div className={compact ? "space-y-1.5" : "space-y-3"}>
      {fields.map((s) => {
        const score = Number(skills?.[s.key] ?? 0);
        const covered = coverage ? coverage.includes(s.key) : score >= 4;
        const label = privateView ? `${score}/5` : covered ? "Covered" : "Thin";
        const strong = score >= 4 || (!privateView && covered);
        return (
          <div key={s.key}>
            <div className={cn("mb-1 flex items-center justify-between", compact ? "text-xs" : "text-sm")}>
              <span>{labels?.[s.key] || s.label}</span>
              <span className={cn("text-xs font-semibold", strong ? "text-good" : "text-muted-foreground")}>{label}</span>
            </div>
            <div className={cn("overflow-hidden rounded-full bg-muted", compact ? "h-1.5" : "h-2")}>
              <i
                className={cn("block h-full rounded-full", strong ? "bg-accent" : "bg-primary/25")}
                style={{ width: `${Math.max(0, Math.min(5, score)) * 20}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface WeekCalendarProps {
  slots: string[];
  onToggle?: (slot: string) => void;
  compact?: boolean;
}

export function WeekCalendar({ slots, onToggle, compact }: WeekCalendarProps) {
  const selected = new Set(slots);
  return (
    <div className="overflow-x-auto pb-1">
      <div className="grid min-w-[650px] grid-cols-7 gap-2">
        {DAYS.map((d, index) => (
          <div
            key={d.id}
            className={cn("rounded-xl border p-2", index > 4 ? "bg-secondary/60" : "bg-card")}
          >
            <header className="mb-2 text-center text-xs font-bold">{d.label}</header>
            <div className="space-y-1.5">
              {TIMES.map((t) => {
                const slot = `${d.id}_${t.id}`;
                const on = selected.has(slot);
                return (
                  <Button
                    key={slot}
                    type="button"
                    variant="ghost"
                    disabled={!onToggle}
                    aria-pressed={on}
                    aria-label={`${d.label} ${t.label} (${t.hint})`}
                    onClick={() => onToggle?.(slot)}
                    className={cn(
                      "h-auto w-full rounded-lg border px-1 py-2 text-center disabled:opacity-100",
                      compact && "py-1.5",
                      on
                        ? "border-primary bg-primary text-primary-foreground hover:bg-primary-strong hover:text-primary-foreground"
                        : "border-border bg-background text-muted-foreground hover:border-primary",
                    )}
                  >
                    <span className="flex flex-col">
                      <span className="text-[11px] font-bold">{t.label}</span>
                      {!compact && <span className="text-[9px] font-normal opacity-80">{t.hint}</span>}
                    </span>
                  </Button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
