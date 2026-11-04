// The advisory locks of `health` (server only). Rules (CLAUDE.md "Advisory locks"; SPEC-health
// "Modelo de datos"), in HEALTH_ADVISORY_SPACE (10000), two keys:
// - `(10000, hashtext('health:routines'))` (`lockRoutines`): every write that changes which
//   routines are live or their order (create, delete, restore, reorder).
// - `(10000, hashtext(<routine id>))` (`lockRoutine`): a routine's exercises and its name.
// - `(10000, hashtext('health:exercises'))` (`lockExercises`): every write of the catalogue.
// Rule: an advisory lock is always the FIRST lock of its transaction, never taken after a row
// lock, and no transaction takes two of them. Only then the rows (FOR SHARE / FOR UPDATE).
import "server-only";
import { sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import {
  HEALTH_ADVISORY_SPACE,
  HEALTH_EXERCISES_KEY,
  HEALTH_ROUTINES_KEY,
  routineLockKey,
} from "./lock-keys";

export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

async function advisoryLock(tx: Tx, key: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(${sql.raw(String(HEALTH_ADVISORY_SPACE))}, hashtext(${key}))`,
  );
}

/** The routines' lock. Must be the first lock of the transaction (see the header). */
export function lockRoutines(tx: Tx) {
  return advisoryLock(tx, HEALTH_ROUTINES_KEY);
}

/** One routine's lock. Must be the first lock of the transaction (see the header). */
export function lockRoutine(tx: Tx, routineId: string) {
  return advisoryLock(tx, routineLockKey(routineId));
}

/** The catalogue's lock. Must be the first lock of the transaction (see the header). */
export function lockExercises(tx: Tx) {
  return advisoryLock(tx, HEALTH_EXERCISES_KEY);
}
