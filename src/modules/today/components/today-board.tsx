"use client";

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
 * A section another slice fills (D2 "Tareas", D3 "Proyectos"): how many items it has today (0:
 * the section is left out, and counts toward the empty day) and what it renders. `content` is
 * rendered inside the board's `ScreenServicesProvider`, so a client part in it reads the
 * screen's queue, notices and announcer with `useRequiredScreenServices()` (one notice viewport
 * for the whole board).
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
   * Slot D4, "Día completo": rendered first, above the sections, when given. D4 decides when
   * (its pure rule in `today-board.ts`); the board only places it.
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
 * day. One `ScreenServicesProvider` for everything on it: one save queue, one notice viewport and
 * one announcer, shared by the habits' pads and the other sections.
 */
export function TodayBoard({ today, habits, dayComplete, tasks, projects }: TodayBoardProps) {
  const sections = todaySections({
    habits: habits.length,
    tasks: tasks?.count,
    projects: projects?.count,
  });

  return (
    <ScreenServicesProvider label={TODAY_COPY.noticesLabel} actionHint={TODAY_COPY.undoHint}>
      <div className="flex flex-col gap-10" data-today-board="">
        {dayComplete}
        {sections.empty ? <EmptyDay /> : null}
        {sections.habits ? <TodayHabits today={today} habits={habits} /> : null}
        {sections.tasks ? tasks?.content : null}
        {sections.projects ? projects?.content : null}
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
