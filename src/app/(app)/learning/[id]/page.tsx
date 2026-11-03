import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/design-system";
import { requireOwner } from "@/lib/auth";
import { NoteMentions } from "@/lib/note-extensions";
import { ownerDateKey } from "@/lib/time";
import { ScreenServicesProvider } from "@/modules/core/components/screen-services";
import { SessionsSection } from "@/modules/learning/components/sessions-section";
import { TrackDetail } from "@/modules/learning/components/track-detail";
import { LEARNING_COPY as COPY } from "@/modules/learning/learning-copy";
import {
  getRunningSession,
  getTrack,
  getTrackMinutes,
  listActiveTracks,
  listProjectChoices,
  listSteps,
  listTrackSessions,
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
 * A track's page (SPEC-learning "Detalle"): status and its actions, the week's time and the timer,
 * the syllabus, settings and the sessions (the `sessions` slot). One instant for the page (Lima's
 * day and week). Missing, deleted or malformed ids are a 404.
 */
export default async function TrackPage({ params }: TrackPageProps) {
  await requireOwner();
  const { id } = await params;
  const now = new Date();
  const today = ownerDateKey(now);
  const [track, steps, active, running, sessions, minutes] = await Promise.all([
    getTrack(id),
    listSteps(id),
    listActiveTracks(),
    getRunningSession(),
    listTrackSessions(id, now),
    getTrackMinutes(now, id),
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
          running={running}
          weekMinutes={minutes[track.id]?.week ?? 0}
          sessions={
            <SessionsSection
              track={{ id: track.id, title: track.title }}
              sessions={sessions}
              today={today}
            />
          }
        />
        <NoteMentions type="learning" id={track.id} />
      </div>
    </ScreenServicesProvider>
  );
}
