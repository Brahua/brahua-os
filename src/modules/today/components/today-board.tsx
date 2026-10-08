import { Coffee } from "lucide-react";
import Link from "next/link";
import { Icon, keyClasses } from "@/design-system";
import { ScreenServicesProvider } from "@/modules/core/components/screen-services";
import type { HabitItem } from "@/modules/habits/habit-input";
import { HABITS_PATH } from "@/modules/habits/routes";
import { TASKS_PATH } from "@/modules/tasks/routes";
import { habitsTally, isDayComplete, todaySections, type DayTally } from "../today-board";
import { TODAY_COPY } from "../today-copy";
import { DayComplete } from "./day-complete";
import { TodayHabits } from "./today-habits";
import { TodayProgressProvider } from "./today-progress";

/**
 * A section another slice fills (D2 "Tareas", D3 "Proyectos"): how many items it has today and
 * what it renders.
 *
 * - `count` only decides the empty day (0 counts toward it). `content` is rendered whenever the
 *   slot is given, even with `count: 0`: the section itself renders nothing (no heading) while it
 *   has no rows. So a client section stays mounted when the server's read comes back empty after
 *   its last row left, and its "Deshacer" still has a live component to put the row back in at
 *   once (with `aria-disabled` while it saves) instead of waiting for the next read.
 * - `content` is rendered inside the board's `ScreenServicesProvider`: its client parts read the
 *   screen's queue, notices, announcer and `isCurrentDay` with `useRequiredScreenServices()` and
 *   never mount a notice viewport of their own.
 * - Focus: a row that leaves (a task completed) hands focus to the next row, else the previous,
 *   else the section's own `<h2 tabIndex={-1}>` (a stable id, e.g. `today-tasks-title`). If the
 *   whole section leaves, focus goes to the board's heading, `TODAY_HEADING_ID` (`today-title`,
 *   the greeting's `<h1 tabIndex={-1}>`). Never <body>.
 */
export type TodaySlot = {
  count: number;
  content: React.ReactNode;
};

/** Slot F4 (`finance`), "Pagos": a section like the others, plus what it says about the day. */
export type PaymentsSlot = TodaySlot & {
  /**
   * How many of its rows keep "Día completo" away by the server's read: overdue or due today
   * (`paymentsTally`). The section publishes the live number (`useReportPayments`).
   */
  blocking: number;
};

/**
 * Slot D4, "Día completo": what the board can't read from the other slots. The block itself
 * (`DayComplete`) is the board's: it follows the sections' live progress
 * (`TodayProgressProvider`), so it shows the moment the last thing is done.
 */
export type DayCompleteSlot = {
  /** `getTasksDoneTodayCount(now)`: tasks completed today (Lima), whatever their due date. */
  tasksDoneToday: number;
};

export type TodayBoardProps = {
  /**
   * The page's header (greeting, date): rendered inside the board's providers, before the board,
   * so the line under the greeting (`GreetingLine`) can follow the live tally.
   */
  header?: React.ReactNode;
  /** The Lima day the page was read for (YYYY-MM-DD). */
  today: string;
  /** `getHabitsDueToday(now)`: the "Hábitos" section (D1). */
  habits: HabitItem[];
  /**
   * Slot D4, "Día completo": when given, the block is mounted first, above the sections, and
   * shows itself while `isDayComplete` (live). Complete by the server's read, the day is not
   * empty (they never show together).
   */
  dayComplete?: DayCompleteSlot;
  /** Slot D2, "Tareas": after "Hábitos". */
  tasks?: TodaySlot;
  /**
   * Slot F4 (`finance`), "Pagos": after "Tareas", before "Proyectos". Its overdue and due-today
   * rows keep "Día completo" away (the upcoming ones don't).
   */
  payments?: PaymentsSlot;
  /** Slot D3, "Proyectos": last. */
  projects?: TodaySlot;
};

/**
 * The daily board (SPEC-today "Pantalla"): "Día completo" (D4) → "Hábitos" → "Tareas" (D2) →
 * "Pagos" (F4 of `finance`) → "Proyectos" (D3); a section without items is left out, and with
 * nothing at all a calm empty day. One `ScreenServicesProvider` for everything on it: one save
 * queue, one notice viewport, one announcer, and one watch of Lima's day (the page is read again
 * once when it changes, the empty day included). A Server Component: only the provider and the
 * sections are client parts.
 */
export function TodayBoard({
  header,
  today,
  habits,
  dayComplete,
  tasks,
  payments,
  projects,
}: TodayBoardProps) {
  // The server's tally: the base of the live one (`TodayProgressProvider`).
  const tally: DayTally = {
    habits: habitsTally(habits, today),
    tasks: { pending: tasks?.count ?? 0, doneToday: dayComplete?.tasksDoneToday ?? 0 },
    payments: { blocking: payments?.blocking ?? 0 },
  };
  const sections = todaySections({
    habits: habits.length,
    tasks: tasks?.count,
    payments: payments?.count,
    projects: projects?.count,
    dayComplete: dayComplete !== undefined && isDayComplete(tally),
  });

  return (
    <ScreenServicesProvider
      label={TODAY_COPY.noticesLabel}
      actionHint={TODAY_COPY.undoHint}
      day={{ today, changedMessage: TODAY_COPY.newDay }}
    >
      <TodayProgressProvider today={today} initial={tally}>
        {header}
        <div className="flex flex-col gap-10" data-today-board="">
          {dayComplete ? <DayComplete /> : null}
          {sections.empty ? <EmptyDay /> : null}
          {/* Mounted even with no habits (it renders nothing then), like the slots: when the last
              one rests ("Saltar hoy") the server's read comes back empty and its "Deshacer"
              still needs a live component to put the pad back at once (see `TodaySlot`). */}
          <TodayHabits today={today} habits={habits} />
          {/* Mounted whenever the slot is given, even at 0: see `TodaySlot`. */}
          {tasks ? tasks.content : null}
          {payments ? payments.content : null}
          {projects ? projects.content : null}
        </div>
      </TodayProgressProvider>
    </ScreenServicesProvider>
  );
}

/** Nothing due today: said calmly, never as a failure (principle 13), with where to start. */
function EmptyDay() {
  return (
    <section
      aria-labelledby="today-empty-title"
      className="bo-card max-w-160 items-start"
      data-today-empty=""
    >
      <Icon icon={Coffee} size="xl" className="text-text-secondary" />
      <h2 id="today-empty-title" className="bo-text-title">
        {TODAY_COPY.emptyTitle}
      </h2>
      <p className="bo-text-body-sm text-text-secondary">{TODAY_COPY.emptyText}</p>
      <div className="flex flex-wrap gap-2">
        <Link href={HABITS_PATH} className={keyClasses({ variant: "ghost" })}>
          {TODAY_COPY.emptyHabits}
        </Link>
        <Link href={TASKS_PATH} className={keyClasses({ variant: "ghost" })}>
          {TODAY_COPY.emptyTasks}
        </Link>
      </div>
    </section>
  );
}
