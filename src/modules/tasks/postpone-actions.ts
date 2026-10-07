"use server";

// Server Actions of "Mañana" / "Otro día…" (polish → postpone-one-tap). Their own file, like
// recurrence's: each one goes through ownerAction() (owner first, Zod, ActionResult).
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { getDb } from "@/lib/db";
import { ownerAction } from "@/lib/owner-action";
import { postponeTaskById, restoreDueDateById } from "./postpone-db";
import { revalidateTaskScreens } from "./revalidate";
import { TASK_ERRORS } from "./task-input";
import {
  POSTPONE_ERRORS,
  postponeDay,
  postponeTaskInputSchema,
  restoreDueDateInputSchema,
  type PostponedTask,
  type RestoredDueDate,
} from "./task-postpone";

const postpone = ownerAction(
  postponeTaskInputSchema,
  async ({ id, to }) => {
    const day = postponeDay(to, new Date());
    if (day === null) {
      return { ok: false, error: POSTPONE_ERRORS.pastDay, fieldErrors: { to: [POSTPONE_ERRORS.pastDay] } };
    }
    const result = await postponeTaskById(getDb(), id, day);
    // The list, the task's page and `today`'s board show the new day (the home page is in there).
    revalidateTaskScreens(id);
    if (result === null) return fail(TASK_ERRORS.notFound);
    if (result === "done") return fail(POSTPONE_ERRORS.notPending);
    return ok(result);
  },
  { name: "postponeTask" },
);

/**
 * Moves a pending task's due date: `to` is `"tomorrow"` (Lima's next day, at the server's clock)
 * or a day, never before today in Lima. Only this task: a recurring one keeps its rule and no
 * copy is created. Idempotent (a second tap finds it already there: `changed: false`). Answers
 * what the UI needs and the day it had, which `restoreTaskDueDate` ("Deshacer") puts back.
 * The contract of the next ones (`evening-close-ritual`'s batch calls it once per task).
 */
export async function postponeTask(input: unknown): Promise<ActionResult<PostponedTask>> {
  return postpone(input);
}

const restore = ownerAction(
  restoreDueDateInputSchema,
  async ({ id, dueDate, expected }) => {
    const result = await restoreDueDateById(getDb(), id, dueDate, expected);
    revalidateTaskScreens(id);
    return result ? ok(result) : fail(TASK_ERRORS.notFound);
  },
  { name: "restoreTaskDueDate" },
);

/**
 * "Deshacer" of `postponeTask`, by task id (never by period or slot): `dueDate` is the day it had
 * (`previousDueDate`), `expected` the one the postponement set. If the task has another day by
 * now (edited meanwhile) nothing is overwritten (`restored: false`).
 */
export async function restoreTaskDueDate(input: unknown): Promise<ActionResult<RestoredDueDate>> {
  return restore(input);
}
