// The records slot of an exercise's page (SPEC-health "Detalle del ejercicio", E3): its records with
// their day (each opens its session), the best-of line over the last 12 months and the history by
// session, 20 at a time with «Ver más». A Server Component: the page reads it in one query.
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { Icon, SectionLabel } from "@/design-system";
import { HISTORY_MAX, HISTORY_PAGE } from "../health-constants";
import type { ExerciseRecordsView } from "../records";
import { RECORDS_COPY as COPY, recordValue } from "../records-copy";
import { exercisePath, HISTORY_COUNT_PARAM, sessionPath } from "../routes";
import { formatSessionDay } from "../session-time";
import { SESSIONS_COPY } from "../sessions-copy";
import { HistoryMore } from "./history-more";
import { ProgressLine } from "./progress-line";

type ExerciseRecordsProps = {
  exerciseId: string;
  view: ExerciseRecordsView;
  /** How many sessions of the history the page asked for (`?n=`). */
  shown: number;
};

const linkClass =
  "rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

export function ExerciseRecords({ exerciseId, view, shown }: ExerciseRecordsProps) {
  const { records, line, lineMetric, history, totalSessions } = view;
  const lineTitle = COPY.lineTitle[lineMetric];

  if (totalSessions === 0) {
    return (
      <section
        aria-labelledby="exercise-records-title"
        className="flex max-w-160 flex-col gap-3"
        data-exercise-records=""
      >
        <SectionLabel id="exercise-records-title" as="h2" title={COPY.title} />
        <p className="bo-text-body text-text-secondary">{COPY.empty}</p>
      </section>
    );
  }

  return (
    <>
      <section
        aria-labelledby="exercise-records-title"
        className="flex max-w-160 flex-col gap-4"
        data-exercise-records=""
      >
        <SectionLabel id="exercise-records-title" as="h2" title={COPY.title} />
        {records.length === 0 ? (
          <p className="bo-text-body-sm text-text-secondary">{COPY.noRecords}</p>
        ) : (
          <ul aria-label={COPY.listLabel} className="grid gap-3 sm:grid-cols-2">
            {records.map((record) => {
              const label = COPY.metricLabel[record.metric];
              const value = recordValue(record.metric, record.value);
              const day = formatSessionDay(record.startedAt);
              return (
                <li
                  key={record.metric}
                  className="bo-card flex flex-col gap-1"
                  data-exercise-record={record.metric}
                >
                  <span className="bo-text-label text-text-secondary">{label}</span>
                  <span className="bo-text-heading tabular-nums">{value}</span>
                  <Link
                    href={sessionPath(record.sessionId)}
                    aria-label={COPY.openRecordSession(label, value, day)}
                    className={`bo-text-body-sm flex min-h-11 w-fit items-center text-text-secondary hover:text-text ${linkClass}`}
                  >
                    {COPY.recordDay(day)}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex flex-col gap-2" data-exercise-line="">
          <h3 className="bo-text-body font-medium">
            {lineTitle}
            <span className="bo-text-body-sm font-normal text-text-secondary">
              {" · "}
              {COPY.lineWindow}
            </span>
          </h3>
          {line.length > 0 ? (
            <ProgressLine
              title={lineTitle}
              points={line.map((point) => ({
                key: point.sessionId,
                day: formatSessionDay(point.startedAt),
                value: point.value,
                valueText: recordValue(lineMetric, point.value),
              }))}
            />
          ) : (
            <p className="bo-text-body-sm text-text-secondary">{COPY.lineEmpty}</p>
          )}
        </div>
      </section>

      <section
        aria-labelledby="exercise-history-title"
        className="flex max-w-160 flex-col gap-3"
        data-exercise-history=""
      >
        <SectionLabel
          id="exercise-history-title"
          as="h2"
          tabIndex={-1}
          className="outline-none"
          title={COPY.historyTitle}
        />
        <p className="bo-text-body-sm text-text-secondary">{COPY.historyCount(totalSessions)}</p>
        <ul id="exercise-history-list" aria-label={COPY.historyLabel} className="bo-list">
          {history.map((entry) => {
            const day = formatSessionDay(entry.startedAt);
            const name = SESSIONS_COPY.routineOrFree(entry.routineName);
            return (
              <li key={entry.sessionId} className="bg-surface" data-exercise-history-row="">
                <Link
                  href={sessionPath(entry.sessionId)}
                  aria-label={SESSIONS_COPY.openSession(name, day)}
                  aria-describedby={`history-${entry.sessionId}-sets`}
                  className={`flex min-h-14 items-center gap-3 px-4 py-3 ${linkClass}`}
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="bo-text-body font-medium break-words">
                      {day} · {name}
                    </span>
                    <span
                      id={`history-${entry.sessionId}-sets`}
                      className="bo-text-body-sm break-words text-text-secondary tabular-nums"
                    >
                      {entry.sets}
                    </span>
                  </span>
                  <Icon icon={ChevronRight} size="sm" className="shrink-0 text-text-secondary" />
                </Link>
              </li>
            );
          })}
        </ul>
        <HistoryMore
          href={
            totalSessions > history.length && shown < HISTORY_MAX
              ? `${exercisePath(exerciseId)}?${HISTORY_COUNT_PARAM}=${shown + HISTORY_PAGE}`
              : null
          }
          shown={history.length}
          total={totalSessions}
          headingId="exercise-history-title"
          listId="exercise-history-list"
        />
      </section>
    </>
  );
}
