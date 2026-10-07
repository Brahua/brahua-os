"use client";

import { CalendarArrowDown, CalendarDays } from "lucide-react";
import { createContext, use } from "react";
import { Key } from "@/design-system";
import { POSTPONE_COPY } from "../postpone-copy";

// "Mañana" and "Otro día…" on a task's row (polish → postpone-one-tap): the keys. No motion here:
// the swipe (`swipe-row.tsx`) is what loads the animation library, and only where rows postpone.

/** What a row's postpone keys need from its list. */
export type RowPostpone = {
  /** "Mañana": the list removes the row (or updates it) and saves. */
  onTomorrow: (task: { id: string; title: string }) => void;
  /** "Otro día…": the list opens its sheet; `trigger` gets focus back on close. */
  onPick: (task: { id: string; title: string }, trigger: HTMLElement) => void;
  /**
   * The task already is due tomorrow: "Mañana" stays (a key never unmounts under focus: the
   * task may have just moved there) but is `aria-disabled` and does nothing.
   */
  tomorrowDisabled?: boolean;
  /** A save of this task is in flight: the keys stay focusable (`aria-disabled`) and do nothing. */
  busy?: boolean;
};

/** Lets a key start the row's fade-out; the row then calls what the key asked for. */
export const RowLeave = createContext<((run: () => void) => void) | null>(null);

type PostponeKeysProps = RowPostpone & { task: { id: string; title: string } };

/**
 * "Mañana" (icon and text, 48 px) and "Otro día…": secondary keys (ghost, never the signal one:
 * completing is the row's primary action). Below 640 px they sit under the title; wider, at the
 * row's end.
 */
export function PostponeKeys({
  task,
  onTomorrow,
  onPick,
  tomorrowDisabled = false,
  busy = false,
}: PostponeKeysProps) {
  const leave = use(RowLeave);
  const tomorrowOff = busy || tomorrowDisabled;
  return (
    <div className="flex shrink-0 basis-full flex-wrap items-center gap-x-1 pl-12 sm:basis-auto sm:self-center sm:pl-0">
      <Key
        variant="ghost"
        icon={CalendarArrowDown}
        aria-label={POSTPONE_COPY.tomorrowName(task.title)}
        aria-disabled={tomorrowOff || undefined}
        data-task-focus={`postpone:${task.id}`}
        onClick={() => {
          if (tomorrowOff) return;
          if (leave) leave(() => onTomorrow(task));
          else onTomorrow(task);
        }}
      >
        {POSTPONE_COPY.tomorrow}
      </Key>
      <Key
        variant="ghost"
        icon={CalendarDays}
        aria-label={POSTPONE_COPY.pickName(task.title)}
        aria-haspopup="dialog"
        aria-disabled={busy || undefined}
        data-task-focus={`pick:${task.id}`}
        onClick={(event) => {
          if (!busy) onPick(task, event.currentTarget);
        }}
      >
        {POSTPONE_COPY.pick}
      </Key>
    </div>
  );
}
