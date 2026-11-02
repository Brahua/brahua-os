// The keys of the advisory locks of `learning` (tracks.ts and steps.ts document the rules). Plain
// constants, no server-only: scripts and tests take the same locks without importing server code.

/** First key of every advisory lock `learning` takes (its namespace among the app's locks). */
export const LEARNING_ADVISORY_SPACE = 8_000;

/**
 * Second key of the status lock: `(8000, hashtext('learning:active'))`. The FIRST lock of every
 * transaction that changes which tracks are in progress or their place in a status: create, put in
 * progress, pause, finish, reopen, delete, restore and their «Deshacer». Two requests that would
 * each put a third track in progress wait for each other, so there are never more than 2.
 */
export const LEARNING_ACTIVE_KEY = "learning:active";

/**
 * Second key of one track's syllabus lock: `(8000, hashtext(<track id>))`, the first lock of every
 * write of its steps (add, paste, rename, check, delete, restore, reorder) and of a kind change
 * (a practice has no steps), so `position` stays contiguous and a reorder checks its list against
 * the set it is about to write.
 */
export const trackLockKey = (trackId: string) => trackId;
