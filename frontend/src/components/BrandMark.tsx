interface Props {
  size?: "sm" | "md";
}

export default function BrandMark({ size = "md" }: Props) {
  return (
    <span className={`mark ${size}`} aria-hidden>
      C.
    </span>
  );
}
