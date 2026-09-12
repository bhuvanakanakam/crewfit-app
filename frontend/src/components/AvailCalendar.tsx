import { DAYS, TIMES } from "../types";

interface Props {
  slots: string[];
  onToggle?: (slot: string) => void;
  compact?: boolean;
}

export default function AvailCalendar({ slots, onToggle, compact }: Props) {
  const selected = new Set(slots);
  const interactive = Boolean(onToggle);

  return (
    <div className={`week${compact ? " compact" : ""}${interactive ? " interactive" : ""}`} role="grid" aria-label="Weekly availability">
      {DAYS.map((d) => (
        <div className={`week-day${d.id === "sat" || d.id === "sun" ? " weekend" : ""}`} key={d.id} role="row">
          <header>{d.label}</header>
          {TIMES.map((t) => {
            const slot = `${d.id}_${t.id}`;
            const on = selected.has(slot);
            const label = `${d.label} ${t.label} (${t.hint})`;
            if (interactive) {
              return (
                <button
                  key={slot}
                  type="button"
                  className={`week-slot${on ? " on" : ""}`}
                  aria-pressed={on}
                  aria-label={label}
                  onClick={() => onToggle?.(slot)}
                >
                  <strong>{t.label}</strong>
                  <span>{t.hint}</span>
                </button>
              );
            }
            return (
              <div key={slot} className={`week-slot${on ? " on" : ""}`} title={on ? label : undefined}>
                <strong>{t.label}</strong>
                <span>{t.hint}</span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
