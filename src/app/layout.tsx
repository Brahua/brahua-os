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
  // iOS: "Añadir a pantalla de inicio" opens standalone with this name. The status bar is opaque
  // black: it suits the dark default and stays legible in the light theme (black-translucent would
  // put white text over the light background).
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: "black" },
};

// Browser chrome per system scheme before hydration; then ThemeColorSync follows the app's theme.
export const viewport: Viewport = {
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
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
