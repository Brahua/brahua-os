// Composition root of what other modules add to the project screens (T5 of `tasks`): the
// sections of a project's page and the next action on the list's cards. Like
// src/lib/progress-sources.ts, the one place that knows the providers: `projects` never imports
// them (the dependency stays `tasks` → `projects`).
//
// Providers are imported BY NAME and registered in `ensureProjectExtensions()`, which the project
// pages call before rendering the sections or reading the next actions. Never a side-effect-only
// `import "…"`: package.json declares every JS module free of side effects, so the bundler would
// drop it (see progress-sources.ts).
import "server-only";
import {
  registerNextActionSource,
  registerProjectSection,
  type NextActionSource,
  type ProjectSection,
} from "@/modules/projects/contracts";
import { tasksNextActionSource } from "@/modules/tasks/next-action-source";
import { tasksProjectSection } from "@/modules/tasks/project-section";

/** The sections other modules add to a project's page, in this order: "Tareas" (T5). */
export const PROJECT_SECTIONS: readonly ProjectSection[] = [tasksProjectSection];

/** Who knows each project's next action: `tasks` (T5). */
export const NEXT_ACTION_SOURCES: readonly NextActionSource[] = [tasksNextActionSource];

let registered = false;

/**
 * Registers every section and next-action source once per server instance (registering is
 * idempotent by id anyway). Call it before `renderProjectSections()` or `projectNextActions()`.
 */
export function ensureProjectExtensions(): void {
  if (registered) return;
  registered = true;
  for (const section of PROJECT_SECTIONS) registerProjectSection(section);
  for (const source of NEXT_ACTION_SOURCES) registerNextActionSource(source);
}
