// The progress source of `tasks` (SPEC-tasks "Contratos", P6 contract of `projects`): every
// visible task of a project counts, done = with `done_at`, total = all of them (a deleted task,
// or the tasks of a deleted project, never count). Registered by the composition root
// src/lib/progress-sources.ts (imported by name in `ensureProgressSources()`); `projects` never
// imports it.
import "server-only";
import { getDb } from "@/lib/db";
import type { ProgressSource } from "@/modules/projects/contracts";
import { countProjectTasks } from "./project-tasks";

export const tasksProgressSource: ProgressSource = {
  id: "tasks",
  // One grouped query for every id the list or the detail asks for. The page checked the owner.
  countsFor: (projectIds) => countProjectTasks(getDb(), projectIds),
};
