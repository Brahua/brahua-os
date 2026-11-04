// The end «Terminar» proposes (SPEC-health "Terminar"): now, or after more than 4 h since the
// start (the session was left open) the last marked set + 5 min, kept between the start and now.
// Client-safe and pure.
import { LONG_SESSION_MS, PROPOSED_END_AFTER_LAST_SET_MS } from "./health-constants";

/** Whether the session ran more than 4 h (the sheet proposes an end the owner can correct). */
export function isLongSession(startedAt: string, now: number): boolean {
  return now - Date.parse(startedAt) > LONG_SESSION_MS;
}

/** The proposed end, in ms. `doneAts` are the ISO instants of the marked sets. */
export function proposedEnd(startedAt: string, doneAts: readonly string[], now: number): number {
  if (!isLongSession(startedAt, now)) return now;
  const start = Date.parse(startedAt);
  const lastDone = doneAts.reduce((latest, at) => Math.max(latest, Date.parse(at)), -Infinity);
  const base = Number.isFinite(lastDone) ? lastDone : start;
  return Math.min(Math.max(base + PROPOSED_END_AFTER_LAST_SET_MS, start), now);
}

/** Whether `end` (ms) can close a session that started at `startedAt`: from the start to now. */
export function isValidEnd(startedAt: string, end: number, now: number): boolean {
  return Number.isFinite(end) && end >= Date.parse(startedAt) && end <= now;
}
