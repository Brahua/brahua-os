// The keys of the advisory locks of `goals` (goals.ts documents the rules). Plain constants, no
// server-only: scripts and tests take the same locks without importing server code.

/** First key of every advisory lock `goals` takes (its namespace among the app's locks). */
export const GOALS_ADVISORY_SPACE = 5_000;

/** Second key of the order lock (create, reorder, archive, unarchive, delete, restore). */
export const GOALS_ORDER_KEY = "goals:order";

/**
 * Second key of one week's lock (the weekly objective: set, clear and undo). One lock per week, so
 * two edits of the same week wait for each other and different weeks never do.
 */
export const goalsWeekKey = (weekStart: string) => `goals:weekly:${weekStart}`;
