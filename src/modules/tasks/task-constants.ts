// Plain constants of `tasks` shared by the Zod schemas (client and server) and the database
// CHECK constraints (SPEC-tasks "Modelo de datos"). No server code: the client imports them.

/** Priority, like projects. UI: Baja, Media, Alta (Media by default). */
export const TASK_PRIORITIES = ["low", "medium", "high"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/**
 * Recurrence rules (T3): every N days / weeks / months counted from when it is completed, some
 * days of the week, or day X of the month.
 */
export const RECURRENCE_KINDS = [
  "every_days",
  "every_weeks",
  "every_months",
  "weekdays",
  "month_day",
] as const;
export type RecurrenceKind = (typeof RECURRENCE_KINDS)[number];

/** The rules that use `recurrence_interval` (N). */
export const INTERVAL_RECURRENCE_KINDS = ["every_days", "every_weeks", "every_months"] as const;

export const TASK_TITLE_MAX_LENGTH = 200;
export const TASK_NOTES_MAX_LENGTH = 20_000;
export const TASK_TAG_NAME_MAX_LENGTH = 30;
/** At most this many tags on one task (T4). */
export const TASK_TAGS_MAX = 10;
export const RECURRENCE_INTERVAL_MAX = 365;
/** ISO weekdays: 1 = Monday … 7 = Sunday. */
export const ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export const MONTH_DAY_MAX = 31;
