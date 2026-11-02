"use server";

// Server Actions of a track's syllabus (L1). Each one goes through ownerAction(): owner check
// first, Zod, then an ActionResult. Reachable by any POST, so input is `unknown`; every write
// names the track and the data layer checks the step belongs to it.
import { fail, ok, UNEXPECTED_ERROR_MESSAGE, type ActionResult } from "@/lib/action-result";
import { getDb } from "@/lib/db";
import { ownerAction } from "@/lib/owner-action";
import { LEARNING_ERRORS } from "./learning-copy";
import { revalidateLearning } from "./revalidate";
import {
  addStepInputSchema,
  pasteStepsInputSchema,
  renameStepInputSchema,
  reorderStepsInputSchema,
  restoreStepInputSchema,
  stepDoneInputSchema,
  stepRefInputSchema,
  undoPasteInputSchema,
  undoStepDoneInputSchema,
  type StepDoneResult,
  type StepItem,
} from "./steps-input";
import { STEP_ERRORS } from "./steps-copy";
import {
  appendSteps,
  insertStep,
  removePastedSteps,
  removeStep,
  renameStepById,
  reorderStepsByIds,
  restoreStep,
  setStepDone,
  undoStepDone,
  type StepFailure,
} from "./steps";

/** Failures of the data layer, as the owner reads them. */
const FAILURES: Record<StepFailure, string> = {
  trackNotFound: LEARNING_ERRORS.notFound,
  stepNotFound: STEP_ERRORS.notFound,
  noSyllabus: STEP_ERRORS.noSyllabus,
  tooMany: STEP_ERRORS.tooMany,
  idTaken: UNEXPECTED_ERROR_MESSAGE,
  staleOrder: STEP_ERRORS.staleOrder,
};

const isFailure = (value: unknown): value is StepFailure =>
  typeof value === "string" && value in FAILURES;

/**
 * The result of a syllabus write. Revalidates either way: after a refusal, the response brings the
 * current syllabus (or the page's 404 when the track was deleted).
 */
function settle<T>(value: T | StepFailure): ActionResult<T> {
  revalidateLearning();
  return isFailure(value) ? fail(FAILURES[value]) : ok(value as T);
}

const add = ownerAction(
  addStepInputSchema,
  async (data) => settle(await insertStep(getDb(), data)),
  { name: "addStep" },
);

/** Adds a step at the end of the syllabus. */
export async function addStep(input: unknown): Promise<ActionResult<StepItem>> {
  return add(input);
}

const paste = ownerAction(
  pasteStepsInputSchema,
  async (data) => settle(await appendSteps(getDb(), data)),
  { name: "pasteSteps" },
);

/** «Pegar temario»: one step per non-blank line, at the end. Returns the steps added. */
export async function pasteSteps(input: unknown): Promise<ActionResult<StepItem[]>> {
  return paste(input);
}

const undoPaste = ownerAction(
  undoPasteInputSchema,
  async (data) => settle(await removePastedSteps(getDb(), data)),
  { name: "undoPasteSteps" },
);

/** «Deshacer» of a paste: removes the steps it added that are still there. */
export async function undoPasteSteps(input: unknown): Promise<ActionResult<number>> {
  return undoPaste(input);
}

const rename = ownerAction(
  renameStepInputSchema,
  async (data) => settle(await renameStepById(getDb(), data)),
  { name: "renameStep" },
);

/** Renames a step (1–200 characters). */
export async function renameStep(input: unknown): Promise<ActionResult<StepItem>> {
  return rename(input);
}

const done = ownerAction(
  stepDoneInputSchema,
  async (data) => settle(await setStepDone(getDb(), data)),
  { name: "setStepDone" },
);

/**
 * «Hecho» or unchecking: the state wanted, so it is idempotent. Returns the step and what it held
 * before, which the «Deshacer» sends back.
 */
export async function markStepDone(input: unknown): Promise<ActionResult<StepDoneResult>> {
  return done(input);
}

const undoDone = ownerAction(
  undoStepDoneInputSchema,
  async (data) => {
    const result = await undoStepDone(getDb(), data);
    revalidateLearning();
    if (isFailure(result)) return fail<StepItem>(FAILURES[result]);
    return result.restored ? ok(result.step) : fail<StepItem>(STEP_ERRORS.changed);
  },
  { name: "undoStepDone" },
);

/**
 * «Deshacer» of a check: back to what it was, only while the step still holds what that check
 * left. After another change nothing is written.
 */
export async function undoMarkStepDone(input: unknown): Promise<ActionResult<StepItem>> {
  return undoDone(input);
}

const remove = ownerAction(
  stepRefInputSchema,
  async (data) => settle(await removeStep(getDb(), data)),
  { name: "removeStep" },
);

/** Removes a step; the result carries what «Deshacer» needs (the row and its position). */
export async function deleteStep(
  input: unknown,
): Promise<ActionResult<{ step: StepItem; position: number }>> {
  return remove(input);
}

const restore = ownerAction(
  restoreStepInputSchema,
  async (data) => settle(await restoreStep(getDb(), data)),
  { name: "restoreStep" },
);

/** «Deshacer» of a remove: the same step back in its place. Twice changes nothing. */
export async function undoDeleteStep(input: unknown): Promise<ActionResult<StepItem[]>> {
  return restore(input);
}

const reorder = ownerAction(
  reorderStepsInputSchema,
  async ({ trackId, ids }) => settle(await reorderStepsByIds(getDb(), trackId, ids)),
  { name: "reorderSteps" },
);

/**
 * Writes the new order. A list that isn't exactly the track's live steps (stale or tampered with)
 * is refused without writing anything, and the response brings the current syllabus.
 */
export async function reorderSteps(input: unknown): Promise<ActionResult<StepItem[]>> {
  return reorder(input);
}
