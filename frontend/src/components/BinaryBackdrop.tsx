import { useMemo } from "react";

function field(seed: number, rows: number, cols: number) {
  let x = seed;
  const lines: string[] = [];
  for (let r = 0; r < rows; r += 1) {
    let line = "";
    for (let c = 0; c < cols; c += 1) {
      x = (x * 1664525 + 1013904223) >>> 0;
      line += x & 1 ? "1" : "0";
      if (c % 8 === 7) line += " ";
    }
    lines.push(line);
  }
  return lines.join("\n");
}

export default function BinaryBackdrop() {
  const text = useMemo(() => field(2026, 48, 160), []);
  return (
    <pre
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden whitespace-pre p-3 font-mono text-[11px] leading-5 text-primary/[0.16] select-none [mask-image:radial-gradient(ellipse_at_center,black_18%,transparent_78%)]"
    >
      {text}
    </pre>
  );
}
