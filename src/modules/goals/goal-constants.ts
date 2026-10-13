// Plain constants of `goals` shared by the Zod schemas (client and server) and the database CHECK
// constraints (SPEC-goals "Modelo de datos"). No server code: the client imports them.

/** A goal belongs to a calendar year or to one calendar quarter (T1–T4), in Lima. */
export const GOAL_PERIOD_KINDS = ["year", "quarter"] as const;
export type GoalPeriodKind = (typeof GOAL_PERIOD_KINDS)[number];

/** Exactly one source of progress per goal (SPEC-goals "Decisiones"). */
export const GOAL_SOURCE_KINDS = ["habit", "project", "manual"] as const;
export type GoalSourceKind = (typeof GOAL_SOURCE_KINDS)[number];

/** `achieved` is reached on its own (or by hand) and can be reopened; `archived` is out of the way. */
export const GOAL_STATUSES = ["active", "achieved", "archived"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export const GOAL_TITLE_MAX_LENGTH = 80;
export const GOAL_NOTES_MAX_LENGTH = 2_000;
export const GOAL_UNIT_MAX_LENGTH = 20;
/** `target`: days (habit), units (manual); a project's is fixed at 100. */
export const GOAL_TARGET_MAX = 100_000;
/** A project goal's target is always 100 (its percentage). */
export const GOAL_PROJECT_TARGET = 100;
/** One manual entry: |delta| up to this, never zero. */
export const GOAL_DELTA_MAX = 100_000;
export const GOAL_YEAR_MIN = 2000;
export const GOAL_YEAR_MAX = 2100;
/** The weekly objective: one short text per Monday–Sunday week (G3 fills it in). */
export const WEEKLY_OBJECTIVE_MAX_LENGTH = 140;
