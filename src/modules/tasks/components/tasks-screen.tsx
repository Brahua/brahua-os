"use client";

import { createContext, use, useMemo } from "react";
import { useToaster, type Toaster } from "@/lib/toast/use-toaster";
import { useSaveQueue, type Enqueue } from "@/lib/use-save-queue";
import { useAnnouncer, useRequiredScreenServices } from "@/modules/core/components/screen-services";
import { ToastViewport } from "@/modules/core/components/toast-viewport";
import type { TaskTargets } from "../task-input";
import { TASKS_COPY } from "../tasks-copy";

// ── Shared by every part of a tasks screen (the list, its rows, the detail and its sections) ──

export type TasksScreenValue = {
  /** The instant the page was rendered: due labels count Lima days from it. */
  now: Date;
  /** Where a task can go: the active areas and the open projects. */
  targets: TaskTargets;
  /**
   * The screen's one save queue (src/lib/use-save-queue.ts): calls run in order, and a call whose
   * turn comes after a newer one with the same key is skipped. Each part uses its own keys (e.g.
   * `task-done:<id>`, `task:<id>:<field>`) and keeps its own useOptimistic; call it inside
   * startTransition.
   */
  enqueue: Enqueue;
  /** The screen's notice queue (one viewport per screen): "Deshacer" and "Sin guardar". */
  toaster: Toaster;
  /** Says something politely to screen readers (e.g. "Se guardó la fecha."). */
  announce: (message: string) => void;
};

const TasksScreenContext = createContext<TasksScreenValue | null>(null);

/** The screen's instant, targets, save queue, notices and announcer. */
export function useTasksScreen(): TasksScreenValue {
  const value = use(TasksScreenContext);
  if (!value) throw new Error("useTasksScreen must be used inside TasksScreen");
  return value;
}

type TasksScreenProps = {
  now: Date;
  targets: TaskTargets;
  children: React.ReactNode;
};

/**
 * Wraps a tasks screen (/tasks and /tasks/<id>): one save queue, one notice viewport and one
 * polite announcer for everything on it, including the detail sheet over the list.
 */
export function TasksScreen({ now, targets, children }: TasksScreenProps) {
  const toaster = useToaster();
  const enqueue = useSaveQueue();
  const [announcement, announce] = useAnnouncer();

  const value = useMemo<TasksScreenValue>(
    () => ({ now, targets, enqueue, toaster, announce }),
    [now, targets, enqueue, toaster, announce],
  );

  return (
    <TasksScreenContext value={value}>
      {children}
      <p role="status" aria-live="polite" className="sr-only" data-tasks-announcer="">
        {announcement}
      </p>
      <ToastViewport
        toaster={toaster}
        label={TASKS_COPY.noticesLabel}
        actionHint={TASKS_COPY.undoHint}
      />
    </TasksScreenContext>
  );
}

type TasksScreenWithinProps = {
  now: Date;
  targets: TaskTargets;
  children: React.ReactNode;
};

/**
 * A tasks part on another module's screen (T5: the "Tareas" section of a project's page): the
 * same context as `TasksScreen`, but with the host screen's save queue, notices and announcer
 * (`ScreenServicesContext` from `core`), so the screen keeps one notice viewport.
 */
export function TasksScreenWithin({ now, targets, children }: TasksScreenWithinProps) {
  const { enqueue, toaster, announce } = useRequiredScreenServices();
  const value = useMemo<TasksScreenValue>(
    () => ({ now, targets, enqueue, toaster, announce }),
    [now, targets, enqueue, toaster, announce],
  );
  return <TasksScreenContext value={value}>{children}</TasksScreenContext>;
}

/** The server's message for a failed result: a field's own when it gives one, else the general. */
export function failureReason(result: { ok: false; error: string; fieldErrors?: Record<string, string[]> }): string {
  const own = Object.values(result.fieldErrors ?? {}).find((messages) => messages.length)?.[0];
  return own ?? result.error;
}
