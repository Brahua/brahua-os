"use client";

import { useEffect } from "react";

/**
 * Keeps the 30-day session alive while the app is in use. Server Components only read the
 * session (they cannot set cookies), so the browser asks the auth handler once per app load:
 * when the session is older than a day, the handler extends it and re-sets the cookie.
 */
export function SessionRefresher() {
  useEffect(() => {
    // Best effort: if it fails, the next load tries again and the server check still applies.
    // Loaded here, after hydration: the root 404 ships the shell's client code with every page,
    // /login included, and the auth client is not needed for the first paint.
    import("@/lib/auth-client").then(({ authClient }) => authClient.getSession()).catch(() => {});
  }, []);
  return null;
}
