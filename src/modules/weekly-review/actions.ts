"use server";

// Server Actions of `weekly-review`: the ritual's moves of open tasks and their undo (W2); W3 adds
// closing the week. Each one goes through ownerAction(): owner check first, Zod, then an
// ActionResult (SPEC-core "Estilo de código"). The writes themselves are `tasks`' contract
// (`moveTasksToDate`, `undoMoveTasks`: one postponement per task, with the guard of the day it was
// read with and the exact undo): this module never touches `tasks`' tables.
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { ownerAction } from "@/lib/owner-action";
import { ownerDateKey } from "@/lib/time";
import {
  moveTasksInputSchema,
  moveTasksToDate,
  undoMoveTasks,
  undoMoveTasksInputSchema,
  WEEK_REVIEW_ERRORS,
  type MoveTasksResult,
  type UndoMoveTasksResult,
} from "@/modules/tasks/contracts";
import { revalidateReviewScreens } from "./revalidate";

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
