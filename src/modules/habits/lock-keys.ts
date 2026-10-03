// The keys of the advisory locks of `habits` (habits.ts documents the rules). Plain constants, no
// server-only: scripts (`pnpm db:demo`) take the same locks without importing server code.

/** First key of every advisory lock `habits` takes (its namespace among the app's locks). */
export const HABITS_ADVISORY_SPACE = 4_000;

/** Second key of the order lock (create, reorder, archive, unarchive, delete, restore). */
export const HABITS_ORDER_KEY = "habits:order";
