"use client";

import { ChevronLeft, ChevronRight, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Icon, Key } from "@/design-system";
import { cn } from "@/lib/cn";
import { requestNavigation } from "@/lib/navigation-guard";
import { NOTES_COPY as COPY, NOTES_ERRORS } from "../copy";
import { NOTE_DAY_MIN } from "../note-constants";
import { addDays, dailyTitle, isWritableDay } from "../note-day";
import { dailyNotePath } from "../routes";
import { markDayLink, takeDayLink } from "./day-focus";

/** A click that opens the link in this tab (not ⌘/Ctrl/Shift/⌥ or another button). */
function plainClick(event: React.MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

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
 * The page keys it by day: after a day link, focus lands on the same link of the new day (or the
 * h1 when that link isn't there); «Ir» goes through the unsaved-changes guard and refuses a day
 * that isn't valid, in the future or before the first one, on the field (WCAG 3.3.1).
 */
export function DailyNoteHeader({ day, today, headingId }: DailyNoteHeaderProps) {
  const router = useRouter();
  const ids = useId();
  const [picked, setPicked] = useState(day);
  const [error, setError] = useState<string | undefined>();
  const previousLink = useRef<HTMLAnchorElement>(null);
  const nextLink = useRef<HTMLAnchorElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const previous = addDays(day, -1);
  const next = addDays(day, 1);

  // Arrived through a day link: focus the same link, or the h1 when it isn't there (today has no
  // «Día siguiente»).
  useEffect(() => {
    const link = takeDayLink();
    if (!link) return;
    const target = link === "previous" ? previousLink.current : nextLink.current;
    (target ?? document.getElementById(headingId))?.focus();
  }, [headingId]);

  function go() {
    if (!isWritableDay(picked, today)) {
      setError(NOTES_ERRORS.day);
      field.current?.focus();
      return;
    }
    if (picked === day) return;
    const href = dailyNotePath(picked);
    // Through the guard: unsaved text asks first (src/lib/navigation-guard.ts).
    requestNavigation(href, () => router.push(href));
  }

  const errorId = `${ids}-day-error`;

  return (
    <header className="flex flex-col gap-4">
      <h1 id={headingId} tabIndex={-1} className="bo-text-display break-words outline-none">
        {dailyTitle(day, today)}
      </h1>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <nav aria-label={COPY.dayNavLabel} className="flex flex-wrap items-center gap-2">
          {previous >= NOTE_DAY_MIN ? (
            <Link
              ref={previousLink}
              href={dailyNotePath(previous)}
              className={DAY_LINK}
              data-note-previous-day=""
              onClick={(event) => plainClick(event) && markDayLink("previous")}
            >
              <Icon icon={ChevronLeft} size="sm" />
              {COPY.previousDay}
            </Link>
          ) : null}
          {day < today ? (
            <Link
              ref={nextLink}
              href={dailyNotePath(next)}
              className={DAY_LINK}
              data-note-next-day=""
              onClick={(event) => plainClick(event) && markDayLink("next")}
            >
              {COPY.nextDay}
              <Icon icon={ChevronRight} size="sm" />
            </Link>
          ) : null}
        </nav>
        <form
          noValidate
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            go();
          }}
        >
          <div className={cn("bo-field", error && "is-error")}>
            <label className="bo-field__label" htmlFor={`${ids}-day`}>
              {COPY.goToDayLabel}
            </label>
            <input
              ref={field}
              id={`${ids}-day`}
              type="date"
              className="bo-field__control"
              min={NOTE_DAY_MIN}
              max={today}
              value={picked}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? errorId : undefined}
              onChange={(event) => {
                setPicked(event.target.value);
                setError(undefined);
              }}
            />
            {error ? (
              <span id={errorId} className="bo-field__error">
                <Icon icon={TriangleAlert} size="sm" />
                {error}
              </span>
            ) : null}
          </div>
          <Key type="submit" variant="ghost">
            {COPY.go}
          </Key>
        </form>
      </div>
    </header>
  );
}
