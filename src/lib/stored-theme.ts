/** Same storage key next-themes uses (see the design system's ThemeProvider). */
export const THEME_STORAGE_KEY = "theme";

/**
 * The theme the owner chose, read without next-themes (for `global-error.tsx`, which replaces the
 * root layout and its ThemeProvider). Dark, the default, on any doubt.
 */
export function storedTheme(): "dark" | "light" {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light") return "light";
    if (stored === "system" && matchMedia("(prefers-color-scheme: light)").matches) return "light";
  } catch {
    // Storage blocked: keep the default.
  }
  return "dark";
}
