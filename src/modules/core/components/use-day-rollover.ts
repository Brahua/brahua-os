"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { ownerDateKey } from "@/lib/time";

/** How often an open screen checks whether Lima's day changed (also on becoming visible). */
export const DAY_CHECK_MS = 60_000;

/**
 * Keeps a screen read for Lima's day `today` (YYYY-MM-DD) current: when the day changes while it
 * is open (left open past midnight, the installed app resumed in the morning), the page is read
 * again (`router.refresh()`) once and `message` is announced. Checked every minute and whenever
 * the page becomes visible. Returns `isCurrentDay()`: false (after starting the refresh) when the
 * day already changed, so the caller doesn't log the day before by mistake.
 *
 * `today` null: off (another part of the screen already watches the day), and `isCurrentDay`
 * always says true. Used by `ScreenServicesProvider` (a host screen, e.g. `today`'s board) and by
 * `habits`' screens.
 */
export function useDayRollover(
  today: string | null,
  announce: (message: string) => void,
  message: string,
): () => boolean {
  const router = useRouter();
  const refreshed = useRef<string | null>(null);

  const isCurrentDay = useCallback(() => {
    if (today === null) return true;
    const now = ownerDateKey(new Date());
    if (now === today) return true;
    if (refreshed.current !== now) {
      refreshed.current = now;
      announce(message);
      router.refresh();
    }
    return false;
  }, [today, announce, message, router]);

  useEffect(() => {
    if (today === null) return;
    const check = () => {
      if (document.visibilityState === "visible") isCurrentDay();
    };
    const timer = window.setInterval(check, DAY_CHECK_MS);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("pageshow", check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("pageshow", check);
    };
  }, [today, isCurrentDay]);

  return isCurrentDay;
}
