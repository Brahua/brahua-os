"use client";

import { Archive, Pencil, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Key, Sheet } from "@/design-system";
import { useIsDesktop } from "@/lib/use-is-desktop";
import type { HabitItem } from "../habit-input";
import { HABITS_COPY } from "../habits-copy";
import { ORGANIZE_COPY } from "../organize-copy";

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
}: HabitOptionsSheetProps) {
  const isDesktop = useIsDesktop();
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

        {/* H3 slot (Ajustar el día). */}

        {/* H4 slot (Pausar, Reanudar). */}

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
