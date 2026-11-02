"use server";

// Server Actions of `learning`'s time (L2): the timer («Estudiar», «Detener» and their «Deshacer»),
// «Anotar tiempo», and removing a session with its «Deshacer». Each one goes through ownerAction():
// owner check first, Zod, then an ActionResult. Reachable by any POST, so input is `unknown`. L3's
// card in Hoy calls `startSession` and `stopSession` too.
import { fail, INVALID_FIELDS_MESSAGE, ok, type ActionResult } from "@/lib/action-result";
import { getDb } from "@/lib/db";
import { ownerAction } from "@/lib/owner-action";
import { LEARNING_ERRORS } from "./learning-copy";
import { revalidateLearning } from "./revalidate";
import {
  insertManualSession,
  removeSession as removeSessionRow,
  restoreSession as restoreSessionRow,
  startTimer,
  stopTimer,
  undoStartTimer,
  undoStopTimer,
  type SessionFailure,
  type TooManyMinutes,
} from "./sessions";
import { SESSION_ERRORS } from "./sessions-copy";
import {
  logSessionInputSchema,
  sessionRefInputSchema,
  startSessionInputSchema,
  stopSessionInputSchema,
  undoStartInputSchema,
  undoStopInputSchema,
  type SessionItem,
  type StartResult,
  type StoppedSession,
} from "./sessions-input";

/** Failures without a field of their own, as the owner reads them. */
const MESSAGES: Record<Exclude<SessionFailure, "confirmNeeded" | "dayOutOfRange">, string> = {
  trackNotFound: LEARNING_ERRORS.notFound,
  trackDone: SESSION_ERRORS.trackDone,
  notRunning: SESSION_ERRORS.notRunning,
  sessionNotFound: SESSION_ERRORS.notFound,
  changed: SESSION_ERRORS.changed,
};

const onField = <T>(field: string, message: string): ActionResult<T> => ({
  ok: false,
  error: field === "minutes" || field === "day" ? INVALID_FIELDS_MESSAGE : message,
  fieldErrors: { [field]: [message] },
});

/**
 * A refusal. «Confirm the minutes» goes on `minutes` (the screen opens the sheet when it didn't
 * send any), or on `stopMinutes` for «Estudiar» that would stop a long timer.
 */
function refused<T>(failure: SessionFailure | TooManyMinutes, minutesField = "minutes") {
  if (typeof failure !== "string") {
    return onField<T>(minutesField, SESSION_ERRORS.tooManyMinutes(failure.max));
  }
  if (failure === "confirmNeeded") return onField<T>(minutesField, SESSION_ERRORS.confirmNeeded);
  if (failure === "dayOutOfRange") return onField<T>("day", SESSION_ERRORS.day);
  return fail<T>(MESSAGES[failure]);
}

/** Either way: after a refusal, the response brings the current timer and sessions. */
function settle<T>(value: T | SessionFailure | TooManyMinutes, minutesField?: string) {
  revalidateLearning();
  const failed =
    typeof value === "string" ||
    (typeof value === "object" && value !== null && "failure" in value);
  return failed
    ? refused<T>(value as SessionFailure | TooManyMinutes, minutesField)
    : ok(value as T);
}

const start = ownerAction(
  startSessionInputSchema,
  async (data) => settle(await startTimer(getDb(), data), "stopMinutes"),
  { name: "startSession" },
);

/**
 * «Estudiar»: the timer starts on the track (or keeps running, when it already does). Another
 * track's timer is stopped and saved in the same transaction; after more than 4 h only with the
 * confirmed `stopMinutes` (otherwise `fieldErrors.stopMinutes`).
 */
export async function startSession(input: unknown): Promise<ActionResult<StartResult>> {
  return start(input);
}

const stop = ownerAction(
  stopSessionInputSchema,
  async (data) => settle(await stopTimer(getDb(), data)),
  { name: "stopSession" },
);

/**
 * «Detener»: saves the running session's minutes. After more than 4 h it needs `minutes`
 * (confirmed or corrected; otherwise `fieldErrors.minutes`). Returns what «Deshacer» sends back.
 */
export async function stopSession(input: unknown): Promise<ActionResult<StoppedSession>> {
  return stop(input);
}

const undoStart = ownerAction(
  undoStartInputSchema,
  async (data) => settle(await undoStartTimer(getDb(), data)),
  { name: "undoStartSession" },
);

/** «Deshacer» of «Estudiar»: the session it started goes, and the one it stopped runs again. */
export async function undoStartSession(input: unknown): Promise<ActionResult<{ restored: true }>> {
  return undoStart(input);
}

const undoStop = ownerAction(
  undoStopInputSchema,
  async (data) => settle(await undoStopTimer(getDb(), data)),
  { name: "undoStopSession" },
);

/** «Deshacer» of «Detener»: the timer runs again from when it started. */
export async function undoStopSession(input: unknown): Promise<ActionResult<{ restored: true }>> {
  return undoStop(input);
}

const log = ownerAction(
  logSessionInputSchema,
  async (data) => settle(await insertManualSession(getDb(), data, new Date())),
  { name: "logSession" },
);

/** «Anotar tiempo»: minutes on a day, today or up to 30 days back. Returns the session created. */
export async function logSession(input: unknown): Promise<ActionResult<SessionItem>> {
  return log(input);
}

const remove = ownerAction(
  sessionRefInputSchema,
  async (data) => settle(await removeSessionRow(getDb(), data)),
  { name: "removeSession" },
);

/** «Quitar» a session (and «Deshacer» of «Anotar tiempo»: the session it created, by its id). */
export async function removeSession(input: unknown): Promise<ActionResult<SessionItem>> {
  return remove(input);
}

const restore = ownerAction(
  sessionRefInputSchema,
  async (data) => settle(await restoreSessionRow(getDb(), data)),
  { name: "restoreSession" },
);

/** «Deshacer» of «Quitar»: the same session back. */
export async function restoreSession(input: unknown): Promise<ActionResult<SessionItem>> {
  return restore(input);
}
