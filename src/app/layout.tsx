import type { Metadata, Viewport } from "next";
import { ThemeProvider } from "@/design-system";
import { fontVariables } from "@/design-system/fonts";
import { brandHex } from "@/design-system/brand-colors";
import { APP_DESCRIPTION, APP_NAME } from "@/lib/pwa";
import { ThemeColorSync } from "@/modules/core/components/theme-color-sync";
import "./globals.css";

export const metadata: Metadata = {
  title: APP_NAME,
  description: APP_DESCRIPTION,
  applicationName: APP_NAME,
  // iOS: "Añadir a pantalla de inicio" opens standalone with this name. black-translucent: the
  // page draws under the status bar and, with viewport-fit=cover, env(safe-area-inset-top)
  // reports its real height (with "black", current iOS overlays the bar anyway but reports 0).
  // The strip behind the clock (white text) is painted below, always dark.
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: "black-translucent" },
};

// Browser chrome per system scheme before hydration; then ThemeColorSync follows the app's theme.
// viewport-fit=cover on every page (app, login, errors): each one pads itself with the safe-area
// insets (the shell's <main>, or `.bo-safe-area`), so none renders under the clock or the notch.
export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: brandHex("darkBackground") },
    { media: "(prefers-color-scheme: light)", color: brandHex("lightBackground") },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // next-themes sets data-theme before hydration, so the attribute differs from the server HTML.
    <html lang="es" className={`${fontVariables} h-full antialiased`} suppressHydrationWarning>
      <body className="flex min-h-full flex-col">
        <ThemeProvider>
          <ThemeColorSync />
          {/* Behind the iOS status bar in the installed app, so content never shows under it. */}
          <div aria-hidden="true" className="bo-status-bar-backdrop" />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
