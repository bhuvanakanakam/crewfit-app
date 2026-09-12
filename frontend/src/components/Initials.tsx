import { cn } from "../lib/utils";

interface Props {
  name: string;
  className?: string;
}

export default function Initials({ name, className }: Props) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? parts[0]?.[1] ?? ""}`.toUpperCase() || "?";
  return (
    <span
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-full bg-secondary text-[11px] font-bold tracking-wide text-secondary-foreground",
        className,
      )}
      aria-hidden
    >
      {letters}
    </span>
  );
}
