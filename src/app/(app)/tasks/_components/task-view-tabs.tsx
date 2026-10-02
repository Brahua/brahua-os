import Link from "next/link";
import { cn } from "@/lib/cn";
import { TASK_VIEWS, taskViewHref, type TaskView } from "@/modules/tasks/routes";
import { TASK_VIEW_LABELS, TASKS_COPY } from "@/modules/tasks/tasks-copy";

/**
 * The views of /tasks as links (`?vista=`), with the current one marked (`aria-current="page"`)
 * and drawn like the selected key of a segmented control. Links, not tabs: each view is its own
 * URL (back, reload and sharing work). They wrap on narrow screens instead of scrolling, so none
 * is ever hidden off screen.
 */
export function TaskViewTabs({ current }: { current: TaskView }) {
  return (
    <nav aria-label={TASKS_COPY.viewsLabel}>
      <div className="bo-segmented bo-task-views">
        {TASK_VIEWS.map((view) => (
          <Link
            key={view}
            href={taskViewHref(view)}
            prefetch={false}
            className={cn("bo-segmented__item", view === current && "is-on")}
            aria-current={view === current ? "page" : undefined}
            // T2 builds the other views: their names say so before following the link (an
            // sr-only span would be read run together with the label in some engines).
            aria-label={
              view === "bandeja"
                ? undefined
                : `${TASK_VIEW_LABELS[view]}${TASKS_COPY.comingSoonHidden}`
            }
          >
            {TASK_VIEW_LABELS[view]}
          </Link>
        ))}
      </div>
    </nav>
  );
}
