// Status rules of `projects` that both sides apply (SPEC-projects "Transiciones"). Pure and
// client-safe: the server enforces the same rule in SQL (projects.ts), and the detail uses this
// one for its optimistic view.
import type { ProjectStatus } from "./project-constants";

/**
 * `completed_at` after moving to `status`: moving to Terminado stamps it (`now`), staying in
 * Terminado keeps the original date, and any other state clears it. Matches the database
 * CHECK `(status = 'done') = (completed_at is not null)`.
 */
export function completedAtAfter(
  status: ProjectStatus,
  previous: Date | null,
  now: Date,
): Date | null {
  if (status !== "done") return null;
  return previous ?? now;
}

/**
 * Whether the end date (and its notice) shows. Maintenance is ongoing work with no end, so it
 * hides it; the date is kept in case the project leaves maintenance.
 */
export function showsDueDate(status: ProjectStatus): boolean {
  return status !== "maintenance";
}
