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
        <main className="flex flex-1 flex-col">
          <ErrorScreen error={error} retry={retry} />
        </main>
      </body>
    </html>
  );
}
