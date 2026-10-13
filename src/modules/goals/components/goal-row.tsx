"use client";

import Link from "next/link";
import { AREA_ICONS, Icon, Key, Led } from "@/design-system";
import { cn } from "@/lib/cn";
import type { GoalItem } from "../goal-input";
import { readGoal } from "../goal-text";
import { GOALS_COPY } from "../goals-copy";
import { goalPath } from "../routes";
import { GoalBar } from "./goal-bar";
import { preloadAddEntry } from "./use-goal-entries";

/** The selector of a goal's row. */
export const goalRowSelector = (id: string) => `[data-goal-row="${CSS.escape(id)}"]`;

type GoalRowProps = {
  goal: GoalItem;
  /** Lima's today: the pace is read for it. */
  today: string;
  /** Whether "+1" and "Sumar…" show (a manual goal of a period that is not over, not archived). */
  canAdd: boolean;
  onAdd?: (goal: GoalItem, delta: number) => void;
  onAddMore?: (goal: GoalItem, returnTo: HTMLElement | null) => void;
  /** Extra content under the row ("Reactivar" on an archived goal). */
  footer?: React.ReactNode;
};

/**
 * One goal (SPEC-goals "Pantallas"): its title (a link to its page), the bar, "5 de 12 libros",
 * the pace line and, for a manual goal in course, "+1" and "Sumar…". Color is never the only
 * channel: the status is a word ("Lograda", "Archivada"), the bar has its figures next to it.
 */
export function GoalRow({ goal, today, canAdd, onAdd, onAddMore, footer }: GoalRowProps) {
  const reading = readGoal(goal, today);
  const achieved = goal.status === "achieved";
  const archived = goal.status === "archived";
  return (
    <li
      data-goal-row={goal.id}
      data-goal-status={goal.status}
      className="flex flex-col gap-3 bg-surface px-4 py-3"
    >
      <div className="flex min-w-0 items-center gap-2">
        <Led area={goal.area?.color} on={achieved} />
        {goal.area ? <Icon icon={AREA_ICONS[goal.area.icon]} size="sm" aria-hidden /> : null}
        <Link
          href={goalPath(goal.id)}
          className="bo-text-body line-clamp-2 min-w-0 flex-1 rounded-sm font-medium break-words underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          title={goal.title}
        >
          {goal.title}
        </Link>
        {goal.area ? <span className="sr-only">{goal.area.name}</span> : null}
        {achieved ? (
          <span className="bo-text-label shrink-0 text-text-secondary">
            {GOALS_COPY.achievedBadge}
          </span>
        ) : null}
        {archived ? (
          <span className="bo-text-label shrink-0 text-text-secondary">
            {GOALS_COPY.archivedBadge}
          </span>
        ) : null}
      </div>
      {reading.kind === "ok" ? (
        <>
          <GoalBar
            title={goal.title}
            value={reading.value}
            target={reading.target}
            count={reading.count}
          />
          <div className="flex min-w-0 flex-col gap-1">
            <p className="bo-text-body-sm" data-goal-count="">
              {reading.count}
            </p>
            {reading.line ? (
              <p className="bo-text-body-sm text-text-secondary" data-goal-line="">
                {reading.line}
              </p>
            ) : null}
          </div>
        </>
      ) : (
        <p className="bo-text-body-sm text-text-secondary">{reading.line}</p>
      )}
      {canAdd && onAdd && onAddMore ? (
        <div className={cn("flex flex-wrap gap-2")}>
          <Key
            aria-label={GOALS_COPY.addOne(goal.title)}
            data-goal-add={goal.id}
            onClick={() => onAdd(goal, 1)}
          >
            {GOALS_COPY.add}
          </Key>
          <Key
            variant="ghost"
            aria-label={GOALS_COPY.addMoreLabel(goal.title)}
            data-goal-add-more={goal.id}
            onPointerEnter={preloadAddEntry}
            onFocus={preloadAddEntry}
            onClick={(event) => onAddMore(goal, event.currentTarget)}
          >
            {GOALS_COPY.addMore}
          </Key>
        </div>
      ) : null}
      {footer}
    </li>
  );
}
