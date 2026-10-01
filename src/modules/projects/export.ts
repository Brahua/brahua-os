// Tables `projects` offers to `pnpm db:export` (src/lib/data-export.ts). Deleted projects are
// included on purpose: the export is the owner's history, not a view.
import type { ExportableTable } from "@/lib/data-export";
import { projectDependencies, projectLinks, projectMilestones, projects } from "./db/schema";

export const projectsExportTables: ExportableTable[] = [
  { table: projects, orderBy: [projects.createdAt, projects.id] },
  {
    table: projectMilestones,
    orderBy: [projectMilestones.projectId, projectMilestones.sortOrder, projectMilestones.id],
  },
  {
    table: projectLinks,
    orderBy: [projectLinks.projectId, projectLinks.sortOrder, projectLinks.id],
  },
  {
    table: projectDependencies,
    orderBy: [projectDependencies.projectId, projectDependencies.blockedById],
  },
];
