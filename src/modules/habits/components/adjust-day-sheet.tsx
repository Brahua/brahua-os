"use client";

import { Minus, Plus } from "lucide-react";
import { useId, useRef, useState } from "react";
import { IconKey, Key, Sheet, TextField } from "@/design-system";
import { useIsDesktop } from "@/lib/use-is-desktop";
import { HABIT_QUANTITY_MAX } from "../habit-constants";
import type { HabitItem } from "../habit-input";
import { MEASURE_COPY } from "../measure-copy";
import { quantitySchema } from "../quantity-input";

/** The field's text as a number for the schema: blank is "missing", anything else as typed. */
function parseQuantity(text: string): number | undefined {
  const trimmed = text.trim();
  return trimmed === "" ? undefined : Number(trimmed);
}

export type AdjustDaySheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A quantity habit, as it is today. */
  habit: HabitItem;
  /** Where focus goes when the sheet closes (the pad's options key). */
  returnFocusRef: React.RefObject<HTMLElement | null>;
  onClosed?: () => void;
  /** Save the day's exact quantity (the screen closes the sheet and saves it optimistically). */
  onSave: (habit: HabitItem, quantity: number) => void;
};

/**
 * "Ajustar el día" (SPEC-habits "Toque en cantidad"): today's quantity of a habit as a numeric
 * field with −/+ (by its step), to set the exact value or take back what was added by mistake.
 * Validates with the action's own schema; saving is optimistic (the screen's queue and notice,
 * with "Deshacer").
 */
export function AdjustDaySheet({
  open,
  onOpenChange,
  habit,
  returnFocusRef,
  onClosed,
  onSave,
}: AdjustDaySheetProps) {
  const isDesktop = useIsDesktop();
  const [text, setText] = useState(String(habit.quantity));
  const [error, setError] = useState<string | undefined>();
  const ids = useId();
  const formId = `${ids}-form`;
  const fieldId = `${ids}-quantity`;
  const labelId = `${ids}-quantity-label`;
  const [nudged, setNudged] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const unit = habit.unit ?? "";

  /** −/+: from the field's number (or the day's, if it isn't one), by the step, within 0–99 999. */
  function nudge(direction: 1 | -1) {
    const current = quantitySchema.safeParse(parseQuantity(text));
    const base = current.success ? current.data : habit.quantity;
    const next = Math.min(Math.max(base + direction * habit.step, 0), HABIT_QUANTITY_MAX);
    setText(String(next));
    setError(undefined);
    // The same text twice (− at 0) would be silent: a trailing no-break space makes it new.
    const said = MEASURE_COPY.nudged(next, unit);
    setNudged((previous) => (previous === said ? `${said} ` : said));
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = quantitySchema.safeParse(parseQuantity(text));
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      input.current?.focus();
      return;
    }
    onSave(habit, parsed.data);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      variant={isDesktop ? "side" : "bottom"}
      title={MEASURE_COPY.adjustTitle(habit.name)}
      description={MEASURE_COPY.quantityGoal(habit.target, unit)}
      returnFocusRef={returnFocusRef}
      onClosed={onClosed}
      initialFocusRef={input}
      footer={
        <>
          <Key variant="ghost" className="flex-1 lg:flex-none" onClick={() => onOpenChange(false)}>
            {MEASURE_COPY.cancel}
          </Key>
          <Key type="submit" form={formId} variant="signal" className="flex-1">
            {MEASURE_COPY.save}
          </Key>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={submit} className="bo-field">
        {/* The label above the whole row (it may wrap): the keys line up with the field. */}
        <label id={labelId} htmlFor={fieldId} className="bo-field__label">
          {MEASURE_COPY.quantityLabel(unit)}
        </label>
        <div className="flex items-start gap-2">
          <IconKey
            icon={Minus}
            label={MEASURE_COPY.decrease(habit.step)}
            className="mt-1 flex-none"
            onClick={() => nudge(-1)}
          />
          <TextField
            ref={input}
            className="min-w-0 flex-1"
            aria-labelledby={labelId}
            name="quantity"
            inputMode="numeric"
            autoComplete="off"
            enterKeyHint="done"
            value={text}
            error={error}
            id={fieldId}
            onChange={(event) => {
              setText(event.target.value);
              if (error) setError(undefined);
            }}
            // Like a spin button: the arrows nudge by the step.
            onKeyDown={(event) => {
              if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
              // ⌘/⌥/Ctrl/Shift + arrows keep their text-editing meaning.
              if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
              event.preventDefault();
              nudge(event.key === "ArrowUp" ? 1 : -1);
            }}
          />
          <IconKey
            icon={Plus}
            label={MEASURE_COPY.increase(habit.step)}
            className="mt-1 flex-none"
            onClick={() => nudge(1)}
          />
        </div>
        {/* −/+ keep focus on themselves: the new value is said here (WCAG 4.1.3). */}
        <p role="status" className="sr-only">
          {nudged}
        </p>
      </form>
    </Sheet>
  );
}
