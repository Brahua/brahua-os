"use client";

import { Trash2 } from "lucide-react";
import { useId, useTransition } from "react";
import { Key } from "@/design-system";
import { fail, type ActionResult } from "@/lib/action-result";
import { deleteTask } from "../../actions";
import type { DeletedTask } from "../../task-input";
import { TASKS_COPY } from "../../tasks-copy";
import { failureReason } from "../tasks-screen";
import { useTaskDetail } from "./task-detail-context";

/**
 * "Eliminar tarea": a soft delete, without a confirmation because the notice that follows has
 * "Deshacer" (in the list: the sheet closes, or the page goes back to it). Waits for the server
 * ("Eliminando…", the key stays focusable with aria-disabled); a failure is a notice.
 */
export function TaskDeleteSection() {
  const { task, onDeleted, toaster } = useTaskDetail();
  const [pending, startTransition] = useTransition();
  const helpId = useId();

  function remove() {
    if (pending) return;
    startTransition(async () => {
      let result: ActionResult<DeletedTask>;
      try {
        result = await deleteTask({ id: task.id });
      } catch {
        result = fail(TASKS_COPY.checkConnection);
      }
      if (result.ok) {
        onDeleted(task);
        return;
      }
      toaster.push({
        title: TASKS_COPY.notSavedTitle,
        text: `${TASKS_COPY.notDeleted} ${failureReason(result)}`,
        tone: "error",
      });
    });
  }

  return (
    <div className="flex flex-col items-start gap-2 border-t border-divider pt-6">
      <Key
        variant="ghost"
        icon={Trash2}
        aria-describedby={helpId}
        aria-disabled={pending || undefined}
        className={pending ? "is-disabled" : undefined}
        onClick={remove}
        data-saving={pending ? "" : undefined}
      >
        {pending ? TASKS_COPY.deleting : TASKS_COPY.deleteTask}
      </Key>
      <p id={helpId} className="bo-text-body-sm text-text-secondary">
        {TASKS_COPY.deleteHelp}
      </p>
    </div>
  );
}
