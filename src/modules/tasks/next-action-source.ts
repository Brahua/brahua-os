// The next actions of `tasks` for the projects list's cards (T5, `registerNextActionSource` of
// `projects`): one query for every visible project, and the calls that complete one from its card
// and undo that. Registered by the composition root src/lib/project-extensions.ts.
import "server-only";
import { getDb } from "@/lib/db";
import type { NextActionSource } from "@/modules/projects/contracts";
import { completeTask } from "./actions";
import { undoCompleteNextAction } from "./project-task-actions";
import { selectNextActions } from "./project-tasks";

export const tasksNextActionSource: NextActionSource = {
  id: "tasks",
  // The list checked the owner (requireOwner()) before asking.
  nextActionsFor: (projectIds) => selectNextActions(getDb(), projectIds),
  // The same completion as every list of tasks (it clears the mark; with T3 it also creates the
  // next occurrence of a recurring task, inside completeTaskById).
  complete: completeTask,
  undoComplete: undoCompleteNextAction,
};
