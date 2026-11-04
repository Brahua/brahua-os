import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/design-system";
import { requireOwner } from "@/lib/auth";
import { ScreenServicesProvider } from "@/modules/core/components/screen-services";
import { SessionDeletedNotice } from "@/modules/health/components/deleted-notice";
import { SessionRows } from "@/modules/health/components/session-rows";
import { SESSIONS_PAGE } from "@/modules/health/health-constants";
import { HEALTH_COPY } from "@/modules/health/health-copy";
import { getDeletedSession, listSessions } from "@/modules/health/queries";
import {
  DELETED_PARAM,
  HEALTH_PATH,
  SESSIONS_COUNT_PARAM,
  SESSIONS_PATH,
} from "@/modules/health/routes";
import { SESSIONS_COPY as COPY } from "@/modules/health/sessions-copy";

export const metadata: Metadata = { title: COPY.listMeta };

const HEADING_ID = "sessions-title";
/** «Ver más» never asks for more than this (a bound on the query). */
const MAX_SHOWN = 3_000;

type SessionsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** How many the list shows: `?n=` rounded to whole pages, from one page to MAX_SHOWN. */
function shownCount(value: string | string[] | undefined): number {
  const requested = typeof value === "string" && /^\d{1,5}$/.test(value) ? Number(value) : 0;
  const pages = Math.max(1, Math.ceil(requested / SESSIONS_PAGE));
  return Math.min(pages * SESSIONS_PAGE, MAX_SHOWN);
}

/**
 * Every session, the newest first, 30 at a time with «Ver más» (SPEC-health "Pantallas"). After
 * deleting one from its screen, `?deleted=` offers «Deshacer».
 */
export default async function SessionsPage({ searchParams }: SessionsPageProps) {
  await requireOwner();
  const search = await searchParams;
  const count = shownCount(search[SESSIONS_COUNT_PARAM]);
  const deletedId = search[DELETED_PARAM];
  const [{ sessions, total }, deleted] = await Promise.all([
    listSessions(count),
    typeof deletedId === "string" ? getDeletedSession(deletedId) : Promise.resolve(null),
  ]);

  return (
    <ScreenServicesProvider label={HEALTH_COPY.noticesLabel} actionHint={HEALTH_COPY.undoHint}>
      <div className="mx-auto flex w-full max-w-(--content-max) flex-col gap-6 px-4 py-8 pb-[calc(7rem+var(--toast-offset,0px))] md:px-6 lg:py-12 lg:pb-[calc(7rem+var(--toast-offset,0px))]">
        <Link
          href={HEALTH_PATH}
          className="bo-text-body-sm flex min-h-11 w-fit items-center gap-2 rounded-md text-text-secondary hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <Icon icon={ArrowLeft} size="sm" />
          {COPY.backToHealth}
        </Link>
        <h1 id={HEADING_ID} tabIndex={-1} className="bo-text-display outline-none">
          {COPY.listTitle}
        </h1>
        <div className="flex max-w-160 flex-col gap-4">
          {sessions.length === 0 ? (
            <p className="bo-text-body text-text-secondary">{COPY.listEmpty}</p>
          ) : (
            <SessionRows sessions={sessions} label={COPY.listLabel} />
          )}
          {total > sessions.length && count < MAX_SHOWN ? (
            <Link
              href={`${SESSIONS_PATH}?${SESSIONS_COUNT_PARAM}=${count + SESSIONS_PAGE}`}
              scroll={false}
              className="bo-text-body-sm flex min-h-11 w-fit items-center rounded-md px-1 font-medium hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              data-health-more=""
            >
              {COPY.seeMore}
            </Link>
          ) : null}
        </div>
        <SessionDeletedNotice
          headingId={HEADING_ID}
          deleted={
            deleted ? { id: deleted.id, name: COPY.routineOrFree(deleted.routineName) } : null
          }
        />
      </div>
    </ScreenServicesProvider>
  );
}
