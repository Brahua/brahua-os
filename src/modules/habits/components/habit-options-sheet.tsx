"use client";

import {
  Archive,
  CalendarClock,
  CalendarX,
  Pause,
  Pencil,
  Play,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Key, Sheet } from "@/design-system";
import { useIsDesktop } from "@/lib/use-is-desktop";
import type { HabitItem } from "../habit-input";
import { HABITS_COPY } from "../habits-copy";
import { MEASURE_COPY } from "../measure-copy";
import { ORGANIZE_COPY } from "../organize-copy";
import { isPausedToday } from "../habit-status";
import { PAUSE_COPY } from "../pause-copy";
import { otherLoggableDays } from "../schedule";
import { useHabitsScreen } from "./habits-screen";
import { preloadPause } from "./use-pause-flow";
import { preloadAdjust } from "./use-quantity-log";

export type HabitOptionsSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  habit: HabitItem;
  /** Where focus goes when the sheet closes (the options key, or a neighbor after a delete). */
  returnFocusRef: React.RefObject<HTMLElement | null>;
  onClosed?: () => void;
  /** Delete it (the screen closes the sheet, removes the pad and offers "Deshacer"). */
  onDelete: (habit: HabitItem) => void;
  /** H2: edit it (the screen closes this sheet, then opens the form with the habit). */
  onEdit?: (habit: HabitItem) => void;
  /** H2: archive it (the screen closes the sheet, removes the pad and offers "Deshacer"). */
  onArchive?: (habit: HabitItem) => void;
  /** H3: open "Ajustar el día" (the screen closes this sheet first). Quantity habits only. */
  onAdjust?: (habit: HabitItem) => void;
  /** H4: open "Registrar otro día" (the screen closes this sheet first). */
  onLogOtherDay?: (habit: HabitItem) => void;
  /** H4: open "Pausar" (the screen closes this sheet first). */
  onPause?: (habit: HabitItem) => void;
  /** H4: "Reanudar" the current pause, or cancel the next one (the screen closes the sheet). */
  onResume?: (habit: HabitItem) => void;
};

/**
 * What can be done with one habit (its "Opciones" key on the pad). H1: "Eliminar hábito", which
 * asks first when the habit has logged days (SPEC-habits "Eliminar"). H2–H4 add theirs in the
 * slots below (each its own component and action), until H5's page holds them.
 */
