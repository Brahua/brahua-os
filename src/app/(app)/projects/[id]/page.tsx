import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AreaTag, Icon } from "@/design-system";
import { requireOwner } from "@/lib/auth";
import {
  PROJECT_PRIORITY_LABELS,
  PROJECT_STATUS_LABELS,
  PROJECTS_COPY,
} from "@/modules/projects/projects-copy";
import { getProject } from "@/modules/projects/queries";
import { CREATED_PARAM } from "@/modules/projects/routes";
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
 * A project's page. P1: a minimal detail (name, state, area, priority) so creating has somewhere
 * to land; P2 builds the real one, with in-place editing. Missing or deleted projects are a 404.
 */
export default async function ProjectPage({ params, searchParams }: ProjectPageProps) {
  await requireOwner();
  const [{ id }, search] = await Promise.all([params, searchParams]);
  const project = await getProject(id);
  if (!project) notFound();
  const justCreated = search[CREATED_PARAM] === "1";

  return (
    <div className="mx-auto flex w-full max-w-(--content-max) flex-col gap-8 px-4 py-8 pb-28 md:px-6 lg:py-12 lg:pb-28">
      <Link
        href="/projects"
        className="bo-text-body-sm flex min-h-11 w-fit items-center gap-2 rounded-md text-text-secondary hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        <Icon icon={ArrowLeft} size="sm" />
        {PROJECTS_COPY.backToList}
      </Link>
      <header className="flex flex-col gap-3">
        {/* tabIndex -1: focus lands here right after creating (CreatedNotice). */}
        <h1 id={HEADING_ID} tabIndex={-1} className="bo-text-display break-words outline-none">
          {project.name}
        </h1>
        {project.objective ? (
          <p className="bo-text-body text-text-secondary">{project.objective}</p>
        ) : null}
      </header>
      <dl className="bo-card max-w-160">
        <div className="flex flex-col gap-1">
          <dt className="bo-field__label">{PROJECTS_COPY.statusMeta}</dt>
          <dd className="bo-text-body-strong">{PROJECT_STATUS_LABELS[project.status]}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="bo-field__label">{PROJECTS_COPY.areaMeta}</dt>
          <dd className="min-w-0">
            <AreaTag
              area={project.area.color}
              icon={project.area.icon}
              label={project.area.name}
              variant="large"
              className="max-w-full [&>span:last-child]:break-words"
            />
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="bo-field__label">{PROJECTS_COPY.priorityMeta}</dt>
          <dd className="bo-text-body-strong">{PROJECT_PRIORITY_LABELS[project.priority]}</dd>
        </div>
      </dl>
      <p className="bo-text-body-sm max-w-160 text-text-secondary">
        {PROJECTS_COPY.detailComingSoon}
      </p>
      {justCreated ? (
        <CreatedNotice headingId={HEADING_ID} message={PROJECTS_COPY.created(project.name)} />
      ) : null}
    </div>
  );
}
