import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { Icon, SectionLabel } from "@/design-system";
import { RECORDS_COPY } from "../records-copy";
import { SESSIONS_PATH, sessionPath } from "../routes";
import { formatMinutes, formatSessionDay, minutesBetween } from "../session-time";
import { SESSIONS_COPY as COPY } from "../sessions-copy";
import type { SessionSummary } from "../sessions-input";

type SessionRowsProps = {
  sessions: readonly SessionSummary[];
  label: string;
};

/**
 * Sessions as rows (SPEC-health "Pantallas"): the day and the routine, then the duration and the
 * done sets («52 min · 14 series»), with its new records when it has any («· 2 récords», E3), or
 * «En curso». Each row opens the session. A Server Component.
 */
export function SessionRows({ sessions, label }: SessionRowsProps) {
  return (
    <ul aria-label={label} className="bo-list" data-health-sessions="">
      {sessions.map((session) => {
        const name = COPY.routineOrFree(session.routineName);
        const day = formatSessionDay(session.startedAt);
        return (
          <li key={session.id} className="bg-surface" data-health-session-row={session.id}>
            <Link
              href={sessionPath(session.id)}
              aria-label={COPY.openSession(name, day)}
              aria-describedby={`session-${session.id}-meta`}
              className="flex min-h-14 items-center gap-3 rounded-md px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="bo-text-body font-medium break-words">
                  {day} · {name}
                </span>
                <span
                  id={`session-${session.id}-meta`}
                  className="bo-text-body-sm text-text-secondary"
                >
                  {session.endedAt === null
                    ? COPY.inProgress
                    : COPY.summary(
                        formatMinutes(minutesBetween(session.startedAt, session.endedAt)),
                        session.doneSets,
                      )}
                  {session.endedAt !== null && session.newRecords > 0
                    ? ` · ${RECORDS_COPY.rowCount(session.newRecords)}`
                    : null}
                </span>
              </span>
              <Icon icon={ChevronRight} size="sm" className="shrink-0 text-text-secondary" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** «Últimas sesiones» on /health (the 10 newest) with «Ver todas». Nothing without sessions. */
export function RecentSessions({ sessions }: { sessions: readonly SessionSummary[] }) {
  if (sessions.length === 0) return null;
  return (
    <section
      aria-labelledby="health-recent-title"
      className="flex max-w-160 flex-col gap-3"
      data-health-recent=""
    >
      <SectionLabel id="health-recent-title" as="h2" title={COPY.recent} />
      <SessionRows sessions={sessions} label={COPY.recentLabel} />
      <Link
        href={SESSIONS_PATH}
        className="bo-text-body-sm flex min-h-11 w-fit items-center gap-1 rounded-md text-text-secondary hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        data-health-all-sessions=""
      >
        {COPY.seeAll}
        <Icon icon={ChevronRight} size="sm" />
      </Link>
    </section>
  );
}
