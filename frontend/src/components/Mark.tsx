import { cn } from "../lib/utils";

interface Props {
  compact?: boolean;
  className?: string;
}

export default function Mark({ compact, className }: Props) {
  return (
    <span className={cn("flex items-center gap-3", className)}>
      <span
        className={cn(
          "relative grid place-items-center border border-primary bg-background font-mono font-semibold leading-none text-primary",
          compact ? "size-10 text-lg" : "size-11 text-xl",
        )}
        aria-hidden
      >
        <span className="absolute left-1 top-0.5 font-mono text-[8px] font-semibold text-primary/55">$</span>
        S
      </span>
      {!compact && (
        <span className="font-mono text-2xl font-semibold tracking-[-0.04em]">
          squadly<span className="term-cursor" aria-hidden />
        </span>
      )}
    </span>
  );
}
