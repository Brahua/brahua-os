// Validation and client types of `learning`'s sessions (L2, SPEC-learning "Cronómetro", "Sesión
// manual"). Client-safe: the sheets run the same schemas first; the actions are the authority and
// the database CHECKs the last line. Every «Deshacer» carries the id it acts on and what that
// change left, and writes only while the row still holds it (CLAUDE.md "Exact undo").
import { z } from "zod";
import { SESSION_MAX_MINUTES, SESSION_MIN_MINUTES, type SessionSource } from "./learning-constants";
import { LEARNING_ERRORS } from "./learning-copy";
import { SESSION_ERRORS as ERRORS } from "./sessions-copy";

// ── What the screens get ─────────────────────────────────────────────────────────────────────

/** The timer that runs now (one in the whole app), with its track's title. */
export type RunningSession = {
  id: string;
  trackId: string;
  trackTitle: string;
  /** ISO instant, to the millisecond. */
  startedAt: string;
};

/** An ended session as a track's page lists it. */
export type SessionItem = {
  id: string;
  source: SessionSource;
  /** ISO instants. */
  startedAt: string;
  endedAt: string;
  minutes: number;
};

/** A session a timer write just ended: what its «Deshacer» compares and sends back. */
export type StoppedSession = {
  id: string;
  trackId: string;
  trackTitle: string;
  minutes: number;
  /** ISO instant, to the millisecond. */
  endedAt: string;
};

/** «Estudiar»: the timer now running and, when another one was stopped to start it, that one. */
export type StartResult = { session: RunningSession; stopped: StoppedSession | null };

/** A track's minutes: this Lima week's and all of them (ended, live sessions). */
export type TrackMinutes = { week: number; total: number };

// ── Fields ───────────────────────────────────────────────────────────────────────────────────

const trackId = z.uuid({ error: LEARNING_ERRORS.notFound });
const id = z.uuid({ error: ERRORS.notFound });

/** Whole minutes, 1–600. */
export const sessionMinutesSchema = z
  .number({ error: ERRORS.minutes })
  .int(ERRORS.minutes)
  .min(SESSION_MIN_MINUTES, ERRORS.minutes)
  .max(SESSION_MAX_MINUTES, ERRORS.minutes);

/** Minutes, or none (the server computes them from the timer). */
const optionalMinutes = z.preprocess(
  (value) => (value === undefined ? null : value),
  sessionMinutesSchema.nullable(),
);

/** An instant as the client got it (ISO, to the millisecond). */
const instant = z.iso.datetime({ error: ERRORS.changed });

/** The form's minutes field as a number: NaN when it isn't a whole number (the schema says why). */
export function parseMinutesField(value: string): number {
  const text = value.trim();
  return /^\d{1,4}$/.test(text) ? Number(text) : Number.NaN;
}

/**
 * «Estudiar» on a track. When another timer runs it is stopped and saved in the same transaction;
 * if that one ran more than 4 h, `stopMinutes` carries the minutes the owner confirmed.
 */
export const startSessionInputSchema = z.object({ trackId, stopMinutes: optionalMinutes });
export type StartSessionInput = z.output<typeof startSessionInputSchema>;

/** «Detener»: that running session; `minutes` only after more than 4 h (confirmed or corrected). */
export const stopSessionInputSchema = z.object({ id, minutes: optionalMinutes });
export type StopSessionInput = z.output<typeof stopSessionInputSchema>;

const stoppedSnapshot = z.object({ id, endedAt: instant, minutes: sessionMinutesSchema });

/**
 * «Deshacer» of «Estudiar»: removes the session it started (while it still runs) and, when it
 * stopped another, runs that one again (while it still holds what the stop left).
 */
export const undoStartInputSchema = z
  .object({ id, stopped: stoppedSnapshot.nullable().default(null) })
  .refine((value) => value.stopped === null || value.stopped.id !== value.id, ERRORS.changed);
export type UndoStartInput = z.output<typeof undoStartInputSchema>;

/** «Deshacer» of «Detener»: runs it again, while it still holds what the stop left. */
export const undoStopInputSchema = stoppedSnapshot;
export type UndoStopInput = z.output<typeof undoStopInputSchema>;

/** «Anotar tiempo»: minutes on a day (today or up to 30 days back, checked against Lima's today). */
export const logSessionInputSchema = z.object({
  trackId,
  minutes: sessionMinutesSchema,
  day: z.iso.date({ error: ERRORS.day }),
});
export type LogSessionInput = z.output<typeof logSessionInputSchema>;

/** «Quitar» a session of a track, and its «Deshacer» (the same id back). */
export const sessionRefInputSchema = z.object({ trackId, id });
export type SessionRefInput = z.output<typeof sessionRefInputSchema>;
