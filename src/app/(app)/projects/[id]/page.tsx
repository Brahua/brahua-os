import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/design-system";
import { requireOwner } from "@/lib/auth";
// P6: registers the progress sources of other modules (tasks) before progress is computed.
import "@/lib/progress-sources";
import { Markdown } from "@/lib/markdown/markdown";
import { listLifeAreas } from "@/modules/core/queries";
import { contributedProgress } from "@/modules/projects/contracts";
import { getProjectMilestones } from "@/modules/projects/milestone-queries";
import { countMilestones } from "@/modules/projects/progress";
import { listProjectLinks } from "@/modules/projects/link-queries";
import { PROJECTS_COPY } from "@/modules/projects/projects-copy";
import { getProject, getProjectDependencies } from "@/modules/projects/queries";
import { CREATED_PARAM } from "@/modules/projects/routes";
import { ProjectProgress } from "./_components/milestone-progress";
import { ProjectBlockedBy } from "./_components/project-blocked-by";
import { ProjectCloseSection } from "./_components/project-close-section";
import { ProjectDeleteSection } from "./_components/project-delete-section";
import { ProjectDependenciesSection } from "./_components/project-dependencies-section";
import { ProjectDetailProvider } from "./_components/project-detail-context";
import { ProjectHeader } from "./_components/project-header";
import { ProjectMilestonesSection } from "./_components/project-milestones-section";
import { ProjectLinksSection } from "./_components/project-links-section";
import { ProjectNotesSection } from "./_components/project-notes-section";
import { ProjectPlanSection } from "./_components/project-plan-section";
import { ProjectStateSection } from "./_components/project-state-section";
import { CreatedNotice } from "./created-notice";

type ProjectPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const HEADING_ID = "project-title";

export async function generateMetadata({ params }: ProjectPageProps): Promise<Metadata> {
  const project = await getProject((await params).id);
  // The page's metadata also applies to its not-found.tsx (which can't set its own here).
  if (!project) {
    return { title: PROJECTS_COPY.notFoundTitle, robots: { index: false, follow: false } };
  }
  return { title: `${project.name} · brahua-os` };
}

/**
 * A project's page (SPEC-projects "Detalle"). One component per section, each editing in place
 * through `ProjectDetailProvider` (optimistic view, save queue and the page's notices). Missing
 * or deleted projects are a 404.
 *
 * Sections still to come go in the marked slots below (P3–P5 are built in parallel: each one
 * adds its own query to the Promise.all and its own line in the JSX, nothing else).
 */
export default async function ProjectPage({ params, searchParams }: ProjectPageProps) {
  await requireOwner();
  const [{ id }, search] = await Promise.all([params, searchParams]);
  const [project, areas, milestones, dependencies, links] = await Promise.all([
    getProject(id),
    listLifeAreas(),
    // P3 (Hitos): the project's milestones.
    getProjectMilestones(id),
    // P4 (Dependencias): its blockers and the candidates.
    getProjectDependencies(id),
    listProjectLinks(id), // P5 (Notas y enlaces): its links (the notes come with the project).
  ]);
  if (!project) notFound();
  // P6: what other modules (tasks) add to its progress; no source registered → no work.
  const contributed = (await contributedProgress([project.id])).get(project.id);
  const justCreated = search[CREATED_PARAM] === "1";
  // One instant for the whole page: the due notice counts Lima days from it.
  const now = new Date();

  return (
    <ProjectDetailProvider project={project} now={now}>
      <div className="mx-auto flex w-full max-w-(--content-max) flex-col gap-8 px-4 py-8 pb-28 md:px-6 lg:py-12 lg:pb-28">
        <Link
          href="/projects"
          className="bo-text-body-sm flex min-h-11 w-fit items-center gap-2 rounded-md text-text-secondary hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <Icon icon={ArrowLeft} size="sm" />
          {PROJECTS_COPY.backToList}
        </Link>
        <div className="flex max-w-180 flex-col gap-8">
          <ProjectHeader
            headingId={HEADING_ID}
            areas={areas}
            blockedBy={<ProjectBlockedBy blockers={dependencies.blocking} />}
          />
          <ProjectStateSection />
          <ProjectPlanSection
            // P3 slot: progress={<ProjectProgress … />}
            progress={
              <ProjectProgress counts={countMilestones(milestones)} contributed={contributed} />
            }
          />
          {/* ── P3 slot (Hitos): <ProjectMilestonesSection … /> ── */}
          <ProjectMilestonesSection milestones={milestones} />
          <ProjectDependenciesSection
            blockers={dependencies.blockers}
            candidates={dependencies.candidates}
          />
          {/* ── P5 (Enlaces) ── */}
          <ProjectLinksSection links={links} />
          {/* ── P5 (Notas): rendered on the server, so no Markdown code ships for them. ── */}
          <ProjectNotesSection
            rendered={project.notes ? <Markdown headingOffset={2}>{project.notes}</Markdown> : null}
          />
          <ProjectCloseSection counts={countMilestones(milestones)} contributed={contributed} />
          <ProjectDeleteSection />
        </div>
        {justCreated ? (
          <CreatedNotice headingId={HEADING_ID} message={PROJECTS_COPY.created(project.name)} />
        ) : null}
      </div>
    </ProjectDetailProvider>
  );
}
