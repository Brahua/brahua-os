"use client";

import { useTheme } from "next-themes";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { brandHex } from "@/design-system/brand-colors";

const THEME_COLOR = { dark: brandHex("darkBackground"), light: brandHex("lightBackground") };

/**
 * The server renders one theme-color meta per system scheme (root `viewport`), but the app is dark
 * by default whatever the system says, and Ajustes can pin either theme. Once the theme is known,
 * every theme-color meta takes its color, so the browser bar (and Android's status bar in the
 * installed app) always matches the page. It runs again after each client navigation, in case
 * Next re-renders the head metas with the server's values.
 *
 * Not in next-themes' pre-paint script (it has no hook for it): until hydration, the metas follow
 * the system scheme.
 */
export function ThemeColorSync() {
  const { resolvedTheme } = useTheme();
  const pathname = usePathname();

  useEffect(() => {
    if (resolvedTheme !== "dark" && resolvedTheme !== "light") return;
    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
      meta.content = THEME_COLOR[resolvedTheme];
    }
  }, [resolvedTheme, pathname]);

  return null;
}
