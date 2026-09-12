import type { ReactNode } from "react";
import { cn } from "../lib/utils";

interface Props {
  wide?: boolean;
  left: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
}

export default function TopBar({ wide, left, center, right }: Props) {
  const split = Boolean(center || right);
  return (
    <header className="sticky top-0 z-40 px-4 pt-4 sm:px-6">
      <div className={cn("mx-auto", wide ? "max-w-[1440px]" : "max-w-[1080px]")}>
        <div
          className={cn(
            "min-h-[5rem] items-center rounded-xl border bg-card px-5 py-3 paper-shadow md:px-6",
            split
              ? "grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:gap-8"
              : "flex",
          )}
        >
          <div className="flex min-w-0 items-center justify-self-start">{left}</div>
          {center ? <div className="justify-self-center">{center}</div> : split ? <div className="hidden md:block" /> : null}
          {right ? <div className="flex flex-wrap items-center justify-end gap-3 justify-self-end">{right}</div> : null}
        </div>
      </div>
    </header>
  );
}
