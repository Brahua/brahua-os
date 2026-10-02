import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/design-system";
import { requireOwner } from "@/lib/auth";
import { Markdown } from "@/lib/markdown/markdown";
import { TasksScreen } from "@/modules/tasks/components/tasks-screen";
import { getTask, getTaskTargets } from "@/modules/tasks/queries";
import { TASKS_PATH } from "@/modules/tasks/routes";
import { TASKS_COPY } from "@/modules/tasks/tasks-copy";
import { getTaskNotes } from "@/modules/tasks/view-queries";
import { TaskPageDetail } from "./task-page-detail";

type TaskPageProps = { params: Promise<{ id: string }> };

const HEADING_ID = "task-title";

export async function generateMetadata({ params }: TaskPageProps): Promise<Metadata> {
  const task = await getTask((await params).id);
  // The page's metadata also applies to its not-found.tsx (which can't set its own here).
  if (!task) return { title: TASKS_COPY.notFoundTitle, robots: { index: false, follow: false } };
  return { title: `${task.title} · brahua-os` };
}

/**
 * A task's page: its detail on the phone (SPEC-tasks "Detalle"; on the desktop the list opens
 * the same sections in a side sheet, and this page is what a ⌘-click or a shared link gets).
 * Missing, deleted or malformed ids are a 404.
 */
export default async function TaskPage({ params }: TaskPageProps) {
  await requireOwner();
  const { id } = await params;
  const [task, targets, notes] = await Promise.all([
    getTask(id),
    getTaskTargets(),
    getTaskNotes(id),
  ]);
  if (!task) notFound();
  const now = new Date();

  return (
    <TasksScreen now={now} targets={targets}>
      <div className="mx-auto flex w-full max-w-(--content-max) flex-col gap-6 px-4 py-8 pb-28 md:px-6 lg:py-12 lg:pb-28">
        <Link
          href={TASKS_PATH}
          className="bo-text-body-sm flex min-h-11 w-fit items-center gap-2 rounded-md text-text-secondary hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <Icon icon={ArrowLeft} size="sm" />
          {TASKS_COPY.backToList}
        </Link>
        <div className="flex max-w-180 flex-col gap-8">
          <TaskPageDetail
            task={task}
            headingId={HEADING_ID}
            notes={notes}
            // Rendered on the server, so no Markdown code ships for them (`#` is an h3 under
            // the h2 "Notas").
            renderedNotes={notes ? <Markdown headingOffset={2}>{notes}</Markdown> : null}
          />
        </div>
      </div>
    </TasksScreen>
  );
}
