// The optional time of a task ("polish → task-time"): `due_time`, a wall-clock time in Lima
// (no zone, minute precision), only with a due date. Pure and client-safe. With `due_date` it is
// the instant a notice would fire (`reminders`: `dueDate` + `dueTime`, both Lima).

/** HH:MM, 24 h, 00:00–23:59. */
export const DUE_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export const isDueTime = (value: string): boolean => DUE_TIME_PATTERN.test(value);

/**
 * A Postgres `time` ("10:00:00", "10:00:00.5") or an HH:MM as HH:MM; null for anything else, so
 * a stored value never reaches the UI in another shape.
 */
export function normalizeDueTime(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const short = value.slice(0, 5);
  return DUE_TIME_PATTERN.test(short) ? short : null;
}

/** What a row shows: "10:00" (24 h, as stored). */
export const formatDueTime = (time: string): string => time;

/**
 * Orders two optional times: the ones WITH a time first (by time), the ones without after. 0 when
 * both are equal (both without one, or the same time).
 */
export function compareDueTime(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}
