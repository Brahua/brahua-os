"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

export const THEMES = ["dark", "light"] as const;
export type Theme = (typeof THEMES)[number];

/** Dark by default; "system" follows the OS. The theme is exposed as `data-theme` on <html>. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="data-theme"
      themes={[...THEMES]}
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
