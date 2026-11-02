import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/design-system";
import { requireOwner } from "@/lib/auth";
import { ownerDateKey } from "@/lib/time";
import { ScreenServicesProvider } from "@/modules/core/components/screen-services";
import { TrackDetail } from "@/modules/learning/components/track-detail";
import { LEARNING_COPY as COPY } from "@/modules/learning/learning-copy";
import {
  getTrack,
  listActiveTracks,
  listProjectChoices,
  listSteps,
} from "@/modules/learning/queries";
import { LEARNING_PATH } from "@/modules/learning/routes";

type TrackPageProps = { params: Promise<{ id: string }> };

const HEADING_ID = "track-title";

export async function generateMetadata({ params }: TrackPageProps): Promise<Metadata> {
  const { id } = await params;
  const track = await getTrack(id);
  // The page's metadata also applies to its not-found.tsx (which can't set its own here).
  if (!track) return { title: COPY.notFoundTitle, robots: { index: false, follow: false } };
  return { title: COPY.detailTitle(track.title) };
}

/**
 * A track's page (SPEC-learning "Detalle"): status and its actions, the syllabus, settings and,
 * from L2, the sessions (the `sessions` slot). Missing, deleted or malformed ids are a 404.
 */
export default async function TrackPage({ params }: TrackPageProps) {
  await requireOwner();
  const { id } = await params;
  const today = ownerDateKey(new Date());
  const [track, steps, active] = await Promise.all([
    getTrack(id),
    listSteps(id),
    listActiveTracks(),
  ]);
  if (!track) notFound();
  const projects = await listProjectChoices(track.projectId);
  const projectName = projects.find((project) => project.id === track.projectId)?.name ?? null;

  return (
    <ScreenServicesProvider
      label={COPY.noticesLabel}
      actionHint={COPY.undoHint}
      day={{ today, changedMessage: COPY.newDay }}
    >
      <div className="mx-auto flex w-full max-w-(--content-max) flex-col gap-6 px-4 py-8 pb-[calc(7rem+var(--toast-offset,0px))] md:px-6 lg:py-12 lg:pb-[calc(7rem+var(--toast-offset,0px))]">
        <Link
          href={LEARNING_PATH}
          className="bo-text-body-sm flex min-h-11 w-fit items-center gap-2 rounded-md text-text-secondary hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <Icon icon={ArrowLeft} size="sm" />
          {COPY.backToList}
        </Link>
        <TrackDetail
          track={track}
          steps={steps}
          projects={projects}
          projectName={projectName}
          active={active}
          today={today}
          headingId={HEADING_ID}
          sessions={null}
        />
      </div>
    </ScreenServicesProvider>
  );
}
