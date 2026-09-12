import { cn } from "../lib/utils";

interface Props {
  label: string;
  hint?: string;
  on: boolean;
  onClick: () => void;
}

export default function SkillToggle({ label, hint, on, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "min-h-10 min-w-24 rounded-lg border px-3 py-2 text-left transition-colors",
        on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:border-foreground",
      )}
    >
      <span className="block text-sm font-semibold">{label}</span>
      {hint ? <span className={cn("mt-0.5 block text-xs", on ? "opacity-80" : "text-muted-foreground")}>{hint}</span> : null}
    </button>
  );
}
