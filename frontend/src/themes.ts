export const THEME_IDS = ["day", "dusk", "overcast"] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export const THEMES: {
  id: ThemeId;
  name: string;
  blurb: string;
}[] = [
  { id: "day", name: "Afternoon", blurb: "Quiet quad, late light." },
  { id: "dusk", name: "Dusk", blurb: "Warm sky over the buildings." },
  { id: "overcast", name: "Overcast", blurb: "Soft gray afternoon." },
];

const STORAGE_KEY = "squadly.theme";

export function isThemeId(value: string | null | undefined): value is ThemeId {
  return Boolean(value && THEME_IDS.includes(value as ThemeId));
}

export function applyTheme(id: ThemeId) {
  document.documentElement.dataset.theme = id;
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
}

export function loadTheme(): ThemeId {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isThemeId(stored)) return stored;
  } catch {
    /* ignore */
  }
  return "day";
}
