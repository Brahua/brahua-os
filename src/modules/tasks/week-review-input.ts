// What `tasks` gives `weekly-review` and takes from it (SPEC-weekly-review "Contratos"): the
// week's reading, and the batch move with its exact undo. Client-safe types and Zod schemas (the
// ritual's actions, W2, validate with them first; the contracts validate again).
import { z } from "zod";
import { TASK_ERRORS } from "./task-input";

/** The most tasks one batch move (and one undo) takes. */
export const MAX_BATCH_MOVES = 200;

/** The most recent done tasks the week's reading names, and the most open ones it lists. */
export const WEEK_REVIEW_RECENT_DONE = 5;
export const WEEK_REVIEW_OPEN_LIMIT = MAX_BATCH_MOVES;

export const WEEK_REVIEW_ERRORS = {
  tooMany: `Son demasiadas tareas a la vez (máximo ${MAX_BATCH_MOVES}).`,
  duplicated: "Hay tareas repetidas en la lista.",
  past: "Elige hoy o un día que venga.",
} as const;

const id = z.uuid({ error: TASK_ERRORS.notFound });
const day = z.iso.date({ error: TASK_ERRORS.dateInvalid });

/** Ids as a set: no repeated ones, at most the batch cap (an empty list is a harmless no-op). */
const uniqueIds = <T>(item: z.ZodType<T>, key: (value: T) => string) =>
  z
    .array(item)
    .max(MAX_BATCH_MOVES, WEEK_REVIEW_ERRORS.tooMany)
    .refine((list) => new Set(list.map(key)).size === list.length, WEEK_REVIEW_ERRORS.duplicated);

/**
 * One task to move: its id and the day it was read with (`from`, null: no day). The move only
 * happens while it still has that day (a task edited meanwhile is left alone).
 */
export const taskMoveSchema = z.object({ id, from: day.nullable() });
export type TaskMove = z.output<typeof taskMoveSchema>;

export const moveTasksInputSchema = z.object({
  moves: uniqueIds(taskMoveSchema, (move) => move.id),
  to: day,
});
export type MoveTasksInput = z.output<typeof moveTasksInputSchema>;

/** One task to put back: where it was and where the move left it. */
export const taskUndoSchema = z.object({ id, previousDueDate: day.nullable(), movedTo: day });
export type TaskUndo = z.output<typeof taskUndoSchema>;

export const undoMoveTasksInputSchema = z.object({
  undo: uniqueIds(taskUndoSchema, (entry) => entry.id),
});
export type UndoMoveTasksInput = z.output<typeof undoMoveTasksInputSchema>;

/** A task a batch moved: carries what the undo needs. */
export type MovedTask = {
  id: string;
  title: string;
  /** The day it had (null: none). The undo puts exactly this back. */
  previousDueDate: string | null;
  /** The day the move set. */
  movedTo: string;
};

/** Why a task of the batch was not moved. */
export type SkippedReason =
  /** Already completed. */
  | "done"
  /** It doesn't exist or is deleted. */
  | "missing"
  /** It no longer has the day it was read with: edited meanwhile, left as it is. */
  | "changed"
  /** It already was on the target day (a second identical batch). */
  | "already";

export type MoveTasksResult = {
  /** The target day. */
  to: string;
  /** What this call moved, in the order asked. */
  moved: MovedTask[];
  skipped: { id: string; reason: SkippedReason }[];
};

export type UndoMoveTasksResult = {
  /** The tasks put back on their previous day. */
  restored: string[];
  /** The ones left as they are (edited, completed or deleted meanwhile, or already undone). */
  kept: { id: string; dueDate: string | null }[];
  /** The ones that no longer exist (deleted). */
  missing: string[];
};

/** A task of the week's reading. */
export type WeekReviewDoneTask = { id: string; title: string; doneAt: Date };

export type WeekReviewOpenTask = {
  id: string;
  title: string;
  /** The day it is due (YYYY-MM-DD): within the week or before it. */
  dueDate: string;
  projectName: string | null;
  /** A recurring task moves only this occurrence. */
  recurring: boolean;
};

export type TasksWeekReview = {
  /** The Monday of the week read. */
  weekStart: string;
  /** Visible tasks completed within the week (Lima days). */
  doneCount: number;
  /** The last ones completed, the most recent first (at most 5). */
  recentDone: WeekReviewDoneTask[];
  /**
   * Pending, visible tasks due by the week's Sunday (overdue ones included), the oldest day first:
   * «Quedaron abiertas». At most `WEEK_REVIEW_OPEN_LIMIT`; `openCount` is the real total.
   */
  open: WeekReviewOpenTask[];
  openCount: number;
  /** Pending tasks in the inbox (no area, no project), as the inbox view lists them. */
  inboxCount: number;
};
