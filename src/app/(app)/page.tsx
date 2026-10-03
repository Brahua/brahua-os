import type { Metadata } from "next";
import { requireOwner } from "@/lib/auth";
import { formatLongDate, greetingFor, ownerDateKey } from "@/lib/time";
import { getHabitsDueToday } from "@/modules/habits/contracts";
import { getProjectsTodaySummary } from "@/modules/projects/contracts";
import { getTasksDoneTodayCount, getTasksTodaySummary } from "@/modules/tasks/contracts";
import { TodayBoard } from "@/modules/today/components/today-board";
import { TodayProjects } from "@/modules/today/components/today-projects";
import { TodayTasks } from "@/modules/today/components/today-tasks";
import { TODAY_HEADING_ID } from "@/modules/today/today-board";
import { TODAY_COPY } from "@/modules/today/today-copy";

export const metadata: Metadata = { title: TODAY_COPY.pageTitle };

/**
 * Hoy (SPEC-today): the greeting, the date and the daily board. The greeting and date are
 * rendered on the server in Lima time, so the client never re-computes them (no hydration
 * mismatch). The board has no data of its own: the page reads the provider modules' contracts in
 * parallel, a fixed number of queries.
 */
export default async function Home() {
  await requireOwner();
  // One instant for the whole page: every section reads the same Lima day.
  const now = new Date();

  // One `Promise.all`, one entry per contract (SPEC-today "Lecturas"), each passed to its slot
  // of `TodayBoard` ("Día completo" reads the tasks completed today).
  const [habits, tasks, projects, tasksDoneToday] = await Promise.all([
    getHabitsDueToday(now),
    getTasksTodaySummary(now),
    getProjectsTodaySummary(now),
    getTasksDoneTodayCount(now),
  ]);

  return (
    // Bottom padding grows with the notice (--toast-offset): every tap leaves a "Deshacer"
    // notice, and the last row of pads must stay reachable under it at full scroll.
    <div className="mx-auto flex w-full max-w-(--content-max) flex-col gap-10 px-4 py-8 pb-[calc(7rem+var(--toast-offset,0px))] md:px-6 lg:py-12 lg:pb-[calc(7rem+var(--toast-offset,0px))]">
      <header className="flex flex-col gap-2">
        <p className="bo-text-label text-text-secondary">
          <time dateTime={ownerDateKey(now)}>{formatLongDate(now)}</time>
        </p>
        {/* tabIndex -1: focus lands here when a whole section leaves (TodaySlot). */}
        <h1 id={TODAY_HEADING_ID} tabIndex={-1} className="bo-text-display outline-none">
          {greetingFor(now)}
        </h1>
      </header>
      <TodayBoard
        today={ownerDateKey(now)}
        habits={habits}
        tasks={{ count: tasks.length, content: <TodayTasks tasks={tasks} /> }}
        projects={{ count: projects.length, content: <TodayProjects projects={projects} /> }}
        dayComplete={{ tasksDoneToday }}
      />
    </div>
  );
}
