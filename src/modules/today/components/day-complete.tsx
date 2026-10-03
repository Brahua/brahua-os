"use client";

import { CheckCheck } from "lucide-react";
import { Fragment, useEffect, useEffectEvent, useState } from "react";
import { Icon } from "@/design-system";
import { useRequiredScreenServices } from "@/modules/core/components/screen-services";
import { isDayComplete, variantForDay, type DayTally } from "../today-board";
import { TODAY_COPY } from "../today-copy";
import { useTodayProgress } from "./today-progress";

/** What was achieved today, as parts ("5 hábitos", "4 tareas"); a part at 0 is left out. */
export function dayAchievements({ habits, tasks }: DayTally): string[] {
  const parts: string[] = [];
  if (habits.done > 0) parts.push(TODAY_COPY.dayCompleteHabits(habits.done));
  if (tasks.doneToday > 0) parts.push(TODAY_COPY.dayCompleteTasks(tasks.doneToday));
  return parts;
}

/** The closing line of a Lima day: the same all day, server and client alike. */
export function dayCompleteMessage(today: string): string {
  const messages = TODAY_COPY.dayCompleteMessages;
  return messages[variantForDay(today, messages.length)];
}

/**
 * "Día completo" (SPEC-today, D4; principle 8): at the top of the board when every habit due
 * today counts as done, no task is left and something was done today. It follows the board's
 * live tally (`TodayProgressProvider`): it shows the moment the last thing is done (before the
 * server answers) and leaves if that is undone. No confetti, no screen of its own: a fade in
 * (`opacity` only, none with reduced motion) when it appears live, and one announcement through
 * the board's announcer for each live appearance (not when the page loads already complete). It
 * never takes focus.
 */
export function DayComplete() {
  const progress = useTodayProgress();
  const { announce } = useRequiredScreenServices();
  const complete = progress ? isDayComplete(progress.tally) : false;

  // Appearances after the first render (React's "state from the previous render" pattern, no
  // effect): each time it turns complete live, `appearances` goes up once. A server read that
  // keeps it complete, or a count that changes while complete, is not a new appearance.
  const [wasComplete, setWasComplete] = useState(complete);
  const [appearances, setAppearances] = useState(0);
  if (complete !== wasComplete) {
    setWasComplete(complete);
    if (complete) setAppearances((count) => count + 1);
  }

  const achieved = progress ? dayAchievements(progress.tally) : [];
  const onAppear = useEffectEvent(() => {
    announce(TODAY_COPY.dayCompleteAnnouncement(achieved));
  });
  useEffect(() => {
    if (appearances > 0) onAppear();
  }, [appearances]);

  if (!progress || !complete) return null;

  return (
    <section
      aria-labelledby="today-complete-title"
      className="bo-card bo-day-complete max-w-160 items-start"
      data-today-complete=""
      data-appeared={appearances > 0 ? "" : undefined}
    >
      <Icon icon={CheckCheck} size="xl" className="text-text-secondary" />
      <h2 id="today-complete-title" className="bo-text-title">
        {TODAY_COPY.dayCompleteTitle}
      </h2>
      <p className="bo-text-body">{dayCompleteMessage(progress.today)}</p>
      {achieved.length > 0 ? (
        <p className="bo-text-label text-text-secondary" data-today-complete-achieved="">
          <span className="sr-only">{TODAY_COPY.dayCompleteLabel}: </span>
          {achieved.map((part, index) => (
            <Fragment key={part}>
              {index > 0 ? <span aria-hidden="true"> · </span> : null}
              {part}
            </Fragment>
          ))}
        </p>
      ) : null}
    </section>
  );
}
