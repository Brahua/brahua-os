import Link from "next/link";
import { AreaTag, Led } from "@/design-system";
import { cn } from "@/lib/cn";
import type { DueState } from "../progress";
import type { ProjectSummary } from "../project-input";
import { PROJECTS_COPY } from "../projects-copy";

type ProjectCardProps = {
  project: ProjectSummary;
  /** The due-date notice, if any (`dueState` in ../progress, computed for Lima's today). */
  due: DueState | null;
  /** Level of the name's heading: 3 under a group's h2, 4 inside the history's h3 groups. */
  headingLevel?: 3 | 4;
  className?: string;
};

/**
 * A project in the list (Claude Design pattern `ProjectCard`): area and due-date notice on top,
 * the name (a link to the detail that covers the whole card), the objective and, only when it
 * is high, the priority. Server-renderable (no hooks).
 *
 * Ported without the pattern's "Siguiente tarea" key (it belongs to `tasks`) and without the
 * progress bar until there are milestones (P3): a card never shows an empty slot for either.
 */
export function ProjectCard({ project, due, headingLevel = 3, className }: ProjectCardProps) {
  const Heading = headingLevel === 3 ? "h3" : "h4";
  const urgent = due?.kind === "today" || due?.kind === "overdue";
  return (
    <article
      data-project-card={project.id}
      // bo-project-card (extensions.css): hover and the link's focus ring on the whole card.
      className={cn("bo-card bo-project-card h-full", className)}
    >
      <div className="flex items-start justify-between gap-x-3 gap-y-1 max-[359px]:flex-col">
        <AreaTag
          area={project.area.color}
          icon={project.area.icon}
          label={project.area.name}
          className="min-w-0 [&>span:last-child]:truncate"
          title={project.area.name}
        />
        {due ? (
          <time
            dateTime={project.dueDate ?? undefined}
            data-due={due.kind}
            className={cn(
              "bo-text-label shrink-0",
              urgent ? "text-signal-text" : "text-text-secondary",
            )}
          >
            {due.label}
          </time>
        ) : null}
      </div>
      <Heading className="bo-text-heading break-words">
        <Link
          href={`/projects/${project.id}`}
          // A list shows many cards: prefetching each (a dynamic render with its own query) on
          // entering the viewport costs more than the click it saves for a single user.
          prefetch={false}
          className="outline-none after:absolute after:inset-0 after:content-['']"
        >
          {project.name}
        </Link>
      </Heading>
      {project.objective ? (
        <p className="bo-text-body-sm line-clamp-2 text-text-secondary">{project.objective}</p>
      ) : null}
      {project.priority === "high" ? (
        <p className="bo-text-label flex items-center gap-2 text-signal-text">
          <Led signal size="sm" />
          <span aria-hidden>{PROJECTS_COPY.highPriorityShort}</span>
          <span className="sr-only">{PROJECTS_COPY.highPriority}</span>
        </p>
      ) : null}
    </article>
  );
}
