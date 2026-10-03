import { Lock } from "lucide-react";
import Link from "next/link";
import { Icon, keyClasses, Led } from "@/design-system";
import { cn } from "@/lib/cn";
import type { ProjectTodayItem } from "@/modules/projects/contracts";
import { isUrgentDue } from "@/modules/projects/progress";
import { DEPENDENCIES_COPY } from "@/modules/projects/projects-copy";
import { PROJECTS_PATH, projectPath } from "@/modules/projects/routes";
import { TODAY_COPY } from "../today-copy";

/** Id of the section's `<h2 tabIndex={-1}>` (the slots' focus contract, see `TodaySlot`). */
export const TODAY_PROJECTS_HEADING_ID = "today-projects-title";

/**
 * "Proyectos" on the board (D3, SPEC-today "Proyectos"): what `getProjectsTodaySummary(now)`
 * returns, in its order (overdue first, then due soonest, then blocked only). Read only: each row
 * links to its project. No cap (projects are few). A Server Component: no state, no hooks.
 * Without rows it renders nothing (the section decides whether it shows).
 */
export function TodayProjects({ projects }: { projects: readonly ProjectTodayItem[] }) {
  if (projects.length === 0) return null;
  return (
    <section
      aria-labelledby={TODAY_PROJECTS_HEADING_ID}
      className="flex flex-col gap-3"
      data-today-section="projects"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h2 id={TODAY_PROJECTS_HEADING_ID} tabIndex={-1} className="bo-text-title outline-none">
          {TODAY_COPY.projectsTitle}
        </h2>
        <Link href={PROJECTS_PATH} className={keyClasses({ variant: "ghost" })}>
          {TODAY_COPY.seeProjects}
        </Link>
      </div>
      <ul aria-label={TODAY_COPY.projectsList} className="bo-list">
        {projects.map((project) => (
          <TodayProjectRow key={project.id} project={project} />
        ))}
      </ul>
    </section>
  );
}

/**
 * One project: its area's LED, the name (a link whose ::after covers the row) and, under it, the
 * area, the due notice ("Vence hoy", "Vence en N días", "Vencido hace N días", from `projects`'
 * `dueState`) and "Bloqueado por X, Y". "Vence hoy" and overdue take the signal color, as on the
 * projects list (`ProjectCard`); never red.
 */
function TodayProjectRow({ project }: { project: ProjectTodayItem }) {
  const { area, due, blockedBy } = project;
  const blocked = blockedBy.length > 0;
  const urgent = isUrgentDue(due);
  const blockedText = blocked ? DEPENDENCIES_COPY.blockedBy(blockedBy.map((b) => b.name)) : null;
  // The visible metadata is aria-hidden (its flex items would be read run together); the link
  // says it in words through this description.
  const descriptionId = `today-project-${project.id}-description`;
  const description = [area.name, due?.label, blockedText].filter(Boolean).join(", ");

  return (
    <li
      data-today-project={project.id}
      data-area={area.slug}
      // The ring goes inside the row: .bo-list clips anything outside it.
      className="relative flex min-w-0 items-start gap-3 bg-surface px-4 py-3 transition-colors hover:bg-surface-hover has-[a:focus-visible]:outline-2 has-[a:focus-visible]:-outline-offset-2 has-[a:focus-visible]:outline-focus"
    >
      <Led area={area.color} size="sm" className="mt-2 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Link
          href={projectPath(project.id)}
          prefetch={false}
          aria-describedby={descriptionId}
          className="bo-text-body break-words outline-none after:absolute after:inset-0 after:content-['']"
        >
          {project.name}
        </Link>
        <span id={descriptionId} hidden>
          {description}
        </span>
        <p
          aria-hidden
          className="bo-text-body-sm flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-text-secondary"
        >
          <span className="max-w-full min-w-0 truncate">{area.name}</span>
          {due ? (
            <time
              dateTime={project.dueDate ?? undefined}
              data-due={due.kind}
              className={cn(urgent && "text-signal-text")}
            >
              {due.label}
            </time>
          ) : null}
        </p>
        {blockedText ? (
          <p
            aria-hidden
            className="bo-text-body-sm flex items-start gap-1.5 text-text-secondary"
            data-blocked-by=""
          >
            <Icon icon={Lock} size="sm" className="mt-0.5 shrink-0" />
            <span className="min-w-0 break-words">{blockedText}</span>
          </p>
        ) : null}
      </div>
    </li>
  );
}
