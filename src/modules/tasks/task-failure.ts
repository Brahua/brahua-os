// How a failed call of `tasks` reads in a "Sin guardar" notice, and how a queued call settled.
// Pure and client-safe: shared by the task lists (`TaskList`) and `taskCompletion` (D2 of today).
import { fail, type ActionResult } from "@/lib/action-result";
import type { Queued } from "@/lib/use-save-queue";
import { TASKS_COPY } from "./tasks-copy";

/** The server's message for a failed result: a field's own when it gives one, else the general. */
export function failureReason(result: {
  ok: false;
  error: string;
  fieldErrors?: Record<string, string[]>;
}): string {
  const own = Object.values(result.fieldErrors ?? {}).find((messages) => messages.length)?.[0];
  return own ?? result.error;
}

/**
 * A queued call's result: a thrown call reads as a network failure ("Revisa tu conexión…"), and
 * "stale" when it never ran or a newer call with the same key took over (that one decides what
 * stays, so nothing is said).
 */
export function settled<T>(queued: Queued<ActionResult<T>>): ActionResult<T> | "stale" {
  if (queued.kind === "skipped" || queued.superseded) return "stale";
  return queued.kind === "done" ? queued.value : fail(TASKS_COPY.checkConnection);
}
