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

/**
 * Second key of the timer lock: `(8000, hashtext('learning:timer'))`. The FIRST lock of every
 * write of `learning_sessions` (start, stop, «Anotar tiempo», remove, restore and their «Deshacer»):
 * two «Estudiar» at once wait for each other, so the second sees the first one's running session
 * (and stops it, or returns it) instead of failing on the partial unique index, which stays the
 * hard guarantee of a single running timer. Session writes never take the status or a track's lock.
 */
export const LEARNING_TIMER_KEY = "learning:timer";
