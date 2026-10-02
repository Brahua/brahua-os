// The "Tareas" section of a project's page (T5, SPEC-tasks "En proyectos"), registered with
// `registerProjectSection` by the composition root src/lib/project-extensions.ts. Server only:
// it reads the project's tasks and where a task can go (the detail sheet's placement picker),
// then hands them to the client section.
import "server-only";
import { requireOwner } from "@/lib/auth";
import { getDb } from "@/lib/db";
import type { ProjectSection } from "@/modules/projects/contracts";
import { isClosed } from "@/modules/projects/project-close";
import { ProjectTasksSection } from "./components/project/project-tasks-section";
import { selectProjectTasks } from "./project-tasks";
import { selectTaskTargets } from "./tasks";

export const tasksProjectSection: ProjectSection = {
  id: "tasks",
  async render({ project, milestones }) {
    // The page checked it already; checked again because this reads the database directly.
    await requireOwner();
    const now = new Date();
    const db = getDb();
    const [{ pending, done }, targets] = await Promise.all([
      selectProjectTasks(db, project.id, now),
      selectTaskTargets(db),
    ]);
    return (
      <ProjectTasksSection
        project={{ id: project.id, name: project.name }}
        open={!isClosed(project.status)}
        milestones={milestones.map(({ id, title }) => ({ id, title }))}
        pending={pending}
        done={done}
        now={now}
        targets={targets}
      />
    );
  },
};
