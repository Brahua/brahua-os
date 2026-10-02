// Composition root of the progress sources (SPEC-projects "Contratos con otros módulos"): the one
// place that knows which modules contribute to the progress of projects, like EXPORTABLE_TABLES
// for the export. `projects` itself never imports the providers: the dependency stays
// `tasks` → `projects`.
//
// A source is imported BY NAME here and registered in `ensureProgressSources()`, which the code
// that computes progress calls first (the projects list and detail, "Cerrar proyecto"). Never a
// side-effect-only `import "…"`: package.json declares every JS module free of side effects
// ("sideEffects": ["*.css"]), so the bundler drops imports whose exports nobody uses (it happened
// to the quick capture in T1 of `tasks`: the registration never reached the production build).
import "server-only";
import { registerProgressSource, type ProgressSource } from "@/modules/projects/contracts";
import { tasksProgressSource } from "@/modules/tasks/progress-source";

/** Every module's progress source: `tasks` (T5) counts each project's tasks. */
export const SOURCES: readonly ProgressSource[] = [tasksProgressSource];

let registered = false;

/**
 * Registers every source once per server instance (registering is idempotent by id anyway).
 * Call it before `contributedProgress()`.
 */
export function ensureProgressSources(): void {
  if (registered) return;
  registered = true;
  for (const source of SOURCES) registerProgressSource(source);
}
