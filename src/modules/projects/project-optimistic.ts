// The detail's optimistic view of a project: what it shows between an edit and the server's
// answer (SPEC-projects: "UI optimista donde el cambio es inmediato"). Pure and client-safe.
import type { ProjectSummary } from "./project-input";
import { completedAtAfter } from "./project-status";

/** The fields the detail edits in place. */
export type ProjectPatch = Partial<
  Pick<
    ProjectSummary,
    "name" | "objective" | "status" | "priority" | "startDate" | "dueDate" | "area"
  >
>;

export type ProjectChange = {
  patch: ProjectPatch;
  /** When the edit happened: the optimistic `completed_at` of a move to Terminado. */
  at: Date;
};

/**
 * The project with an edit applied, following the server's rules: a new status also moves
 * `completed_at` (stamped on Terminado, kept if it already was, cleared otherwise).
 */
export function applyProjectChange(project: ProjectSummary, change: ProjectChange): ProjectSummary {
  const { patch, at } = change;
  const next = { ...project, ...patch };
  if (patch.status !== undefined) {
    next.completedAt = completedAtAfter(patch.status, project.completedAt, at);
  }
  return next;
}
