// How a refused write of `habits` reads in an ActionResult (server only, shared by the actions).
import "server-only";
import { fail, INVALID_FIELDS_MESSAGE, type ActionResult } from "@/lib/action-result";
import { HABIT_ERRORS } from "./habit-input";
import type { HabitFailure } from "./habits";

/** A refusal: on its field when it has one (the area), else the general message. */
export function refused<T>(failure: HabitFailure): ActionResult<T> {
  if (failure === "areaUnavailable") {
    return {
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: { lifeAreaId: [HABIT_ERRORS.areaUnavailable] },
    };
  }
  return fail(HABIT_ERRORS[failure]);
}
