"use client";

// H2's sections of "Hoy": the folded "No tocan hoy (N)" and "Archivados (N)". The same
// disclosure pattern as the archived areas (src/app/(app)/areas/_components/archived-areas.tsx):
// a heading that holds the toggle and the count, folded by default.
import { ArchiveRestore, ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { AREA_ICONS, Icon, Key, Led } from "@/design-system";
import { cn } from "@/lib/cn";
import type { HabitItem } from "../habit-input";
import { ORGANIZE_COPY } from "../organize-copy";

type FoldedSectionProps = {
  title: string;
  count: number;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  /** Marks the section for tests and focus (e.g. "not-due"). */
  name: string;
  children: React.ReactNode;
};

/** A section folded by default: an h2 with the disclosure button and the count. */
export function FoldedSection({
  title,
  count,
  expanded,
  onExpandedChange,
  name,
  children,
}: FoldedSectionProps) {
  const ids = useId();
  const titleId = `${ids}-title`;
  const panelId = `${ids}-panel`;
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3" data-habits-section={name}>
      <h2 id={titleId} className="flex">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => onExpandedChange(!expanded)}
          className="bo-section-label min-h-11 flex-1 cursor-pointer rounded-md px-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <span className="flex items-center gap-3">
            <span className="bo-section-label__title">{title}</span>
            <span className="bo-section-label__count">{count}</span>
          </span>
          <Icon icon={ChevronDown} size="sm" className={cn(expanded && "rotate-180")} />
        </button>
      </h2>
      <div id={panelId} hidden={!expanded} className="flex flex-col gap-3">
        {children}
      </div>
    </section>
  );
}

/** The selector of an archived habit's "Reactivar" key. */
export const reactivateSelector = (id: string) => `[data-habit-reactivate="${CSS.escape(id)}"]`;

/**
 * "Archivados (N)" at the bottom of "Hoy" (H5 moves it to "Semana"): read-only rows with
 * "Reactivar". Hidden when there are none.
 */
export function ArchivedHabits({
  habits,
  onReactivate,
}: {
  habits: HabitItem[];
  onReactivate: (habit: HabitItem) => void;
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
              <span className="line-clamp-2 break-words" title={habit.name}>
                {habit.name}
              </span>
            </span>
            <Key
              variant="ghost"
              icon={ArchiveRestore}
              aria-label={ORGANIZE_COPY.reactivateRow(habit.name)}
              data-habit-reactivate={habit.id}
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
