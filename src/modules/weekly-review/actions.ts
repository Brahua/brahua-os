"use server";

// Server Actions of `weekly-review`: the ritual's moves of open tasks and their undo (W2) and
// closing the week (W3). Each one goes through ownerAction(): owner check first, Zod, then an
// ActionResult (SPEC-core "Estilo de código"). The writes themselves are `tasks`' contract
// (`moveTasksToDate`, `undoMoveTasks`: one postponement per task, with the guard of the day it was
// read with and the exact undo): this module never touches `tasks`' tables.
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { getDb } from "@/lib/db";
import { ownerAction } from "@/lib/owner-action";
import { ownerDateKey } from "@/lib/time";
import { getWeeklyObjectiveForWeek, setWeeklyObjectiveForWeek } from "@/modules/goals/contracts";
import {
  moveTasksInputSchema,
  moveTasksToDate,
  undoMoveTasks,
  undoMoveTasksInputSchema,
  WEEK_REVIEW_ERRORS,
  type MoveTasksResult,
  type UndoMoveTasksResult,
} from "@/modules/tasks/contracts";
import { closeWeekActionSchema } from "./review-input";
import { REVIEW_ERRORS } from "./review-copy";
import { closeWeekRow } from "./review";
import { revalidateAfterClose, revalidateReviewScreens } from "./revalidate";
import { isReviewableWeek, nextMonday } from "./week";

const move = ownerAction(
  moveTasksInputSchema,
  async ({ moves, to }) => {
    // The contract throws for a past day (a programming error); say it as a refusal instead.
    if (to < ownerDateKey(new Date())) return fail<MoveTasksResult>(WEEK_REVIEW_ERRORS.past);
    const result = await moveTasksToDate(moves, to);
    revalidateReviewScreens();
    return ok(result);
  },
  { name: "moveReviewTasks" },
);

/**
 * "Mover las N al lunes", "Mañana" and "Otro día…": moves tasks to a day (today or later). Each
 * task moves only while it still has the day it was read with (`from`); the answer lists what
 * moved (with what the undo needs) and what was left alone.
 */
export async function moveReviewTasks(input: unknown): Promise<ActionResult<MoveTasksResult>> {
  return move(input);
}

const undo = ownerAction(
  undoMoveTasksInputSchema,
  async ({ undo: entries }) => {
    const result = await undoMoveTasks(entries);
    revalidateReviewScreens();
    return ok(result);
  },
  { name: "undoReviewMove" },
);

/**
 * "Deshacer" of a move: carries ONLY what moved (`{ id, previousDueDate, movedTo }`); each task
 * goes back only while it is still pending and on the day the move gave it.
 */
export async function undoReviewMove(input: unknown): Promise<ActionResult<UndoMoveTasksResult>> {
  return undo(input);
}

/** What a close answers: the week closed. */
export type CloseWeekResult = { weekStart: string };

const close = ownerAction(
  closeWeekActionSchema,
  async ({ weekStart, note, objective }) => {
    const now = new Date();
    // A Monday (the schema) that is not in the future.
    if (!isReviewableWeek(weekStart, now)) return fail<CloseWeekResult>(REVIEW_ERRORS.weekFuture);
    // 1. The next week's objective, through `goals` (its own transaction and lock). Blank leaves
    //    the week as it is: closing never clears an objective by accident. The same text again
    //    writes nothing.
    if (objective !== null) {
      const next = nextMonday(weekStart);
      const current = await getWeeklyObjectiveForWeek(next);
      if (current?.text !== objective) {
        const saved = await setWeeklyObjectiveForWeek(next, objective);
        if (!saved.ok) {
          return {
            ok: false,
            error: saved.error,
            fieldErrors: { objective: [saved.error] },
          } satisfies ActionResult<CloseWeekResult>;
        }
      }
    }
    // 2. The review row, under the week's lock (completed_at once, the note updated). If the
    //    request dies between the two, repeating it finishes the job.
    await closeWeekRow(getDb(), { weekStart, note }, now);
    revalidateAfterClose();
    return ok({ weekStart });
  },
  { name: "closeWeek" },
);

/**
 * «Cerrar la semana»: sets the objective of the next week (when one was typed), then records the
 * week as reviewed with its optional note. Idempotent: closing again only updates the note (and
 * the objective, if it changed).
 */
export async function closeWeek(input: unknown): Promise<ActionResult<CloseWeekResult>> {
  return close(input);
}
