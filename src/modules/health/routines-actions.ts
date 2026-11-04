"use server";

// Server Actions of the routines and their exercises (E1). Each one goes through ownerAction():
// owner check first, Zod, then an ActionResult. Reachable by any POST, so input is `unknown`;
// every item write names the routine and the data layer checks the item belongs to it.
import { fail, INVALID_FIELDS_MESSAGE, ok, type ActionResult } from "@/lib/action-result";
import { getDb } from "@/lib/db";
import { ownerAction } from "@/lib/owner-action";
import { revalidateHealth } from "./revalidate";
import {
  insertItem,
  removeItem,
  reorderItemsByIds,
  restoreItem,
  updateItem,
  type ItemFailure,
} from "./routine-items";
import {
  insertRoutine,
  renameRoutineById,
  reorderRoutinesByIds,
  restoreRoutineById,
  softDeleteRoutine,
} from "./routines";
import { ROUTINE_ERRORS } from "./routines-copy";
import {
  addItemInputSchema,
  createRoutineInputSchema,
  itemRefInputSchema,
  renameRoutineInputSchema,
  reorderItemsInputSchema,
  reorderRoutinesInputSchema,
  restoreItemInputSchema,
  routineIdInputSchema,
  updateItemInputSchema,
  type RoutineItem,
  type RoutineRef,
  type RoutineSummary,
} from "./routines-input";

/** Failures of the data layer, as the owner reads them. */
const MESSAGES = {
  notFound: ROUTINE_ERRORS.notFound,
  routineNotFound: ROUTINE_ERRORS.notFound,
  itemNotFound: ROUTINE_ERRORS.itemNotFound,
  exerciseUnavailable: ROUTINE_ERRORS.exerciseUnavailable,
  tooMany: ROUTINE_ERRORS.tooMany,
  idTaken: ROUTINE_ERRORS.idTaken,
  staleOrder: ROUTINE_ERRORS.staleOrder,
  itemsChanged: ROUTINE_ERRORS.itemsChanged,
  targetsChanged: ROUTINE_ERRORS.targetsChanged,
} as const;
type Failure = keyof typeof MESSAGES | Exclude<ItemFailure, string>;

const isFailure = (value: unknown): value is Failure =>
  (typeof value === "string" && value in MESSAGES) ||
  (typeof value === "object" && value !== null && "wrongTarget" in value);

/**
 * The result of a write. Revalidates either way: after a refusal, the response brings the current
 * routine (or the page's 404 when the routine was deleted).
 */
function settle<T>(value: T | Failure): ActionResult<T> {
  revalidateHealth();
  if (!isFailure(value)) return ok(value as T);
  if (typeof value === "string") return fail(MESSAGES[value]);
  return {
    ok: false,
    error: INVALID_FIELDS_MESSAGE,
    fieldErrors: { [value.wrongTarget]: [ROUTINE_ERRORS.wrongTarget] },
  };
}

// ── Routines ──────────────────────────────────────────────────────────────────────────────

const create = ownerAction(
  createRoutineInputSchema,
  async () => settle(await insertRoutine(getDb())),
  { name: "createRoutine" },
);

/** «Nueva rutina»: at the end, named «Rutina A» (or the next free letter). */
export async function createRoutine(input: unknown): Promise<ActionResult<RoutineSummary>> {
  return create(input);
}

const rename = ownerAction(
  renameRoutineInputSchema,
  async (data) => settle(await renameRoutineById(getDb(), data)),
  { name: "renameRoutine" },
);

export async function renameRoutine(input: unknown): Promise<ActionResult<RoutineRef>> {
  return rename(input);
}

const remove = ownerAction(
  routineIdInputSchema,
  async ({ id }) => settle(await softDeleteRoutine(getDb(), id)),
  { name: "deleteRoutine" },
);

/** Soft delete: out of the list with its exercises, back with «Deshacer». */
export async function deleteRoutine(input: unknown): Promise<ActionResult<RoutineRef>> {
  return remove(input);
}

const restore = ownerAction(
  routineIdInputSchema,
  async ({ id }) => settle(await restoreRoutineById(getDb(), id)),
  { name: "restoreRoutine" },
);

/**
 * «Deshacer» of a delete: back in its place. Twice changes nothing. Refused when one of its
 * exercises was deleted or changed how it is measured meanwhile.
 */
export async function restoreRoutine(input: unknown): Promise<ActionResult<RoutineSummary[]>> {
  return restore(input);
}

const reorder = ownerAction(
  reorderRoutinesInputSchema,
  async ({ ids }) => settle(await reorderRoutinesByIds(getDb(), ids)),
  { name: "reorderRoutines" },
);

/** The new order; a list that isn't exactly the live routines is refused without writing. */
export async function reorderRoutines(input: unknown): Promise<ActionResult<RoutineSummary[]>> {
  return reorder(input);
}

// ── A routine's exercises ─────────────────────────────────────────────────────────────────

const add = ownerAction(
  addItemInputSchema,
  async (data) => settle(await insertItem(getDb(), data)),
  { name: "addRoutineItem" },
);

/** Adds an exercise at the end (at most 30); its targets must fit how it is measured. */
export async function addRoutineItem(input: unknown): Promise<ActionResult<RoutineItem>> {
  return add(input);
}

const edit = ownerAction(
  updateItemInputSchema,
  async (data) => settle(await updateItem(getDb(), data)),
  { name: "updateRoutineItem" },
);

/** Its targets, sent whole. */
export async function updateRoutineItem(input: unknown): Promise<ActionResult<RoutineItem>> {
  return edit(input);
}

const removeOne = ownerAction(
  itemRefInputSchema,
  async (data) => settle(await removeItem(getDb(), data)),
  { name: "removeRoutineItem" },
);

/** Removes an exercise; the result carries what «Deshacer» needs (the row and its position). */
export async function removeRoutineItem(
  input: unknown,
): Promise<ActionResult<{ item: RoutineItem; position: number }>> {
  return removeOne(input);
}

const restoreOne = ownerAction(
  restoreItemInputSchema,
  async (data) => settle(await restoreItem(getDb(), data)),
  { name: "restoreRoutineItem" },
);

/** «Deshacer» of a remove: the same item back in its place. Twice changes nothing. */
export async function restoreRoutineItem(input: unknown): Promise<ActionResult<RoutineItem[]>> {
  return restoreOne(input);
}

const reorderItems = ownerAction(
  reorderItemsInputSchema,
  async ({ routineId, ids }) => settle(await reorderItemsByIds(getDb(), routineId, ids)),
  { name: "reorderRoutineItems" },
);

/** The new order; a list that isn't exactly the routine's live items is refused. */
export async function reorderRoutineItems(input: unknown): Promise<ActionResult<RoutineItem[]>> {
  return reorderItems(input);
}
