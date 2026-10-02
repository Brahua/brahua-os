"use client";

import { startTransition, useEffect, useRef } from "react";
import { fail, type ActionResult } from "@/lib/action-result";
import { restoreTaskWithSpawn, type RestoredTask } from "@/modules/tasks/recurrence-actions";
import { restoredNotice } from "@/modules/tasks/recurrence-notices";
import { useTasksScreen } from "@/modules/tasks/components/tasks-screen";
import { DELETED_PARAM } from "@/modules/tasks/routes";
import type { DeletedTask } from "@/modules/tasks/task-input";
import { TASKS_COPY } from "@/modules/tasks/tasks-copy";

/** A live region only speaks what changes after it is on the page. */
const ANNOUNCE_DELAY_MS = 150;

type TasksNoticesProps = {
  /** Id of the list's `<h1 tabIndex={-1}>`: focus lands there after a delete. */
  headingId: string;
  /** The task just deleted from its page (`?deleted=<id>`), while it is still deleted. */
  deleted: DeletedTask | null;
};

/**
 * After deleting a task from its page (the phone's detail), the page sends here with
 * `?deleted=<id>`: focus goes to the heading, the parameter leaves the URL (a reload doesn't
 * repeat it) and "Tarea eliminada · Deshacer" shows in the screen's notices.
 */
export function TasksNotices({ headingId, deleted }: TasksNoticesProps) {
  const { toaster, announce } = useTasksScreen();
  const { push } = toaster;
  const shown = useRef<string | null>(null);

  useEffect(() => {
    if (!deleted || shown.current === deleted.id) return;
    const task = deleted;
    document.getElementById(headingId)?.focus();
    const url = new URL(window.location.href);
    if (url.searchParams.has(DELETED_PARAM)) {
      url.searchParams.delete(DELETED_PARAM);
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
    }

    function undo() {
      startTransition(async () => {
        let result: ActionResult<RestoredTask>;
        try {
          result = await restoreTaskWithSpawn({ id: task.id });
        } catch {
          result = fail(TASKS_COPY.checkConnection);
        }
        if (result.ok) announce(restoredNotice(result.data.task, result.data.detached));
        else push({ title: TASKS_COPY.notSavedTitle, text: TASKS_COPY.notUndone, tone: "error" });
      });
    }

    const timer = window.setTimeout(() => {
      shown.current = task.id;
      push({
        title: TASKS_COPY.deletedTitle,
        text: TASKS_COPY.deleted(task.title),
        action: { label: TASKS_COPY.undo, run: undo },
      });
    }, ANNOUNCE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [deleted, headingId, push, announce]);

  return null;
}
