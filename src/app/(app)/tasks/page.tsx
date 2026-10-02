import type { Metadata } from "next";
import { cookies } from "next/headers";
import { requireOwner } from "@/lib/auth";
import { areShortcutsEnabled, SHORTCUTS_COOKIE } from "@/modules/core/nav-preferences";
import { TasksScreen } from "@/modules/tasks/components/tasks-screen";
import { getDeletedTask, getTaskTargets, listInboxTasks } from "@/modules/tasks/queries";
import { DELETED_PARAM, parseTaskView, VIEW_PARAM, type TaskView } from "@/modules/tasks/routes";
import { parseFilterParams, resolveFilters } from "@/modules/tasks/task-filters";
import type { TaskItem, TaskTargets } from "@/modules/tasks/task-input";
import { matchesFilters } from "@/modules/tasks/task-views";
import { TASK_VIEW_LABELS, TASKS_COPY } from "@/modules/tasks/tasks-copy";
import {
  listDoneTasks,
  listPendingTasks,
  listTodayTasks,
  listUpcomingTasks,
} from "@/modules/tasks/view-queries";
import { AllView } from "./_components/all-view";
import { DoneView, TodayView, UpcomingView } from "./_components/date-views";
import { InboxView } from "./_components/inbox-view";
import { TasksNotices } from "./_components/tasks-notices";
import { TaskViewTabs } from "./_components/task-view-tabs";

const HEADING_ID = "tasks-title";
const VIEW_HEADING_ID = "tasks-view-title";

type SearchParams = Record<string, string | string[] | undefined>;

type TasksPageProps = {
  searchParams: Promise<SearchParams>;
};

/** Each view has its own title ("Hoy · Tareas · brahua-os"): a view switch is announced. */
export async function generateMetadata({ searchParams }: TasksPageProps): Promise<Metadata> {
  const view = parseTaskView((await searchParams)[VIEW_PARAM]);
  return { title: TASKS_COPY.viewTitle(TASK_VIEW_LABELS[view]) };
}

/**
 * Tareas (SPEC-tasks "Pantallas"): the views as links (`?vista=`): Bandeja (T1), Hoy, Próximas,
 * Todas (filters in the URL) and Hechas (T2). Each view reads its own tasks in one query.
 */
export default async function TasksPage({ searchParams }: TasksPageProps) {
  await requireOwner();
  const search = await searchParams;
  const view = parseTaskView(search[VIEW_PARAM]);
  const deletedId = search[DELETED_PARAM];
  // One instant for every row: the views and the due labels all count from the same Lima day.
  const now = new Date();
  const [tasks, targets, deleted, cookieStore] = await Promise.all([
    listViewTasks(view, now),
    getTaskTargets(),
    // Just deleted from its page: the undo notice needs its title (only while it is deleted).
    typeof deletedId === "string" ? getDeletedTask(deletedId) : Promise.resolve(null),
    cookies(),
  ]);
  const shortcuts = areShortcutsEnabled(cookieStore.get(SHORTCUTS_COOKIE)?.value);

  return (
    <TasksScreen now={now} targets={targets}>
      <div className="mx-auto flex w-full max-w-(--content-max) flex-col gap-6 px-4 py-8 pb-28 md:px-6 lg:py-12 lg:pb-28">
        <header>
          {/* tabIndex -1: focus lands here after deleting a task from its page (TasksNotices). */}
          <h1 id={HEADING_ID} tabIndex={-1} className="bo-text-display outline-none">
            {TASKS_COPY.title}
          </h1>
        </header>

        <TaskViewTabs current={view} />

        <section aria-labelledby={VIEW_HEADING_ID} className="flex max-w-180 flex-col gap-3">
          <ViewContent
            view={view}
            tasks={tasks}
            targets={targets}
            search={search}
            shortcuts={shortcuts}
          />
        </section>

        <TasksNotices headingId={HEADING_ID} deleted={deleted} />
      </div>
    </TasksScreen>
  );
}

/** The tasks of a view, in its order (one query each). */
function listViewTasks(view: TaskView, now: Date): Promise<TaskItem[]> {
  switch (view) {
    case "bandeja":
      return listInboxTasks();
    case "hoy":
      return listTodayTasks(now);
    case "proximas":
      return listUpcomingTasks(now);
    case "todas":
      return listPendingTasks();
    case "hechas":
      return listDoneTasks(now);
  }
}

type ViewContentProps = {
  view: TaskView;
  tasks: TaskItem[];
  targets: TaskTargets;
  search: SearchParams;
  shortcuts: boolean;
};

function ViewContent({ view, tasks, targets, search, shortcuts }: ViewContentProps) {
  switch (view) {
    case "bandeja":
      return <InboxView tasks={tasks} shortcuts={shortcuts} headingId={VIEW_HEADING_ID} />;
    case "hoy":
      return <TodayView tasks={tasks} headingId={VIEW_HEADING_ID} />;
    case "proximas":
      return <UpcomingView tasks={tasks} headingId={VIEW_HEADING_ID} />;
    case "hechas":
      return <DoneView tasks={tasks} headingId={VIEW_HEADING_ID} />;
    case "todas": {
      const { filters, choices } = resolveFilters(parseFilterParams(search), targets, tasks);
      const area = choices.areas.find((item) => item.id === filters.areaId);
      return (
        <AllView
          tasks={tasks.filter((task) => matchesFilters(task, filters))}
          filters={filters}
          choices={choices}
          params={{ area: area?.slug ?? null, project: filters.projectId }}
          headingId={VIEW_HEADING_ID}
        />
      );
    }
  }
}
