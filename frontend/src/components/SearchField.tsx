import { Search } from "lucide-react";

interface Props {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export default function SearchField({ id = "search", value, onChange, placeholder = "Search" }: Props) {
  return (
    <label htmlFor={id} className="relative block min-w-0 flex-1">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-11 w-full rounded-xl border-0 bg-background pl-10 pr-4 text-sm outline-none ring-ring focus-visible:ring-2"
      />
    </label>
  );
}
