// Tables `tasks` offers to `pnpm db:export` (src/lib/data-export.ts). Done and deleted tasks are
// included on purpose: the export is the owner's history, not a view.
import type { ExportableTable } from "@/lib/data-export";
import { taskTagLinks, taskTags, tasks } from "./db/schema";

export const tasksExportTables: ExportableTable[] = [
  { table: tasks, orderBy: [tasks.createdAt, tasks.id] },
  { table: taskTags, orderBy: [taskTags.name, taskTags.id] },
  { table: taskTagLinks, orderBy: [taskTagLinks.taskId, taskTagLinks.tagId] },
];
