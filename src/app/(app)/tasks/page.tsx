import { Construction } from "lucide-react";
import type { Metadata } from "next";
import { Icon, SectionLabel } from "@/design-system";
import { requireOwner } from "@/lib/auth";
import { TasksScreen } from "@/modules/tasks/components/tasks-screen";
import { getDeletedTask, getTaskTargets, listInboxTasks } from "@/modules/tasks/queries";
import { DELETED_PARAM, parseTaskView, VIEW_PARAM } from "@/modules/tasks/routes";
import { TASK_VIEW_LABELS, TASKS_COPY } from "@/modules/tasks/tasks-copy";
import { InboxView } from "./_components/inbox-view";
import { TasksNotices } from "./_components/tasks-notices";
import { TaskViewTabs } from "./_components/task-view-tabs";

export const metadata: Metadata = { title: TASKS_COPY.pageTitle };

const HEADING_ID = "tasks-title";
const VIEW_HEADING_ID = "tasks-view-title";

type TasksPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Tareas (SPEC-tasks "Pantallas"): the views as links (`?vista=`). T1 builds the inbox; Hoy,
 * Próximas, Todas and Hechas show what they will be ("Próximamente") until T2 fills them in
 * here (each view replaces its placeholder, nothing else changes).
 */
export default async function TasksPage({ searchParams }: TasksPageProps) {
  await requireOwner();
  const search = await searchParams;
  const view = parseTaskView(search[VIEW_PARAM]);
  const deletedId = search[DELETED_PARAM];
  const [inbox, targets, deleted] = await Promise.all([
    view === "bandeja" ? listInboxTasks() : Promise.resolve([]),
    getTaskTargets(),
    // Just deleted from its page: the undo notice needs its title (only while it is deleted).
    typeof deletedId === "string" ? getDeletedTask(deletedId) : Promise.resolve(null),
  ]);
  // One instant for every row: the due labels all count from the same Lima day.
  const now = new Date();

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
          <SectionLabel
            id={VIEW_HEADING_ID}
            as="h2"
            tabIndex={-1}
            title={TASK_VIEW_LABELS[view]}
            className="outline-none"
          />
          {view === "bandeja" ? (
            <>
              <p className="bo-text-body-sm text-text-secondary">{TASKS_COPY.inboxHelp}</p>
              <InboxView tasks={inbox} headingId={VIEW_HEADING_ID} />
            </>
          ) : (
            // ── T2 slot: the views Hoy, Próximas, Todas and Hechas replace this placeholder. ──
            <div className="bo-card max-w-160 items-start" data-view-coming-soon={view}>
              <Icon icon={Construction} size="xl" className="text-text-secondary" />
              <h3 className="bo-text-title">
                {TASKS_COPY.comingSoonTitle(TASK_VIEW_LABELS[view])}
              </h3>
              <p className="bo-text-body-sm text-text-secondary">{TASKS_COPY.comingSoonText}</p>
            </div>
          )}
        </section>

        <TasksNotices headingId={HEADING_ID} deleted={deleted} />
      </div>
    </TasksScreen>
  );
}
