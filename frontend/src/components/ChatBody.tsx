export function ChatBody({ text }: { text: string }) {
  const blocks = (text ?? "").trim().split(/\n{2,}/);
  if (!blocks[0]) return null;
  return (
    <>
      {blocks.map((block, i) => {
        const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
        const listed = lines.length > 1 && lines.every((l) => /^[-•*]/.test(l) || /:\s+\S/.test(l));
        if (listed) {
          return (
            <ul key={i} className="mt-1 list-disc space-y-1 pl-4">
              {lines.map((line) => (
                <li key={line}>{line.replace(/^[-•*]\s*/, "")}</li>
              ))}
            </ul>
          );
        }
        return <p key={i}>{block}</p>;
      })}
    </>
  );
}
