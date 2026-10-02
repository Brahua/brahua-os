// Plain constants of `habits` shared by the Zod schemas (client and server) and the database
// CHECK constraints (SPEC-habits "Modelo de datos"). No server code: the client imports them.

/** `build`: a habit to keep (the usual one). `avoid`: one to quit; a tap logs a relapse (H3). */
export const HABIT_KINDS = ["build", "avoid"] as const;
export type HabitKind = (typeof HABIT_KINDS)[number];

/** `check`: yes/no, one tap marks the day. `quantity`: a goal with a unit and a step (H3). */
export const HABIT_MEASURES = ["check", "quantity"] as const;
export type HabitMeasure = (typeof HABIT_MEASURES)[number];

/** Every day; X times a week, any day (H2); fixed days of the week (H2). */
export const HABIT_FREQUENCIES = ["daily", "weekly_count", "weekdays"] as const;
export type HabitFrequency = (typeof HABIT_FREQUENCIES)[number];

export const HABIT_NAME_MAX_LENGTH = 80;
export const HABIT_IDENTITY_MAX_LENGTH = 120;
export const HABIT_CUE_MAX_LENGTH = 60;
export const HABIT_UNIT_MAX_LENGTH = 20;
/** A quantity habit's daily goal: 1–10 000 (a check habit's is always 1). */
export const HABIT_GOAL_MAX = 10_000;
/** X of `weekly_count`: 1–6 (seven a week is "Diaria"). */
export const HABIT_WEEKLY_TARGET_MAX = 6;
/** Days of `weekdays`: 1–6 (the seven days are "Diaria"). */
export const HABIT_WEEKDAYS_MAX = 6;
/** What one day can hold: 0–99 999 (whole numbers only). */
export const HABIT_QUANTITY_MAX = 99_999;
/** A pause lasts at most this many days, both ends included. */
export const HABIT_PAUSE_MAX_DAYS = 90;
export const HABIT_PAUSE_REASON_MAX_LENGTH = 60;
/** Days before today that can still be logged or corrected (SPEC-habits "Registro atrás"). */
export const HABIT_LOG_WINDOW_DAYS = 7;
/** H4: a pause can start this many days ahead at most (a planned trip; conservative bound). */
export const HABIT_PAUSE_START_AHEAD_DAYS = 365;
