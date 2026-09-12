interface Props {
  label: string;
  value: string | number;
  hint?: string;
}

export default function StatCard({ label, value, hint }: Props) {
  return (
    <article className="relative overflow-hidden rounded-xl border bg-card px-5 py-4">
      <span className="absolute inset-x-0 top-0 h-0.5 bg-accent" />
      <p className="kicker">{label}</p>
      <p className="mt-2 font-display text-3xl font-medium tracking-[-0.04em]">{value}</p>
      {hint ? <p className="mt-1 text-sm text-muted-foreground">{hint}</p> : null}
    </article>
  );
}
