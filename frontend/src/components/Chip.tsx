import { cn } from "../lib/utils";

interface Props {
  children: React.ReactNode;
  tone?: "default" | "good" | "warn" | "accent";
  size?: "md" | "sm";
  className?: string;
}

export default function Chip({ children, tone = "default", size = "md", className }: Props) {
  return (
    <span
      className={cn(
        "inline-flex items-center font-mono font-semibold tracking-wide",
        size === "sm" ? "rounded px-1.5 py-0.5 text-[10px] font-medium tracking-normal" : "rounded-md px-3 py-1.5 text-sm",
        tone === "good" && "bg-good-soft text-good",
        tone === "warn" && "bg-warn-soft text-warn",
        tone === "accent" && "bg-primary text-primary-foreground",
        tone === "default" && "bg-muted text-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}
