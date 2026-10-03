import { Coffee } from "lucide-react";
import Link from "next/link";
import { Icon, keyClasses } from "@/design-system";
import { ScreenServicesProvider } from "@/modules/core/components/screen-services";
import type { HabitItem } from "@/modules/habits/habit-input";
import { HABITS_PATH } from "@/modules/habits/routes";
import { TASKS_PATH } from "@/modules/tasks/routes";
import { todaySections } from "../today-board";
import { TODAY_COPY } from "../today-copy";
import { TodayHabits } from "./today-habits";

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

export type TodayBoardProps = {
  /** The Lima day the page was read for (YYYY-MM-DD). */
  today: string;
  /** `getHabitsDueToday(now)`: the "Hábitos" section (D1). */
  habits: HabitItem[];
  /**
   * Slot D4, "Día completo": rendered first, above the sections, when given (and then the empty
   * day is not). D4 decides when (its pure rule in `today-board.ts`); the board only places it.
   */
  dayComplete?: React.ReactNode;
  /** Slot D2, "Tareas": after "Hábitos". */
  tasks?: TodaySlot;
  /** Slot D3, "Proyectos": last. */
  projects?: TodaySlot;
};

/**
 * The daily board (SPEC-today "Pantalla"): "Día completo" (D4) → "Hábitos" → "Tareas" (D2) →
 * "Proyectos" (D3); a section without items is left out, and with nothing at all a calm empty
 * day. One `ScreenServicesProvider` for everything on it: one save queue, one notice viewport,
 * one announcer, and one watch of Lima's day (the page is read again once when it changes, the
 * empty day included). A Server Component: only the provider and the sections are client parts.
 */
export function TodayBoard({ today, habits, dayComplete, tasks, projects }: TodayBoardProps) {
  const sections = todaySections({
    habits: habits.length,
    tasks: tasks?.count,
    projects: projects?.count,
    dayComplete: dayComplete != null,
  });

  return (
    <ScreenServicesProvider
      label={TODAY_COPY.noticesLabel}
      actionHint={TODAY_COPY.undoHint}
      day={{ today, changedMessage: TODAY_COPY.newDay }}
    >
      <div className="flex flex-col gap-10" data-today-board="">
        {dayComplete}
        {sections.empty ? <EmptyDay /> : null}
        {sections.habits ? <TodayHabits today={today} habits={habits} /> : null}
        {/* Mounted whenever the slot is given, even at 0: see `TodaySlot`. */}
        {tasks ? tasks.content : null}
        {projects ? projects.content : null}
      </div>
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
