import { FolderKanban } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Icon, SectionLabel } from "@/design-system";
import { requireOwner } from "@/lib/auth";
import { listLifeAreas } from "@/modules/core/queries";
import { ProjectCard } from "@/modules/projects/components/project-card";
import { dueState } from "@/modules/projects/progress";
import type { ProjectStatus } from "@/modules/projects/project-constants";
import type { ProjectSummary } from "@/modules/projects/project-input";
import {
  areaFilterOptions,
  groupProjects,
  selectedAreaFilter,
} from "@/modules/projects/project-list";
import { PROJECT_STATUS_LABELS, PROJECTS_COPY } from "@/modules/projects/projects-copy";
import { getDeletedProject, listProjects } from "@/modules/projects/queries";
import { DELETED_PARAM } from "@/modules/projects/routes";
import { AreaFilter } from "./_components/area-filter";
import { NewProject } from "./_components/new-project";
import { ProjectHistory } from "./_components/project-history";
import { ProjectsNotices } from "./_components/projects-notices";

export const metadata: Metadata = { title: "Proyectos · brahua-os" };

const HEADING_ID = "projects-title";

type ProjectsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Proyectos: the projects grouped by state (Activo, Mantenimiento, Pausado, Idea), each group by
 * priority, due date and name; Terminado and Cancelado folded under "Historial". Filtered by
 * life area with `?area=<slug>` (an unknown slug shows them all).
 */
export default async function ProjectsPage({ searchParams }: ProjectsPageProps) {
  await requireOwner();
  const [{ area: areaParam }, projects, areas, deleted] = await Promise.all([
    searchParams,
    listProjects(),
    listLifeAreas(),
    // Just deleted from its page: the undo notice needs its name (only while it is deleted).
    searchParams.then(({ [DELETED_PARAM]: id }) =>
      typeof id === "string" ? getDeletedProject(id) : null,
    ),
  ]);
  const options = areaFilterOptions(areas, projects);
  const selected = selectedAreaFilter(options, areaParam);
  const visible = selected
    ? projects.filter((project) => project.area.id === selected.id)
    : projects;
  const { groups, history, historyCount } = groupProjects(visible);
  // One instant for every card: the due notices all count from the same Lima day.
  const now = new Date();
  const defaultAreaId = selected && !selected.archived ? selected.id : null;
  // Nothing in progress: in an area, nothing at all, or only finished/canceled projects.
  const empty = selected
    ? {
        title: PROJECTS_COPY.emptyFilteredTitle(selected.name),
        text: PROJECTS_COPY.emptyFilteredText,
      }
    : historyCount > 0
      ? { title: PROJECTS_COPY.emptyIdleTitle, text: PROJECTS_COPY.emptyIdleText }
      : { title: PROJECTS_COPY.emptyTitle, text: PROJECTS_COPY.emptyText };

  return (
    <div className="mx-auto flex w-full max-w-(--content-max) flex-col gap-8 px-4 py-8 pb-28 md:px-6 lg:py-12 lg:pb-28">
      <header className="flex flex-wrap items-end justify-between gap-4">
        {/* tabIndex -1: focus lands here after deleting a project (ProjectsNotices). */}
        <h1 id={HEADING_ID} tabIndex={-1} className="bo-text-display outline-none">
          {PROJECTS_COPY.title}
        </h1>
        <NewProject areas={areas} defaultAreaId={defaultAreaId} />
      </header>

      {options.length > 0 ? (
        <AreaFilter options={options} selectedId={selected?.id ?? null} />
      ) : null}

      {groups.length > 0 ? (
        groups.map((group) => (
          <StatusGroup
            key={group.status}
            status={group.status}
            projects={group.projects}
            now={now}
          />
        ))
      ) : (
        <div className="bo-card max-w-160 items-start">
          <Icon icon={FolderKanban} size="xl" className="text-text-secondary" />
          <h2 className="bo-text-title">{empty.title}</h2>
          <p className="bo-text-body-sm text-text-secondary">{empty.text}</p>
          {selected ? (
            <Link
              href="/projects"
              className="bo-text-body-sm inline-flex min-h-11 items-center rounded-md underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              {PROJECTS_COPY.showAll}
            </Link>
          ) : null}
        </div>
      )}

      <ProjectHistory count={historyCount}>
        {history.map((group) => (
          <StatusGroup
            key={group.status}
            status={group.status}
            projects={group.projects}
            now={now}
            level={3}
          />
        ))}
      </ProjectHistory>

      <ProjectsNotices headingId={HEADING_ID} deleted={deleted} />
    </div>
  );
}

type StatusGroupProps = {
  status: ProjectStatus;
  projects: ProjectSummary[];
  now: Date;
  /** h2 in the main view; h3 inside "Historial". */
  level?: 2 | 3;
};

/** One state's projects: a heading with the count and a grid of cards. */
function StatusGroup({ status, projects, now, level = 2 }: StatusGroupProps) {
  // Statuses are unique on the page (main groups and history ones never repeat).
  const id = `project-group-${status}`;
  const label = PROJECT_STATUS_LABELS[status];
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3" data-project-group={status}>
      <SectionLabel
        id={id}
        as={level === 2 ? "h2" : "h3"}
        title={label}
        count={projects.length}
        aria-label={PROJECTS_COPY.groupName(label, projects.length)}
      />
      <ul aria-label={PROJECTS_COPY.groupList(label)} className="grid gap-3 md:grid-cols-2">
        {projects.map((project) => (
          <li key={project.id} className="flex flex-col">
            <ProjectCard
              project={project}
              due={dueState(project.dueDate, project.status, now)}
              headingLevel={level === 2 ? 3 : 4}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
