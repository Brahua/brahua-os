// The keys of the advisory locks of `weekly-review` (queries.ts and the W3 domain document the
// rules). Plain constants, no server-only: scripts and tests take the same locks without
// importing server code.

/** First key of every advisory lock `weekly-review` takes (its namespace among the app's locks). */
export const WEEKLY_REVIEW_ADVISORY_SPACE = 6_000;

/**
 * Second key of a week's lock: `(6000, hashtext(<week_start>))`, the FIRST lock of the
 * transaction that closes it (CLAUDE.md "Advisory locks": two keys, never after a row lock). One
 * lock per week, so two closes of the same week wait for each other (one row, the last note
 * wins) and different weeks never wait. `<week_start>` is the Monday as YYYY-MM-DD.
 */
export const weeklyReviewKey = (weekStart: string) => weekStart;
