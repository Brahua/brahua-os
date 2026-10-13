// Composition root of what `goals` adds to the screens of other modules (G3 of `goals`): the
// "Metas" section of a habit's page and of a project's page, so the link goes both ways (a goal's
// page already links to its habit or project) without `habits` or `projects` knowing `goals`. Like
// src/lib/project-extensions.ts, the one place that knows the provider.
//
// The providers are imported BY NAME and registered in `ensureGoalExtensions()`, which the pages
// that render the sections call first. Never a side-effect-only `import "…"`: package.json
// declares every JS module free of side effects, so the bundler would drop it (see
// progress-sources.ts).
import "server-only";
import { registerHabitSection, type HabitSection } from "@/modules/habits/contracts";
import { habitGoalsSection, projectGoalsSection } from "@/modules/goals/linked-goals";
import { registerProjectSection, type ProjectSection } from "@/modules/projects/contracts";

/** What `goals` adds to a habit's page: "Metas". */
export const HABIT_SECTIONS: readonly HabitSection[] = [habitGoalsSection];

/** What `goals` adds to a project's page: "Metas". */
export const PROJECT_SECTIONS: readonly ProjectSection[] = [projectGoalsSection];

let registered = false;

/**
 * Registers every section once per server instance (registering is idempotent by id anyway). Call
 * it before `renderHabitSections()` or `renderProjectSections()`.
 */
export function ensureGoalExtensions(): void {
  if (registered) return;
  registered = true;
  for (const section of HABIT_SECTIONS) registerHabitSection(section);
  for (const section of PROJECT_SECTIONS) registerProjectSection(section);
}
