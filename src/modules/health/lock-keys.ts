// The keys of the advisory locks of `health` (routines.ts and exercises.ts document the rules).
// Plain constants, no server-only: scripts and tests take the same locks without importing server
// code.

/**
 * First key of every advisory lock `health` takes (its namespace among the app's locks: 5000 and
 * 6000 are shared already, 10000 is the next free one).
 */
export const HEALTH_ADVISORY_SPACE = 10_000;

/**
 * Second key of the routines lock: `(10000, hashtext('health:routines'))`. The FIRST lock of every
 * write that changes which routines are live or their order: create, delete, restore, reorder.
 */
export const HEALTH_ROUTINES_KEY = "health:routines";

/**
 * Second key of one routine's lock: `(10000, hashtext(<routine id>))`, the first lock of every
 * write of its exercises (add, edit, remove, restore, reorder) and of its rename, so `position`
 * stays contiguous and a reorder checks its list against the set it is about to write.
 */
export const routineLockKey = (routineId: string) => routineId;

/**
 * Second key of the catalogue lock: `(10000, hashtext('health:exercises'))`. The FIRST lock of
 * every write of an exercise (create, edit, delete, restore): two saves of the same name wait for
 * each other, so the second sees the first and says «Ya existe» (the partial unique index on
 * `name_key` stays the hard guarantee).
 */
export const HEALTH_EXERCISES_KEY = "health:exercises";

/**
 * Second key of the sessions lock: `(10000, hashtext('health:session'))` (E2). The FIRST, and only,
 * advisory lock of EVERY write of a session, its exercises or its sets (start, the sets, add,
 * remove and reorder exercises, the note and times, finish, discard, delete and their «Deshacer»):
 * two «Empezar» at once queue on it, so the second sees the first one's open session (the partial
 * unique index `health_sessions_open_unique` stays the hard guarantee), and the order inside a
 * session needs no lock of its own.
 */
export const HEALTH_SESSION_KEY = "health:session";
