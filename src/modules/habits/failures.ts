// How a refused write of `habits` reads in an ActionResult (server only, shared by the actions).
import "server-only";
import { fail, INVALID_FIELDS_MESSAGE, type ActionResult } from "@/lib/action-result";
import { HABIT_ERRORS } from "./habit-input";
import { MEASURE_ERRORS } from "./measure-copy";
import { DETAILS_ERRORS } from "./history-copy";
import { PAUSE_ERRORS } from "./pause-copy";
import { SKIP_COPY } from "./skip-copy";
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
  if (failure === "avoidDaily") {
    return {
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: { frequency: [MEASURE_ERRORS.avoidDaily] },
    };
  }
  if (failure === "notQuantity") return fail(MEASURE_ERRORS.notQuantity);
  // H4: a pause's dates, on the field that shows them.
  if (failure === "pauseOverlap" || failure === "pauseStartOutOfWindow") {
    return {
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: {
        startDate: [
          failure === "pauseOverlap" ? PAUSE_ERRORS.overlap : PAUSE_ERRORS.startOutOfWindow,
        ],
      },
    };
  }
  if (failure === "pauseNotFound") return fail(PAUSE_ERRORS.notFound);
  if (failure === "avoidSkip") return fail(SKIP_COPY.avoidRefused);
  if (failure === "notScheduledToday") return fail(SKIP_COPY.notScheduled);
  // H5: a new habit's start date, on its field ("Más detalles").
  if (failure === "startDateOutOfWindow") {
    return {
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: { startDate: [DETAILS_ERRORS.startDateOutOfWindow] },
    };
  }
  return fail(HABIT_ERRORS[failure]);
}
