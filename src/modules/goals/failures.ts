// How a refused write of `goals` reads in an ActionResult (server only, shared by the actions).
import "server-only";
import { fail, INVALID_FIELDS_MESSAGE, type ActionResult } from "@/lib/action-result";
import type { GoalFailure } from "./goals";
import { GOAL_ERRORS } from "./goals-copy";

/** A refusal: on its field when it has one (the area), else the general message. */
export function refused<T>(failure: GoalFailure): ActionResult<T> {
  if (failure === "areaUnavailable") {
    return {
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: { areaId: [GOAL_ERRORS.areaUnavailable] },
    };
  }
  if (failure === "sourceUnavailable") {
    return {
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: { sourceKind: [GOAL_ERRORS.sourceUnavailable] },
    };
  }
  return fail(GOAL_ERRORS[failure]);
}
