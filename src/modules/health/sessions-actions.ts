"use server";

// Server Actions of the sessions, their exercises and sets (E2). Each one goes through
// ownerAction(): owner check first, Zod, then an ActionResult. Reachable by any POST, so input is
// `unknown`; every write names its session and the data layer checks the rows are its.
//
// They do NOT revalidate (HANDOFF «Cómo funciona health → E1»): in this Next any revalidatePath in
// a Server Action renders the open page again, and the session screen is driven by its own state
// and settles from what each action returns. /health and /health/sessions are dynamic and are read
// again on navigation. Only the list's «Deshacer» of a delete revalidates (its page must show the
// session back).
import { fail, INVALID_FIELDS_MESSAGE, ok, type ActionResult } from "@/lib/action-result";
import { getDb } from "@/lib/db";
import { ownerAction } from "@/lib/owner-action";
import type { SessionRecord } from "./records";
import { selectSessionRecords } from "./records-data";
import { revalidateHealth } from "./revalidate";
import {
  addExercise,
  addSet,
  deleteSession,
  finishSession,
  removeExercise,
  removeSet,
  reorderExercises,
  restoreExercise,
  restoreSession,
  restoreSet,
  startSession,
  undoFinish,
  updateNote,
  updateSet,
  updateTimes,
  type SessionFailure,
} from "./sessions";
import { SESSION_ERRORS } from "./sessions-copy";
import {
  addExerciseInputSchema,
  addSetInputSchema,
  exerciseRefInputSchema,
  finishSessionInputSchema,
  reorderExercisesInputSchema,
  restoreExerciseInputSchema,
  restoreSetInputSchema,
  sessionRefInputSchema,
  setRefInputSchema,
  startSessionInputSchema,
  undoFinishInputSchema,
  updateNoteInputSchema,
  updateSetInputSchema,
  updateTimesInputSchema,
  type FinishResult,
  type SessionDetail,
  type SessionExercise,
  type SessionSet,
  type SessionTimes,
  type StartResult,
} from "./sessions-input";

const MESSAGES: Record<Exclude<SessionFailure, object>, string> = {
  notFound: SESSION_ERRORS.notFound,
  routineNotFound: SESSION_ERRORS.routineNotFound,
  exerciseNotFound: SESSION_ERRORS.exerciseNotFound,
  setNotFound: SESSION_ERRORS.setNotFound,
  exerciseUnavailable: SESSION_ERRORS.exerciseUnavailable,
  tooManyExercises: SESSION_ERRORS.tooManyExercises,
  tooManySets: SESSION_ERRORS.tooManySets,
  staleOrder: SESSION_ERRORS.staleOrder,
  idTaken: SESSION_ERRORS.idTaken,
  notOpen: SESSION_ERRORS.notOpen,
  notFinished: SESSION_ERRORS.notFinished,
  noDoneSets: SESSION_ERRORS.noDoneSets,
  endOutOfRange: SESSION_ERRORS.endOutOfRange,
  startInFuture: SESSION_ERRORS.startInFuture,
  changed: SESSION_ERRORS.changed,
  otherOpen: SESSION_ERRORS.otherOpen,
};

const isFailure = (value: unknown): value is SessionFailure =>
  (typeof value === "string" && value in MESSAGES) ||
  (typeof value === "object" && value !== null && "missing" in value);

/** The result of a write, as the owner reads a refusal. */
function settle<T>(value: T | SessionFailure): ActionResult<T> {
  if (!isFailure(value)) return ok(value as T);
  if (typeof value === "string") return fail(MESSAGES[value]);
  return {
    ok: false,
    error: INVALID_FIELDS_MESSAGE,
    fieldErrors: { [value.missing]: [SESSION_ERRORS.missing[value.missing]] },
  };
}

const start = ownerAction(
  startSessionInputSchema,
  async ({ routineId }) => settle(await startSession(getDb(), routineId)),
  { name: "startHealthSession" },
);

/** «Empezar» (a routine, or free). With a session open, nothing starts: its id comes back. */
export async function startHealthSession(input: unknown): Promise<ActionResult<StartResult>> {
  return start(input);
}

const addOne = ownerAction(
  addExerciseInputSchema,
  async (data) => settle(await addExercise(getDb(), data)),
  { name: "addSessionExercise" },
);

/** «Agregar ejercicio» at the end, with its planned sets prefilled. */
export async function addSessionExercise(input: unknown): Promise<ActionResult<SessionExercise>> {
  return addOne(input);
}

const removeOne = ownerAction(
  exerciseRefInputSchema,
  async (data) => settle(await removeExercise(getDb(), data)),
  { name: "removeSessionExercise" },
);

export async function removeSessionExercise(
  input: unknown,
): Promise<ActionResult<{ id: string; position: number }>> {
  return removeOne(input);
}

