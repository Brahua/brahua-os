"use client";

import { Coffee } from "lucide-react";
import { useId } from "react";
import { Key, Sheet } from "@/design-system";
import { useIsDesktop } from "@/lib/use-is-desktop";
import type { HabitItem } from "../habit-input";
import { HABITS_COPY } from "../habits-copy";
import { SKIP_COPY } from "../skip-copy";

export type SkipSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  habit: HabitItem;
  /** Where focus goes when the sheet closes without skipping (the pad's corner key). */
  returnFocusRef: React.RefObject<HTMLElement | null>;
  onClosed?: () => void;
  /** "Saltar hoy" (the board closes the sheet, then rests the habit for today). */
  onSkip: (habit: HabitItem) => void;
};

/**
 * The little options sheet of a pad on the board (`/`): the habit's name and "Saltar hoy". The
 * full options (edit, archive, delete, pauses) stay in Hábitos; the board only logs and rests.
 */
export function SkipSheet({
  open,
  onOpenChange,
  habit,
  returnFocusRef,
  onClosed,
  onSkip,
}: SkipSheetProps) {
  const isDesktop = useIsDesktop();
  const helpId = `${useId()}-skip-help`;
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
      <div className="flex flex-col items-start gap-2">
        <Key
          variant="ghost"
          icon={Coffee}
          aria-describedby={helpId}
          data-habit-skip=""
          onClick={() => onSkip(habit)}
        >
          {SKIP_COPY.skipToday}
        </Key>
        <p id={helpId} className="bo-text-body-sm text-text-secondary">
          {SKIP_COPY.skipHelp}
        </p>
      </div>
    </Sheet>
  );
}
