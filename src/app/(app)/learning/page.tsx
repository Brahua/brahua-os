import type { Metadata } from "next";
import { requireOwner } from "@/lib/auth";
import { ownerDateKey } from "@/lib/time";
import { ScreenServicesProvider } from "@/modules/core/components/screen-services";
import { TrackDeletedNotice } from "@/modules/learning/components/track-deleted-notice";
import { TracksScreen } from "@/modules/learning/components/tracks-screen";
import { LEARNING_COPY as COPY } from "@/modules/learning/learning-copy";
import {
  getDeletedTrack,
  getRunningSession,
  getTrackMinutes,
  listProjectChoices,
  listTracks,
} from "@/modules/learning/queries";
import { DELETED_PARAM } from "@/modules/learning/routes";

export const metadata: Metadata = { title: `${COPY.pageTitle} · brahua-os` };

const HEADING_ID = "learning-title";

type LearningPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Aprendizaje (SPEC-learning "Pantallas"): the tracks in progress, waiting and done, and «Nuevo
 * frente». Reads every live track once with its counts and next steps, the running timer and each
 * track's minutes; the sections are made on the client. One instant for the page (Lima's day for
 * the pace to each date, Lima's week for the minutes).
 */
export default async function LearningPage({ searchParams }: LearningPageProps) {
  await requireOwner();
  const search = await searchParams;
  const now = new Date();
  const today = ownerDateKey(now);
  const deletedId = search[DELETED_PARAM];
  const [tracks, projects, deleted, running, minutes] = await Promise.all([
    listTracks(),
    listProjectChoices(),
    // Just deleted from its page: the undo notice needs its title (only while it is deleted).
    typeof deletedId === "string" ? getDeletedTrack(deletedId) : Promise.resolve(null),
    getRunningSession(),
    getTrackMinutes(now),
  ]);

  return (
    <ScreenServicesProvider
      label={COPY.noticesLabel}
      actionHint={COPY.undoHint}
      day={{ today, changedMessage: COPY.newDay }}
    >
      {/* Bottom padding grows with the notice (--toast-offset): every tap leaves a «Deshacer»
          notice, and the last card must stay reachable under it at full scroll. */}
      <div className="mx-auto flex w-full max-w-(--content-max) flex-col gap-6 px-4 py-8 pb-[calc(7rem+var(--toast-offset,0px))] md:px-6 lg:py-12 lg:pb-[calc(7rem+var(--toast-offset,0px))]">
        <TracksScreen
          tracks={tracks}
          projects={projects}
          today={today}
          headingId={HEADING_ID}
          minutes={minutes}
          running={running}
        />
        <TrackDeletedNotice headingId={HEADING_ID} deleted={deleted} />
      </div>
    </ScreenServicesProvider>
  );
}
