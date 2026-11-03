// The keys of the advisory locks of `notes` (notes.ts documents the rules). Plain constants, no
// server-only: scripts and tests take the same locks without importing server code.

/** First key of every advisory lock `notes` takes (its namespace among the app's locks). */
export const NOTES_ADVISORY_SPACE = 9_000;

/**
 * Second key of one day's lock: `(9000, hashtext('notes:daily:' || day))`. The FIRST lock of every
 * write that may create that day's note (the first save; N3's quick capture) or bring one back
 * (restoring a deleted daily note): two at once wait for each other, so the second sees the
 * first one's row instead of failing on the partial unique index, which stays the hard guarantee
 * of one live note per day. Saving a note that exists takes no lock: its version decides.
 */
export const dailyNoteLockKey = (day: string) => `notes:daily:${day}`;
