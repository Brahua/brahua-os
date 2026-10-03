import { ChevronLeft, ChevronRight, Repeat } from "lucide-react";
import Link from "next/link";
import { DotMatrix, Icon, Key, Lcd, Led, StatNumber, type DotMatrixDay } from "@/design-system";
import { cn } from "@/lib/cn";
import type { HabitItem } from "../habit-input";
import { HABITS_COPY } from "../habits-copy";
import { dayStateText, HISTORY_COPY, WEEKDAY_LETTERS } from "../history-copy";
import type { HabitsWeek } from "../history";
import { habitPath, habitViewHref } from "../routes";
import { addDays, weekStart } from "../schedule";
import { dayDots, type HabitWeekRow } from "../week-summary";
import { ArchivedHabitsSection } from "./archived-habits-section";

type HabitsWeekViewProps = {
  week: HabitsWeek;
  /** The archived habits ("Archivados", with "Reactivar"). */
  archived: HabitItem[];
  /** Lima's today (the page's). */
  today: string;
  headingId: string;
  /** "Hoy · Semana". */
  viewSwitch: React.ReactNode;
};

/**
 * H5: "Semana" (SPEC-habits "Pantallas"): the week's total ("18 de 24 esta semana", `StatNumber`
 * in an `Lcd`), each active habit with its 7 days (Monday to Sunday) in a `DotMatrix` and its
 * compliance ("5 de 7", "2 de 3"), "Semana anterior / siguiente" (links, `?semana=`, from the
 * first week of the habits to the current one) and the folded "Archivados (N)". Read-only: a
 * habit's name opens its page, where days are logged.
 */
export function HabitsWeekView({
  week,
  archived,
  today,
  headingId,
  viewSwitch,
}: HabitsWeekViewProps) {
  const { monday, rows, total, earliestStart } = week;
  const sunday = addDays(monday, 6);
  const current = monday === weekStart(today);
  const previous =
    earliestStart !== null && monday > weekStart(earliestStart) ? addDays(monday, -7) : null;
  const next = current ? null : addDays(monday, 7);
  const weekHeadingId = `${headingId}-week`;
  const rangeId = `${headingId}-range`;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        {/* tabIndex -1: focus lands here when the last archived habit is reactivated. */}
        <h1 id={headingId} tabIndex={-1} className="bo-text-display outline-none">
          {HABITS_COPY.title}
        </h1>
      </header>

      {viewSwitch}

      <section
        aria-labelledby={weekHeadingId}
        aria-describedby={rangeId}
        className="flex flex-col gap-4"
      >
        <h2 id={weekHeadingId} className="sr-only">
          {HISTORY_COPY.weekHeading}
        </h2>

        <Lcd block className="max-w-180" data-week-total="">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <StatNumber
              size="lg"
              value={total.done}
              unit={HISTORY_COPY.ofTotal(total.expected)}
              label={current ? HISTORY_COPY.thisWeek : HISTORY_COPY.thatWeek}
            />
            <p id={rangeId} className="bo-lcd__meta">
              {HISTORY_COPY.weekRange(monday, sunday)}
            </p>
          </div>
        </Lcd>

        <nav
          aria-label={HISTORY_COPY.weekNav}
          className="flex max-w-180 flex-wrap items-center gap-2"
        >
          {previous ? (
            <Key asChild variant="ghost" size="md">
              <Link href={habitViewHref("semana", previous)} prefetch={false} rel="prev">
                <Icon icon={ChevronLeft} />
                {/* On the phone only the arrow shows (the three keys fit one row); the name stays. */}
                <span className="max-sm:sr-only">{HISTORY_COPY.previousWeek}</span>
              </Link>
            </Key>
          ) : null}
          {next ? (
            <Key asChild variant="ghost" size="md" className="ml-auto">
              <Link href={habitViewHref("semana", next)} prefetch={false} rel="next">
                <span className="max-sm:sr-only">{HISTORY_COPY.nextWeek}</span>
                <Icon icon={ChevronRight} />
              </Link>
            </Key>
          ) : null}
          {!current ? (
            <Key asChild variant="ghost" size="md">
              <Link href={habitViewHref("semana")} prefetch={false}>
                {HISTORY_COPY.backToThisWeek}
              </Link>
            </Key>
          ) : null}
        </nav>

        {rows.length > 0 ? (
          <ul
            aria-label={HISTORY_COPY.weekListLabel}
            className="grid max-w-180 gap-3 md:grid-cols-2"
            data-habits-week=""
          >
            {rows.map((row) => (
              <HabitWeekCard key={row.id} row={row} today={today} />
            ))}
          </ul>
        ) : (
          <div className="bo-card max-w-160 items-start" data-habits-week-empty="">
            <Icon icon={Repeat} size="xl" className="text-text-secondary" />
            <p className="bo-text-body-sm text-text-secondary">
              {earliestStart === null ? HISTORY_COPY.noHabitsYet : HISTORY_COPY.noHabitsThatWeek}
            </p>
            {earliestStart === null ? (
              <Key asChild>
                <Link href={habitViewHref("hoy")}>{HISTORY_COPY.goToday}</Link>
              </Key>
            ) : null}
          </div>
        )}
      </section>

      <ArchivedHabitsSection habits={archived} headingId={headingId} />
    </div>
  );
}

/** A habit's week: its name (a link to its page), its compliance and its 7 days. */
function HabitWeekCard({ row, today }: { row: HabitWeekRow; today: string }) {
  const quantity = row.kind === "build" && row.measure === "quantity";
  const days: DotMatrixDay[] = row.days.map((day, index) => {
    const dots = dayDots(row, day);
    return {
      label: WEEKDAY_LETTERS[index],
      total: dots.total,
      done: dots.done,
      complete: dots.complete,
      state: day.day === today ? "today" : day.day > today ? "upcoming" : "past",
    };
  });
  return (
    <li data-habit-week={row.id}>
      <Lcd block className="h-full gap-3">
        <div className="flex items-start justify-between gap-3">
          <span className="flex min-w-0 items-center gap-2">
            <Led area={row.area?.color} on />
            <Link
              href={habitPath(row.id)}
              className="bo-text-body-strong line-clamp-2 rounded-sm break-words underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              {row.name}
            </Link>
            {row.area ? (
              <span className="sr-only">{HABITS_COPY.padArea(row.area.name)}</span>
            ) : null}
          </span>
          <span className="bo-lcd__meta flex-none whitespace-nowrap" data-week-compliance="">
            <span aria-hidden>
              {HISTORY_COPY.compliance(row.compliance.done, row.compliance.expected)}
            </span>
            <span className="sr-only">
              {HISTORY_COPY.complianceHelp(row.compliance.done, row.compliance.expected)}
            </span>
          </span>
        </div>
        {/* The dots are a picture of the list below (read by screen readers instead). */}
        <DotMatrix
          aria-hidden
          days={days}
          dotSize={quantity ? 6 : 10}
          className={cn("bo-habit-week", !quantity && "bo-habit-week--single")}
        />
        <ul aria-label={HISTORY_COPY.weekDaysLabel(row.name)} className="sr-only">
          {row.days.map((day) => (
            <li key={day.day}>
              {HISTORY_COPY.dayLine(
                day.day,
                day.day === today,
                dayStateText({
                  status: day.status,
                  kind: row.kind,
                  quantity: quantity ? day.quantity : null,
                  target: day.target,
                  unit: row.unit,
                }),
              )}
            </li>
          ))}
        </ul>
      </Lcd>
    </li>
  );
}
