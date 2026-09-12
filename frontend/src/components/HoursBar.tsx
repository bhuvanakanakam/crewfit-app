interface Props {
  hours: number;
  max?: number;
}

export default function HoursBar({ hours, max = 16 }: Props) {
  const pct = Math.max(8, Math.min(100, (hours / max) * 100));
  return (
    <span className="inline-flex min-w-28 items-center gap-2">
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <i className="block h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </span>
      <span className="w-8 text-right text-sm font-semibold">{hours}h</span>
    </span>
  );
}
