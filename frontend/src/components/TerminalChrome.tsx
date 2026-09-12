import type { ReactNode } from "react";
import { cn } from "../lib/utils";

interface Props {
  title?: string;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}

export default function TerminalChrome({ title = "session@squadly", className, bodyClassName, children }: Props) {
  return (
    <div className={cn("overflow-hidden rounded-md border border-primary/35 bg-card paper-shadow", className)}>
      <div className="flex items-center gap-2 border-b border-primary/20 px-3 py-2 font-mono text-[11px] text-primary">
        <span className="size-2 rounded-full bg-primary/80" aria-hidden />
        <span className="truncate">{title}</span>
      </div>
      <div className={bodyClassName}>{children}</div>
    </div>
  );
}
