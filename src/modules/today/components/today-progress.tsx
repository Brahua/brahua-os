"use client";

// The board's live progress, for "Día completo" (D4). Design (one source of truth each):
//
// - The server's read is the base: `TodayBoard` computes a `DayTally` from the page's props (the
//   habits due today, how many tasks are pending, `getTasksDoneTodayCount`) and passes it down on
//   every render, so a new read always wins.
// - What changes before the server answers lives where it already lived: the optimistic lists of
//   `TodayHabits`, `TodayTasks` and `TodayPayments` (F4). Each section only *publishes* what its
//   list says (`useReportHabits`, `useReportTasks`, `useReportPayments`) in a layout effect
//   (before paint, so "Día completo" shows in the same frame as the last tap). This provider holds those last published values,
//   never a list of its own, and drops them when the section unmounts (back to the server's).
// - Tasks completed today are the server's count plus what "Tareas" has completed (or undone)
//   that the server hasn't read yet: the rows its optimistic list is missing against its props
//   (`doneDelta`, +1 on complete, −1 on undoing a completion the server already counted). Once
//   the server's read lands, the props and the list agree again and the delta is 0.
import { createContext, use, useLayoutEffect, useMemo, useState } from "react";
import type { DayTally, HabitsTally, PaymentsTally } from "../today-board";

/** What "Tareas" publishes: pending rows, and completions the server hasn't counted yet. */
export type TasksReport = { pending: number; doneDelta: number };

type Reports = {
  habits: HabitsTally | null;
  tasks: TasksReport | null;
  payments: PaymentsTally | null;
};

type Publish = {
  habits: (tally: HabitsTally | null) => void;
  tasks: (report: TasksReport | null) => void;
  payments: (tally: PaymentsTally | null) => void;
};

const TallyContext = createContext<{ tally: DayTally; today: string } | null>(null);
const PublishContext = createContext<Publish | null>(null);

type TodayProgressProviderProps = {
  /** The Lima day the page was read for (YYYY-MM-DD). */
  today: string;
  /** The server's tally (from the page's props): the base, always the latest read. */
  initial: DayTally;
  children: React.ReactNode;
};

export function TodayProgressProvider({ today, initial, children }: TodayProgressProviderProps) {
  const [reports, setReports] = useState<Reports>({ habits: null, tasks: null, payments: null });
  const publish = useMemo<Publish>(
    () => ({
      habits: (habits) => setReports((current) => ({ ...current, habits })),
      tasks: (tasks) => setReports((current) => ({ ...current, tasks })),
      payments: (payments) => setReports((current) => ({ ...current, payments })),
    }),
    [],
  );
  const value = useMemo(
    () => ({
      today,
      tally: {
        habits: reports.habits ?? initial.habits,
        tasks: {
          pending: reports.tasks?.pending ?? initial.tasks.pending,
          doneToday: Math.max(0, initial.tasks.doneToday + (reports.tasks?.doneDelta ?? 0)),
        },
        payments: reports.payments ?? initial.payments,
      },
    }),
    [today, initial, reports],
  );
  return (
    <PublishContext value={publish}>
      <TallyContext value={value}>{children}</TallyContext>
    </PublishContext>
  );
}

/** The live tally and the board's day, or null outside a board (a section rendered alone). */
export function useTodayProgress() {
  return use(TallyContext);
}

/** "Hábitos" publishes its optimistic tally (nothing outside a board). */
export function useReportHabits({ done, total, active }: HabitsTally) {
  const publish = use(PublishContext);
  useLayoutEffect(() => {
    if (!publish) return;
    publish.habits({ done, total, active });
    return () => publish.habits(null);
  }, [publish, done, total, active]);
}

/** "Tareas" publishes its optimistic pending count and completions (nothing outside a board). */
export function useReportTasks({ pending, doneDelta }: TasksReport) {
  const publish = use(PublishContext);
  useLayoutEffect(() => {
    if (!publish) return;
    publish.tasks({ pending, doneDelta });
    return () => publish.tasks(null);
  }, [publish, pending, doneDelta]);
}

/** "Pagos" (F4) publishes how many of its (optimistic) rows keep the day open. */
export function useReportPayments({ blocking }: PaymentsTally) {
  const publish = use(PublishContext);
  useLayoutEffect(() => {
    if (!publish) return;
    publish.payments({ blocking });
    return () => publish.payments(null);
  }, [publish, blocking]);
}
