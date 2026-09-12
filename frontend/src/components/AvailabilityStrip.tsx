import { DAYS, TIMES } from "../types";
import { cn } from "../lib/utils";

interface Props {
  slots: string[];
}

export default function AvailabilityStrip({ slots }: Props) {
  const selected = new Set(slots);
  return (
    <div className="grid grid-cols-7 gap-1.5">
      {DAYS.map((d) => (
        <div key={d.id} className="rounded-lg bg-muted/80 px-1 py-2 text-center">
          <div className="text-[10px] font-bold uppercase tracking-wide">{d.label}</div>
          <div className="mt-1.5 space-y-1">
            {TIMES.map((t) => {
              const on = selected.has(`${d.id}_${t.id}`);
              return (
                <span
                  key={t.id}
                  title={`${d.label} ${t.label}`}
                  className={cn("block h-1.5 rounded-full", on ? "bg-primary" : "bg-background")}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
