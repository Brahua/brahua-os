// "Bloqueado por" (P4, SPEC-projects "Dependencias"): validation, errors and client types.
// Client-safe: the actions are the authority (they also refuse cycles, which only the database
// can see); the page runs the same schema first.
import { z } from "zod";
import type { ProjectStatus } from "./project-constants";
import { PROJECT_ERRORS, type ProjectAreaSummary } from "./project-input";

/** A blocker in one of these states no longer blocks (SPEC-projects "Dependencias"). */
export const NON_BLOCKING_STATUSES = [
  "done",
  "canceled",
] as const satisfies readonly ProjectStatus[];

/** Whether a blocker in `status` still blocks the projects that depend on it. */
export function isBlocking(status: ProjectStatus): boolean {
  return !(NON_BLOCKING_STATUSES as readonly ProjectStatus[]).includes(status);
}

export const DEPENDENCY_ERRORS = {
  self: "Un proyecto no puede bloquearse a sí mismo.",
  cycle:
    "Ese proyecto ya depende de este (directa o indirectamente): agregarlo crearía un ciclo. Elige otro.",
  unavailable: "Ese proyecto ya no está disponible (se eliminó). Elige otro.",
} as const;

/** A project as the dependencies show it: a blocker, or a candidate to become one. */
export type DependencyProject = {
  id: string;
  name: string;
  status: ProjectStatus;
  area: ProjectAreaSummary;
};

/** The project's blockers (not deleted, blocking or not) and the projects it may add. */
export type ProjectDependencies = {
  blockers: DependencyProject[];
  /** The blockers that still block it (neither done nor canceled): "Bloqueado por …". */
  blocking: ActiveBlocker[];
  /** Every project but itself, the deleted ones, its blockers and those that would make a cycle. */
  candidates: DependencyProject[];
};

/** A blocker that still blocks: what the card's badge and the header's line name. */
export type ActiveBlocker = { id: string; name: string };

/** `id` is blocked by `blockedById`. Both must be existing projects that aren't deleted. */
export const projectDependencyInputSchema = z
  .object({
    id: z.uuid({ error: PROJECT_ERRORS.notFound }),
    blockedById: z.uuid({ error: DEPENDENCY_ERRORS.unavailable }),
  })
  .refine(({ id, blockedById }) => id !== blockedById, {
    error: DEPENDENCY_ERRORS.self,
    path: ["blockedById"],
  });

export type ProjectDependencyInput = z.output<typeof projectDependencyInputSchema>;
