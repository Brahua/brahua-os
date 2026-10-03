"use client";

import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToaster, type Toaster } from "@/lib/toast/use-toaster";
import { useSaveQueue, type Enqueue } from "@/lib/use-save-queue";
import { ToastViewport } from "./toast-viewport";
import { useDayRollover } from "./use-day-rollover";

// What a screen shares with every part on it, whatever module the part comes from: one save
// queue, one notice viewport and one polite announcer per screen (CLAUDE.md: notices never pile
// up in two viewports). Parts that another module contributes to a screen (e.g. the "Tareas"
// section of a project's page, T5 of `tasks`) read it here instead of importing the host's own
// context, so neither module imports the other.

export type ScreenServices = {
  /** The screen's save queue (src/lib/use-save-queue.ts). Call it inside startTransition. */
  enqueue: Enqueue;
  /** The screen's notice queue: "Deshacer" and "Sin guardar" notices. */
  toaster: Toaster;
  /** Says something politely to screen readers. */
  announce: (message: string) => void;
  /**
   * Only on a screen read for one Lima day (the provider got `day`): whether that day is still
   * today. If it changed, the screen is read again once (`useDayRollover`) and this says false,
   * so a part must not log the day before. Parts on such a screen (e.g. habits' pads on the
   * `today` board) use it instead of watching the day themselves: one refresh, one announcement.
   */
  isCurrentDay?: () => boolean;
};

export const ScreenServicesContext = createContext<ScreenServices | null>(null);

/** The screen's queue, notices and announcer, or null outside a screen that offers them. */
export function useScreenServices(): ScreenServices | null {
  return use(ScreenServicesContext);
}

/** Like `useScreenServices`, for parts that only make sense inside such a screen. */
export function useRequiredScreenServices(): ScreenServices {
  const value = use(ScreenServicesContext);
  if (!value) throw new Error("useRequiredScreenServices must be used inside a screen provider");
  return value;
}

/** A polite announcer: cleared first, so the same message twice is read twice. */
export function useAnnouncer(): [string, (message: string) => void] {
  const [announcement, setAnnouncement] = useState("");
  const timer = useRef<number | undefined>(undefined);
  // Unmounted (the screen left): no update of a gone component.
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const announce = useCallback((message: string) => {
    setAnnouncement("");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setAnnouncement(message), 50);
  }, []);
  return [announcement, announce];
}

type ScreenServicesProviderProps = {
  /** Name of the notices region ("Avisos de proyectos"). */
  label: string;
  /** Read after a notice with an action: how to undo without hunting. */
  actionHint: string;
  /**
   * The Lima day (YYYY-MM-DD) the screen was read for, on screens that show "today": the
   * provider then watches the day (`useDayRollover`), reads the screen again once when it
   * changes (announcing `changedMessage`) and offers `isCurrentDay` to its parts.
   */
  day?: { today: string; changedMessage: string };
  children: React.ReactNode;
};

/**
 * Gives a screen its save queue, notice viewport and announcer (for screens without a provider
 * of their own, like the projects list).
 */
export function ScreenServicesProvider({
  label,
  actionHint,
  day,
  children,
}: ScreenServicesProviderProps) {
  const toaster = useToaster();
  const enqueue = useSaveQueue();
  const [announcement, announce] = useAnnouncer();
  const watchesDay = day !== undefined;
  const isCurrentDay = useDayRollover(day?.today ?? null, announce, day?.changedMessage ?? "");
  const value = useMemo<ScreenServices>(
    () => ({ enqueue, toaster, announce, ...(watchesDay ? { isCurrentDay } : {}) }),
    [enqueue, toaster, announce, watchesDay, isCurrentDay],
  );
  return (
    <ScreenServicesContext value={value}>
      {children}
      <p role="status" aria-live="polite" className="sr-only" data-screen-announcer="">
        {announcement}
      </p>
      <ToastViewport toaster={toaster} label={label} actionHint={actionHint} />
    </ScreenServicesContext>
  );
}