const restoreOne = ownerAction(
  restoreExerciseInputSchema,
  async (data) => settle(await restoreExercise(getDb(), data)),
  { name: "restoreSessionExercise" },
);

/** «Deshacer» of a remove: back in its place with its sets. Twice changes nothing. */
export async function restoreSessionExercise(
  input: unknown,
): Promise<ActionResult<SessionExercise[]>> {
  return restoreOne(input);
}

const reorder = ownerAction(
  reorderExercisesInputSchema,
  async (data) => settle(await reorderExercises(getDb(), data)),
  { name: "reorderSessionExercises" },
);

export async function reorderSessionExercises(
  input: unknown,
): Promise<ActionResult<{ ids: string[] }>> {
  return reorder(input);
}

const addOneSet = ownerAction(
  addSetInputSchema,
  async (data) => settle(await addSet(getDb(), data)),
  { name: "addHealthSet" },
);

/** «Añadir serie» (copies the one before, on the client). */
export async function addHealthSet(input: unknown): Promise<ActionResult<SessionSet>> {
  return addOneSet(input);
}

const editSet = ownerAction(
  updateSetInputSchema,
  async (data) => settle(await updateSet(getDb(), data)),
  { name: "updateHealthSet" },
);

/** A set whole: values, «Calentamiento», «hecha» (marking needs its kind's values). */
export async function updateHealthSet(input: unknown): Promise<ActionResult<SessionSet>> {
  return editSet(input);
}

const removeOneSet = ownerAction(
  setRefInputSchema,
  async (data) => settle(await removeSet(getDb(), data)),
  { name: "removeHealthSet" },
);

export async function removeHealthSet(
  input: unknown,
): Promise<ActionResult<{ id: string; position: number }>> {
  return removeOneSet(input);
}

const restoreOneSet = ownerAction(
  restoreSetInputSchema,
  async (data) => settle(await restoreSet(getDb(), data)),
  { name: "restoreHealthSet" },
);

/** «Deshacer» of removing a set: the exercise's sets as they are now. */
export async function restoreHealthSet(input: unknown): Promise<ActionResult<SessionSet[]>> {
  return restoreOneSet(input);
}

const note = ownerAction(
  updateNoteInputSchema,
  async (data) => settle(await updateNote(getDb(), data)),
  { name: "updateSessionNote" },
);

export async function updateSessionNote(
  input: unknown,
): Promise<ActionResult<{ note: string | null }>> {
  return note(input);
}

const times = ownerAction(
  updateTimesInputSchema,
  async (data) => settle(await updateTimes(getDb(), data)),
  { name: "updateSessionTimes" },
);

/** The start and end of a finished session. */
export async function updateSessionTimes(input: unknown): Promise<ActionResult<SessionTimes>> {
  return times(input);
}

const finish = ownerAction(
  finishSessionInputSchema,
  async (data) => settle(await finishSession(getDb(), data)),
  { name: "finishHealthSession" },
);

/** «Terminar»: the planned sets go; the result carries what «Deshacer» brings back. */
export async function finishHealthSession(input: unknown): Promise<ActionResult<FinishResult>> {
  return finish(input);
}

const undo = ownerAction(
  undoFinishInputSchema,
  async (data) => settle(await undoFinish(getDb(), data)),
  { name: "undoFinishHealthSession" },
);

/** «Deshacer» of «Terminar»: reopens it with exactly the sets it removed, if untouched since. */
export async function undoFinishHealthSession(
  input: unknown,
): Promise<ActionResult<SessionDetail>> {
  return undo(input);
}

const remove = ownerAction(
  sessionRefInputSchema,
  async ({ sessionId }) => settle(await deleteSession(getDb(), sessionId)),
  { name: "deleteHealthSession" },
);

/** «Descartar la sesión» (open) or «Eliminar sesión» (finished): a soft delete. */
export async function deleteHealthSession(
  input: unknown,
): Promise<ActionResult<{ id: string; routineName: string | null }>> {
  return remove(input);
}

const restore = ownerAction(
  sessionRefInputSchema,
  async ({ sessionId }) => {
    const result = settle(await restoreSession(getDb(), sessionId));
    // The list's «Deshacer»: its page shows the session back.
    revalidateHealth();
    return result;
  },
  { name: "restoreHealthSession" },
);

/** «Deshacer» of a delete or discard (an open one only while no other is open). */
export async function restoreHealthSession(input: unknown): Promise<ActionResult<{ id: string }>> {
  return restore(input);
}

const records = ownerAction(
  sessionRefInputSchema,
  async ({ sessionId }) => ok(await selectSessionRecords(getDb(), sessionId)),
  { name: "readHealthSessionRecords" },
);

/**
 * The new records of a finished session, read again after a correction on its screen (a set, the
 * times): they are derived, so the summary follows what was edited. A read: nothing revalidates.
 */
export async function readHealthSessionRecords(
  input: unknown,
): Promise<ActionResult<SessionRecord[]>> {
  return records(input);
}
