"use client";

import { Trash2 } from "lucide-react";
import { useId, useTransition } from "react";
import { Key } from "@/design-system";
import { fail, type ActionResult } from "@/lib/action-result";
import { requestNavigation } from "@/lib/navigation-guard";
import { deleteTask } from "../../actions";
import { TASKS_PATH } from "../../routes";
import type { DeletedTask } from "../../task-input";
import { TASKS_COPY } from "../../tasks-copy";
import { failureReason } from "../tasks-screen";
import { useAllowDetailClose } from "./detail-close-guard";
import { useTaskDetail } from "./task-detail-context";

/**
 * "Eliminar tarea": a soft delete, without a confirmation because the notice that follows has
 * "Deshacer" (in the list: the sheet closes, or the page goes back to it). Waits for the server
 * ("Eliminando…", the key stays focusable with aria-disabled); a failure is a notice.
 *
 * Deleting leaves the detail (the sheet closes, the page goes back to the list), so unsaved
 * notes ask first, like closing or following a link: "Salir sin guardar" then deletes.
 */
export function TaskDeleteSection() {
  const { task, host, onDeleted, reportError } = useTaskDetail();
  const allowClose = useAllowDetailClose();
  const [pending, startTransition] = useTransition();
  const helpId = useId();

  function remove() {
    if (pending) return;
    if (host === "sheet") {
      if (allowClose(removeNow)) removeNow();
      return;
    }
    requestNavigation(TASKS_PATH, removeNow);
  }

  function removeNow() {
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
      reportError(`${TASKS_COPY.notDeleted} ${failureReason(result)}`);
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
