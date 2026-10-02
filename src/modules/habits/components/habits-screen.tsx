"use client";

import { createContext, use, useMemo } from "react";
import { useToaster, type Toaster } from "@/lib/toast/use-toaster";
import { useSaveQueue, type Enqueue } from "@/lib/use-save-queue";
import { useAnnouncer, useRequiredScreenServices } from "@/modules/core/components/screen-services";
import { ToastViewport } from "@/modules/core/components/toast-viewport";
import type { HabitAreaSummary } from "../habit-input";
import { HABITS_COPY } from "../habits-copy";

// ── Shared by every part of a habits screen (the pads, the sheets, H2–H5's sections) ──

export type HabitsScreenValue = {
  /** The Lima day the page was read for (YYYY-MM-DD): what a tap logs. */
  today: string;
  /** The active life areas, in their order (the create form's picker). */
  areas: readonly HabitAreaSummary[];
  /**
   * The screen's one save queue (src/lib/use-save-queue.ts): calls run in order, and a call whose
   * turn comes after a newer one with the same key is skipped. Keys in use: `habit-day:<id>:<day>`
   * (logging a day) and `habit-delete:<id>`. Each part uses its own (H2 `habit-order`,
   * `habit-archive:<id>`; H3 `habit-qty:<id>:<day>`; H4 `habit-pause:<id>`…) and keeps its own
   * useOptimistic; call it inside startTransition.
   */
  enqueue: Enqueue;
  /** The screen's notice queue (one viewport per screen): "Deshacer" and "Sin guardar". */
  toaster: Toaster;
  /** Says something politely to screen readers. */
  announce: (message: string) => void;
};

const HabitsScreenContext = createContext<HabitsScreenValue | null>(null);

/** The screen's day, areas, save queue, notices and announcer. */
export function useHabitsScreen(): HabitsScreenValue {
  const value = use(HabitsScreenContext);
  if (!value) throw new Error("useHabitsScreen must be used inside HabitsScreen");
  return value;
}

type HabitsScreenProps = {
  today: string;
  areas: readonly HabitAreaSummary[];
  children: React.ReactNode;
};

/**
 * Wraps a habits screen (/habits; H5: each habit's page): one save queue, one notice viewport and
 * one polite announcer for everything on it.
 */
export function HabitsScreen({ today, areas, children }: HabitsScreenProps) {
  const toaster = useToaster();
  const enqueue = useSaveQueue();
  const [announcement, announce] = useAnnouncer();

  const value = useMemo<HabitsScreenValue>(
    () => ({ today, areas, enqueue, toaster, announce }),
    [today, areas, enqueue, toaster, announce],
  );

  return (
    <HabitsScreenContext value={value}>
      {children}
      <p role="status" aria-live="polite" className="sr-only" data-habits-announcer="">
        {announcement}
      </p>
      <ToastViewport
        toaster={toaster}
        label={HABITS_COPY.noticesLabel}
        actionHint={HABITS_COPY.undoHint}
      />
    </HabitsScreenContext>
  );
}

type HabitsScreenWithinProps = {
  today: string;
  areas: readonly HabitAreaSummary[];
  children: React.ReactNode;
};

/**
 * Habits parts on another module's screen (H6: `today`'s board): the same context as
 * `HabitsScreen`, but with the host screen's save queue, notices and announcer
 * (`ScreenServicesContext` from `core`), so the screen keeps one notice viewport.
 */
export function HabitsScreenWithin({ today, areas, children }: HabitsScreenWithinProps) {
  const { enqueue, toaster, announce } = useRequiredScreenServices();
  const value = useMemo<HabitsScreenValue>(
    () => ({ today, areas, enqueue, toaster, announce }),
    [today, areas, enqueue, toaster, announce],
  );
  return <HabitsScreenContext value={value}>{children}</HabitsScreenContext>;
}

/** The server's message for a failed result: a field's own when it gives one, else the general. */
export function failureReason(result: {
  ok: false;
  error: string;
  fieldErrors?: Record<string, string[]>;
}): string {
  const own = Object.values(result.fieldErrors ?? {}).find((messages) => messages.length)?.[0];
  return own ?? result.error;
}
