"use client";

import { createContext, use, useMemo } from "react";
import { useToaster, type Toaster } from "@/lib/toast/use-toaster";
import { useSaveQueue, type Enqueue } from "@/lib/use-save-queue";
import { useAnnouncer } from "@/modules/core/components/screen-services";
import { ToastViewport } from "@/modules/core/components/toast-viewport";
import { useDayRollover } from "@/modules/core/components/use-day-rollover";
import type { GoalAreaSummary, GoalSourceOptions } from "../goal-input";
import { GOALS_COPY } from "../goals-copy";

// ── Shared by every part of a goals screen (the rows, the sheets, the detail) ──

export type GoalsScreenValue = {
  /** The Lima day the page was read for (YYYY-MM-DD): the pace and the entries' day. */
  today: string;
  /** The active life areas, in their order (the form's picker). */
  areas: readonly GoalAreaSummary[];
  /** The habits and projects a goal can follow (the form's pickers). */
  sources: GoalSourceOptions;
  /**
   * The screen's one save queue (src/lib/use-save-queue.ts): calls run in order, and a call whose
   * turn comes after a newer one with the same key is skipped. Keys in use: `goal-delete:<id>`,
   * `goal-archive:<id>`, `goal-achieved:<id>`; entries use none (every tap counts) and the
   * reorders neither (every step is sent). Call it inside startTransition.
   */
  enqueue: Enqueue;
  /** The screen's notice queue (one viewport per screen): "Deshacer" and "Sin guardar". */
  toaster: Toaster;
  /** Says something politely to screen readers. */
  announce: (message: string) => void;
  /**
   * Whether Lima's day is still `today`. If it changed (the page was left open past midnight),
   * it reloads the page's data and says so, and returns false.
   */
  isCurrentDay: () => boolean;
};

const GoalsScreenContext = createContext<GoalsScreenValue | null>(null);

/** The screen's day, areas, save queue, notices and announcer. */
export function useGoalsScreen(): GoalsScreenValue {
  const value = use(GoalsScreenContext);
  if (!value) throw new Error("useGoalsScreen must be used inside GoalsScreen");
  return value;
}

const NO_SOURCES: GoalSourceOptions = { habits: [], projects: [] };

type GoalsScreenProps = {
  today: string;
  areas: readonly GoalAreaSummary[];
  /** Omitted: no habit or project to pick. */
  sources?: GoalSourceOptions;
  children: React.ReactNode;
};

/**
 * Wraps a goals screen (/goals and each goal's page): one save queue, one notice viewport and
 * one polite announcer for everything on it.
 */
export function GoalsScreen({ today, areas, sources = NO_SOURCES, children }: GoalsScreenProps) {
  const toaster = useToaster();
  const enqueue = useSaveQueue();
  const [announcement, announce] = useAnnouncer();
  const isCurrentDay = useDayRollover(today, announce, GOALS_COPY.newDay);

  const value = useMemo<GoalsScreenValue>(
    () => ({ today, areas, sources, enqueue, toaster, announce, isCurrentDay }),
    [today, areas, sources, enqueue, toaster, announce, isCurrentDay],
  );

  return (
    <GoalsScreenContext value={value}>
      {children}
      <p role="status" aria-live="polite" className="sr-only" data-goals-announcer="">
        {announcement}
      </p>
      <ToastViewport
        toaster={toaster}
        label={GOALS_COPY.noticesLabel}
        actionHint={GOALS_COPY.undoHint}
      />
    </GoalsScreenContext>
  );
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
