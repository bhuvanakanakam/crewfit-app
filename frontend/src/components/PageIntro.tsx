interface Props {
  kicker: string;
  title: string;
  body?: string;
}

export default function PageIntro({ kicker, title, body }: Props) {
  return (
    <div>
      <div className="kicker mb-2">
        <span className="text-primary/70">$</span> {kicker}
      </div>
      <h1 className="page-title">{title}</h1>
      {body ? <p className="mt-2 max-w-2xl text-muted-foreground">{body}</p> : null}
    </div>
  );
}
