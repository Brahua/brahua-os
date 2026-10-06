// Errors that roll back a transaction of a recurring payment's period (server only).
import "server-only";

/** Thrown inside a transaction to roll it back when the period was already taken. */
export class PeriodTaken extends Error {}

/** A Postgres unique violation (23505), as Drizzle wraps it. */
export function isUniqueViolation(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } } | null)?.cause;
  return cause?.code === "23505" || (error as { code?: string } | null)?.code === "23505";
}
