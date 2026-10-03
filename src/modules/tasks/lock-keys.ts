// The keys of the advisory locks of `tasks` (tasks.ts documents the rules). Plain constants, no
// server-only: scripts (`pnpm db:demo`) take the same locks without importing server code.

/** First key of every advisory lock `tasks` takes (its namespace among the app's locks). */
export const TASKS_ADVISORY_SPACE = 3_000;