export function HabitOptionsSheet({
  open,
  onOpenChange,
  habit,
  returnFocusRef,
  onClosed,
  onDelete,
  onEdit,
  onArchive,
  onAdjust,
  onLogOtherDay,
  onPause,
  onResume,
}: HabitOptionsSheetProps) {
  const isDesktop = useIsDesktop();
  const { today } = useHabitsScreen();
  // H4: the habit's current pause (or the next one) and whether earlier days can be logged.
  const pause = habit.pause;
  const pausedToday = isPausedToday(habit, today);
  const canLogOtherDay = otherLoggableDays(habit.startDate, today).length > 0;
  const [confirming, setConfirming] = useState(false);
  const ids = useId();
  const deleteKey = useRef<HTMLButtonElement>(null);
  const confirmTitle = useRef<HTMLHeadingElement>(null);
  // The confirmation replaces the key that had focus (and back): move it after the commit.
  const focusNext = useRef<"confirm" | "delete" | null>(null);

  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    (target === "confirm" ? confirmTitle.current : deleteKey.current)?.focus();
  });

  function askDelete() {
    if (!habit.hasLogs) {
      onDelete(habit);
      return;
    }
    focusNext.current = "confirm";
    setConfirming(true);
  }

  function keep() {
    focusNext.current = "delete";
    setConfirming(false);
  }

  const helpId = `${ids}-delete-help`;
  const archiveHelpId = `${ids}-archive-help`;
  const adjustHelpId = `${ids}-adjust-help`;
  const otherDayHelpId = `${ids}-other-day-help`;
  const pauseHelpId = `${ids}-pause-help`;
  const pauseStateId = `${ids}-pause-state`;
  const confirmTextId = `${ids}-confirm-text`;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      variant={isDesktop ? "side" : "bottom"}
      title={habit.name}
      description={HABITS_COPY.optionsDescription}
      returnFocusRef={returnFocusRef}
      onClosed={onClosed}
      focusTitleOnOpen
    >
      <div className="flex flex-col gap-6">
        {/* H2: Editar (opens the form once this sheet is gone) and Archivar. */}
        {onEdit || onArchive ? (
          <div className="flex flex-col items-start gap-2">
            {onEdit ? (
              <Key
                variant="ghost"
                icon={Pencil}
                aria-haspopup="dialog"
                data-habit-edit=""
                onClick={() => onEdit(habit)}
              >
                {ORGANIZE_COPY.edit}
              </Key>
            ) : null}
            {onArchive ? (
              <>
                <Key
                  variant="ghost"
                  icon={Archive}
                  aria-describedby={archiveHelpId}
                  onClick={() => onArchive(habit)}
                >
                  {ORGANIZE_COPY.archive}
                </Key>
                <p id={archiveHelpId} className="bo-text-body-sm text-text-secondary">
                  {ORGANIZE_COPY.archiveHelp}
                </p>
              </>
            ) : null}
          </div>
        ) : null}

        {/* H3 (Ajustar el día): today's exact quantity, for a quantity habit. */}
        {onAdjust && habit.kind === "build" && habit.measure === "quantity" ? (
          <div className="flex flex-col items-start gap-2">
            <Key
              variant="ghost"
              icon={SlidersHorizontal}
              aria-haspopup="dialog"
              aria-describedby={adjustHelpId}
              onPointerEnter={preloadAdjust}
              onFocus={preloadAdjust}
              onTouchStart={preloadAdjust}
              onClick={() => onAdjust(habit)}
            >
              {MEASURE_COPY.adjustDay}
            </Key>
            <p id={adjustHelpId} className="bo-text-body-sm text-text-secondary">
              {MEASURE_COPY.adjustHelp}
            </p>
          </div>
        ) : null}

        {/* H4: "Registrar otro día" (one of the 7 days before today). */}
        {onLogOtherDay && canLogOtherDay ? (
          <div className="flex flex-col items-start gap-2">
            <Key
              variant="ghost"
              icon={CalendarClock}
              aria-haspopup="dialog"
              aria-describedby={otherDayHelpId}
              onPointerEnter={preloadAdjust}
              onFocus={preloadAdjust}
              onTouchStart={preloadAdjust}
              onClick={() => onLogOtherDay(habit)}
            >
              {PAUSE_COPY.logOtherDay}
            </Key>
            <p id={otherDayHelpId} className="bo-text-body-sm text-text-secondary">
              {PAUSE_COPY.logOtherDayHelp}
            </p>
          </div>
        ) : null}

        {/* H4: the current (or next) pause with "Reanudar", and "Pausar". */}
        {onPause || onResume ? (
          <div className="flex flex-col items-start gap-2">
            {pause && onResume ? (
              <>
                <p id={pauseStateId} className="bo-text-body-sm" data-habit-pause-state="">
                  {pausedToday
                    ? PAUSE_COPY.pausedUntil(pause.endDate, pause.reason)
                    : PAUSE_COPY.pauseAhead(pause.startDate, pause.endDate, pause.reason)}
                </p>
                <Key
                  variant="ghost"
                  icon={pausedToday ? Play : CalendarX}
                  aria-describedby={pauseStateId}
                  onClick={() => onResume(habit)}
                >
                  {pausedToday ? PAUSE_COPY.resume : PAUSE_COPY.cancelPause}
                </Key>
              </>
            ) : null}
            {onPause && !pausedToday ? (
              <>
                <Key
                  variant="ghost"
                  icon={Pause}
                  aria-haspopup="dialog"
                  aria-describedby={pauseHelpId}
                  onPointerEnter={preloadPause}
                  onFocus={preloadPause}
                  onTouchStart={preloadPause}
                  onClick={() => onPause(habit)}
                >
                  {PAUSE_COPY.pause}
                </Key>
                <p id={pauseHelpId} className="bo-text-body-sm text-text-secondary">
                  {PAUSE_COPY.pauseHelp}
                </p>
              </>
            ) : null}
          </div>
        ) : null}

        {confirming ? (
          // No role="group" named by the heading: with focus on the heading it was read twice.
          <div className="flex flex-col gap-3">
            <h3 ref={confirmTitle} tabIndex={-1} className="bo-text-body-strong outline-none">
              {HABITS_COPY.confirmTitle(habit.name)}
            </h3>
            <p id={confirmTextId} className="bo-text-body-sm text-text-secondary">
              {HABITS_COPY.confirmText}
            </p>
            <div className="flex flex-wrap gap-2">
              <Key
                variant="signal"
                icon={Trash2}
                aria-describedby={confirmTextId}
                onClick={() => onDelete(habit)}
              >
                {HABITS_COPY.confirmDelete}
              </Key>
              <Key variant="ghost" onClick={keep}>
                {HABITS_COPY.keep}
              </Key>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-start gap-2">
            <Key
              ref={deleteKey}
              variant="ghost"
              icon={Trash2}
              aria-describedby={helpId}
              onClick={askDelete}
            >
              {HABITS_COPY.deleteHabit}
            </Key>
            <p id={helpId} className="bo-text-body-sm text-text-secondary">
              {HABITS_COPY.deleteHelp}
            </p>
          </div>
        )}
      </div>
    </Sheet>
  );
}
