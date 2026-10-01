"use client";

import { useEffect } from "react";
import { authClient } from "@/lib/auth-client";

/**
 * Keeps the 30-day session alive while the app is in use. Server Components only read the
 * session (they cannot set cookies), so the browser asks the auth handler once per app load:
 * when the session is older than a day, the handler extends it and re-sets the cookie.
 */
export function SessionRefresher() {
  useEffect(() => {
    // Best effort: if it fails, the next load tries again and the server check still applies.
    authClient.getSession().catch(() => {});
  }, []);
  return null;
}
