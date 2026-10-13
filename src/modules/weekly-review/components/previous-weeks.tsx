import Link from "next/link";
import { HISTORIAL_COPY } from "../review-copy";
import type { PreviousWeek } from "../queries";
import { reviewStepPath } from "../routes";
import { weekLabel } from "../week";

type PreviousWeeksProps = { weeks: readonly PreviousWeek[] };

/**
 * «Semanas anteriores» (SPEC-weekly-review "Pantallas"): the closed weeks, the most recent first,
 * each with its dates, «Días completos», «N de M hábitos» and its note; it links to that week's
 * review. Read-only: nothing to delete or reopen, no comparison between weeks. A Server Component.
 */
export function PreviousWeeks({ weeks }: PreviousWeeksProps) {
  return (
    <section
      aria-labelledby="review-previous"
      className="flex max-w-160 flex-col gap-3"
      data-review-history=""
    >
      <h2 id="review-previous" className="bo-text-title">
        {HISTORIAL_COPY.title}
      </h2>
      {weeks.length === 0 ? (
        <p className="bo-text-body-sm text-text-secondary" data-history-empty="">
          {HISTORIAL_COPY.empty}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {weeks.map((week) => (
            <li key={week.weekStart} className="bo-card gap-1" data-history-week={week.weekStart}>
              <p className="bo-text-body">
                <Link
                  href={reviewStepPath(1, week.weekStart)}
                  className="rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  {weekLabel(week.weekStart)}
                </Link>
              </p>
              <p className="bo-text-body-sm">
                {HISTORIAL_COPY.completeDays(week.completeDays)}
                {" · "}
                {week.habitsExpected > 0
                  ? HISTORIAL_COPY.habits(week.habitsDone, week.habitsExpected)
                  : HISTORIAL_COPY.noHabits}
              </p>
              {week.note ? (
                <p className="bo-text-body-sm break-words text-text-secondary">
                  {HISTORIAL_COPY.note(week.note)}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
