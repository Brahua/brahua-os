"use server";

// Server Actions of `learning`'s tracks (L1): create, settings, status (and its «Deshacer»),
// delete and restore. Each one goes through ownerAction(): owner check first, Zod, then an
// ActionResult (SPEC-core "Estilo de código"). Reachable by any POST, so input is `unknown`.
import { fail, INVALID_FIELDS_MESSAGE, ok, type ActionResult } from "@/lib/action-result";
import { getDb } from "@/lib/db";
import { ownerAction } from "@/lib/owner-action";
import { LEARNING_ERRORS } from "./learning-copy";
import { revalidateLearning } from "./revalidate";
import {
  changeTrackStatus,
  insertTrack,
  restoreTrackById,
  softDeleteTrack,
  undoStatusChanges,
  updateTrackFields,
  type TrackFailure,
} from "./tracks";
import {
  changeStatusInputSchema,
  createTrackInputSchema,
  trackIdInputSchema,
  undoStatusInputSchema,
  updateTrackInputSchema,
  type CreateResult,
  type DeletedTrack,
  type RestoreResult,
  type StatusResult,
  type TrackItem,
} from "./tracks-input";

/** A refusal: on its field when it has one, else the general message. */
function refused<T>(failure: TrackFailure): ActionResult<T> {
  const field =
    failure === "projectUnavailable"
      ? "projectId"
      : failure === "practiceHasSteps"
        ? "kind"
        : failure === "limitReached" || failure === "pauseUnavailable"
          ? "pauseTrackId"
          : null;
  if (field === null) return fail(LEARNING_ERRORS[failure]);
  return {
    ok: false,
    error: field === "pauseTrackId" ? LEARNING_ERRORS[failure] : INVALID_FIELDS_MESSAGE,
    fieldErrors: { [field]: [LEARNING_ERRORS[failure]] },
  };
}

/** Either way: after a refusal, the response brings the current tracks. */
function settle<T>(value: T | TrackFailure): ActionResult<T> {
  revalidateLearning();
  return typeof value === "string" ? refused<T>(value as TrackFailure) : ok(value);
}

const create = ownerAction(
  createTrackInputSchema,
  async (data) => settle(await insertTrack(getDb(), data)),
  { name: "createTrack" },
);

/**
 * «Nuevo frente» (SPEC-learning "Pantallas"): the track with its pasted syllabus, in progress or
 * waiting. With 2 in progress already, it goes in progress only by naming the one that moves to
 * «En espera» (`pauseTrackId`); otherwise it is refused (`limitReached`), never a third.
 */
export async function createTrack(input: unknown): Promise<ActionResult<CreateResult>> {
  return create(input);
}

const update = ownerAction(
  updateTrackInputSchema,
  async (data) => settle(await updateTrackFields(getDb(), data)),
  { name: "updateTrack" },
);

/** «Ajustes»: every field of the form, sent whole. Returns the track as it is now. */
export async function updateTrack(input: unknown): Promise<ActionResult<TrackItem>> {
  return update(input);
}

const change = ownerAction(
  changeStatusInputSchema,
  async (data) => settle(await changeTrackStatus(getDb(), data)),
  { name: "changeTrackStatus" },
);

/**
 * «Poner en curso», «Pasar a espera», «Terminar», «Reabrir»: the status wanted (idempotent). The
 * result carries every change made (two for a swap): the «Deshacer» sends them back.
 */
export async function changeStatus(input: unknown): Promise<ActionResult<StatusResult>> {
  return change(input);
}

const undoChange = ownerAction(
  undoStatusInputSchema,
  async (data) => {
    const result = await undoStatusChanges(getDb(), data);
    revalidateLearning();
    return result.restored ? ok(result) : fail<{ restored: boolean }>(LEARNING_ERRORS.changed);
  },
  { name: "undoTrackStatus" },
);

/**
 * «Deshacer» of a status change: each track back exactly as it was, only while it still has the
 * status the change left (and never a third in progress). Otherwise nothing changes.
 */
export async function undoStatus(input: unknown): Promise<ActionResult<{ restored: boolean }>> {
  return undoChange(input);
}

const remove = ownerAction(
  trackIdInputSchema,
  async ({ id }) => {
    const deleted = await softDeleteTrack(getDb(), id);
    revalidateLearning();
    return deleted ? ok(deleted) : fail<DeletedTrack>(LEARNING_ERRORS.notFound);
  },
  { name: "deleteTrack" },
);

/** Soft delete: out of every view with its steps, back with «Deshacer». */
export async function deleteTrack(input: unknown): Promise<ActionResult<DeletedTrack>> {
  return remove(input);
}

const restore = ownerAction(
  trackIdInputSchema,
  async ({ id }) => {
    const restored = await restoreTrackById(getDb(), id);
    revalidateLearning();
    return restored ? ok(restored) : fail<RestoreResult>(LEARNING_ERRORS.notFound);
  },
  { name: "restoreTrack" },
);

/** «Deshacer» of a delete. One that was in progress comes back waiting when 2 already are. */
export async function restoreTrack(input: unknown): Promise<ActionResult<RestoreResult>> {
  return restore(input);
}
