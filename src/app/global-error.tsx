"use client";

import { useLayoutEffect } from "react";
import { fontVariables } from "@/design-system/fonts";
import { ErrorScreen, type ErrorScreenProps } from "@/modules/core/components/error-screen";
import { storedTheme } from "@/lib/stored-theme";
import "./globals.css";

/**
 * Last resort: an error in the root layout, which this replaces. It brings its own document,
 * styles and fonts, and no ThemeProvider: it renders dark (the default) and, once it runs in the
 * browser, switches to the stored theme. A server-rendered page in the light theme can show dark
 * for a moment first; acceptable for a page that should almost never appear. The title comes
 * from ErrorScreen. Errors anywhere else render in `error.tsx`, inside the layout.
 *
 * It also replaces the root layout's viewport (no metadata API here), so it declares
 * `viewport-fit=cover` itself (React hoists the <meta> into <head>) and paints the same dark strip
 * behind the iOS status bar as the root layout.
 */
export default function GlobalError({ error, retry }: ErrorScreenProps) {
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = storedTheme();
  }, []);

  return (
    // The stored theme is applied on the client, so the attribute can differ from the server HTML.
    <html
      lang="es"
      data-theme="dark"
      className={`${fontVariables} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col">
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <div aria-hidden="true" className="bo-status-bar-backdrop" />
        <main className="bo-safe-area flex flex-1 flex-col">
          <ErrorScreen error={error} retry={retry} />
        </main>
      </body>
    </html>
  );
}
