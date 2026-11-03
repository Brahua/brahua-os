"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Icon, Key } from "@/design-system";
import { NOTES_COPY as COPY } from "../copy";
import { NOTE_DAY_MIN } from "../note-constants";
import { addDays, dailyTitle, isWritableDay } from "../note-day";
import { dailyNotePath } from "../routes";

const DAY_LINK =
  "bo-text-body-sm inline-flex min-h-11 items-center gap-1 rounded-md px-1 text-text-secondary underline-offset-4 hover:text-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

type DailyNoteHeaderProps = {
  /** The note's day (`YYYY-MM-DD`). */
  day: string;
  /** Lima's today: «Día siguiente» stops there and the picker can't go past it. */
  today: string;
  /** Id of the `<h1>`. */
  headingId: string;
};

/**
 * A daily note's header (SPEC-notes "Navegación del diario"): the long date as the title, «Día
 * anterior» / «Día siguiente» (up to today) and a day picker. A day without a note opens empty.
 */
export function DailyNoteHeader({ day, today, headingId }: DailyNoteHeaderProps) {
  const router = useRouter();
  const ids = useId();
  const [picked, setPicked] = useState(day);
  const previous = addDays(day, -1);
  const next = addDays(day, 1);

  return (
    <header className="flex flex-col gap-4">
      <h1 id={headingId} tabIndex={-1} className="bo-text-display break-words outline-none">
        {dailyTitle(day, today)}
      </h1>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <nav aria-label={COPY.dayNavLabel} className="flex flex-wrap items-center gap-2">
          {previous >= NOTE_DAY_MIN ? (
            <Link href={dailyNotePath(previous)} className={DAY_LINK} data-note-previous-day="">
              <Icon icon={ChevronLeft} size="sm" />
              {COPY.previousDay}
            </Link>
          ) : null}
          {day < today ? (
            <Link href={dailyNotePath(next)} className={DAY_LINK} data-note-next-day="">
              {COPY.nextDay}
              <Icon icon={ChevronRight} size="sm" />
            </Link>
          ) : null}
        </nav>
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (isWritableDay(picked, today) && picked !== day) router.push(dailyNotePath(picked));
          }}
        >
          <div className="bo-field">
            <label className="bo-field__label" htmlFor={`${ids}-day`}>
              {COPY.goToDayLabel}
            </label>
            <input
              id={`${ids}-day`}
              type="date"
              className="bo-field__control"
              min={NOTE_DAY_MIN}
              max={today}
              value={picked}
              onChange={(event) => setPicked(event.target.value)}
            />
          </div>
          <Key type="submit" variant="ghost">
            {COPY.go}
          </Key>
        </form>
      </div>
    </header>
  );
}
