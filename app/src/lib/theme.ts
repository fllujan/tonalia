export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

const STORAGE_KEY = "tonalia.theme";

export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

export function loadTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && (THEMES as readonly string[]).includes(stored)) return stored as Theme;
  } catch {
    // Storage unavailable: fall back to the system theme.
  }
  return "system";
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Ignore: the preference simply won't persist.
  }
  applyTheme(theme);
}
