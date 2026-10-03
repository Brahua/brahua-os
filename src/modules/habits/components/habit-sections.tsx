"use client";

// H2's folded sections: "No tocan hoy (N)" on "Hoy" and "Archivados (N)" (on "Semana" since H5). The same
// disclosure pattern as the archived areas (src/app/(app)/areas/_components/archived-areas.tsx):
// a heading that holds the toggle and the count, folded by default.
import { ArchiveRestore, ChevronDown } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { AREA_ICONS, Icon, Key, Led } from "@/design-system";
import { cn } from "@/lib/cn";
import type { HabitItem } from "../habit-input";
import { HABITS_COPY } from "../habits-copy";
import { ORGANIZE_COPY } from "../organize-copy";
import { habitPath } from "../routes";

type FoldedSectionProps = {
  title: string;
  count: number;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  /** Marks the section for tests and focus (e.g. "not-due"). */
  name: string;
  /** Its heading's level (H5: 3 inside another section, e.g. the past pauses). */
  level?: 2 | 3;
  children: React.ReactNode;
};

/** A section folded by default: a heading (h2) with the disclosure button and the count. */
export function FoldedSection({
  title,
  count,
  expanded,
  onExpandedChange,
  name,
  level = 2,
  children,
}: FoldedSectionProps) {
  const Heading = level === 2 ? "h2" : "h3";
  const ids = useId();
  const titleId = `${ids}-title`;
  const panelId = `${ids}-panel`;
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3" data-habits-section={name}>
      <Heading id={titleId} className="flex">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => onExpandedChange(!expanded)}
          className="bo-section-label min-h-11 flex-1 cursor-pointer rounded-md px-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <span className="flex items-center gap-3">
            <span className="bo-section-label__title">{title}</span>
            {/* A space, so the name never reads "No tocan hoy3". */}
            <span className="sr-only"> </span>
            <span className="bo-section-label__count">{count}</span>
          </span>
          <Icon icon={ChevronDown} size="sm" className={cn(expanded && "rotate-180")} />
        </button>
      </Heading>
      <div id={panelId} hidden={!expanded} className="flex flex-col gap-3">
        {children}
      </div>
    </section>
  );
}

/** The selector of an archived habit's "Reactivar" key. */
export const reactivateSelector = (id: string) => `[data-habit-reactivate="${CSS.escape(id)}"]`;

/**
 * "Archivados (N)" at the bottom of "Semana" (H5; H2 had it on "Hoy"): read-only rows with
 * "Reactivar" and a link to each habit's page. Hidden when there are none.
 */
export function ArchivedHabits({
  habits,
  onReactivate,
  isBusy,
}: {
  habits: HabitItem[];
  onReactivate: (habit: HabitItem) => void;
  /** Whether its reactivation is on its way ("Reactivar" is aria-disabled meanwhile). */
  isBusy?: (habit: HabitItem) => boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  if (habits.length === 0) return null;
  return (
    <FoldedSection
      title={ORGANIZE_COPY.archivedTitle}
      count={habits.length}
      expanded={expanded}
      onExpandedChange={setExpanded}
      name="archived"
    >
      <p className="bo-text-body-sm text-text-secondary">{ORGANIZE_COPY.archivedHelp}</p>
      <ul aria-label={ORGANIZE_COPY.archivedList} className="bo-list max-w-160">
        {habits.map((habit) => (
          <li
            key={habit.id}
            data-archived-habit={habit.id}
            className="flex min-h-14 items-center gap-2 bg-surface py-1 pr-2 pl-4"
          >
            <span className="bo-text-body flex min-w-0 flex-1 items-center gap-2">
              <Led area={habit.area?.color} />
              {habit.area ? (
                <Icon icon={AREA_ICONS[habit.area.icon]} size="sm" aria-hidden />
              ) : null}
              {/* H5: its page (calendar, streaks), archived or not. */}
              <Link
                href={habitPath(habit.id)}
                className="line-clamp-2 rounded-sm break-words underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                title={habit.name}
              >
                {habit.name}
              </Link>
              {habit.area ? (
                <span className="sr-only">{HABITS_COPY.padArea(habit.area.name)}</span>
              ) : null}
            </span>
            <Key
              variant="ghost"
              icon={ArchiveRestore}
              aria-label={ORGANIZE_COPY.reactivateRow(habit.name)}
              data-habit-reactivate={habit.id}
              // Never `disabled` (it may have focus): the section guards a second activation.
              aria-disabled={isBusy?.(habit) || undefined}
              onClick={() => onReactivate(habit)}
            >
              <span className="max-sm:sr-only">{ORGANIZE_COPY.reactivate}</span>
            </Key>
          </li>
        ))}
      </ul>
    </FoldedSection>
  );
}
