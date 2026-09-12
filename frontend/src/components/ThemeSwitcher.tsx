import { useState } from "react";
import { applyTheme, loadTheme, THEMES, type ThemeId } from "../themes";
import { cn } from "../lib/utils";

interface Props {
  className?: string;
}

export default function ThemeSwitcher({ className }: Props) {
  const [active, setActive] = useState<ThemeId>(loadTheme);

  return (
    <div className={cn("flex items-center gap-1.5", className)} role="radiogroup" aria-label="Theme">
      {THEMES.map((theme) => (
        <button
          key={theme.id}
          type="button"
          role="radio"
          aria-checked={active === theme.id}
          aria-label={theme.name}
          title={theme.name}
          data-theme={theme.id}
          onClick={() => {
            applyTheme(theme.id);
            setActive(theme.id);
          }}
          className={cn(
            "size-3.5 rounded-sm border border-primary/50 bg-primary",
            active === theme.id ? "ring-2 ring-foreground ring-offset-2 ring-offset-background" : "opacity-55 hover:opacity-100",
          )}
        />
      ))}
    </div>
  );
}
