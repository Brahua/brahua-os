"use client";

import { Minus, Plus } from "lucide-react";
import { useId, useRef, useState } from "react";
import { IconKey, Key, Sheet, Switch, TextField } from "@/design-system";
import { useIsDesktop } from "@/lib/use-is-desktop";
import { RadioGrid, type RadioGridOption } from "@/modules/core/components/radio-grid";
import { HABIT_QUANTITY_MAX } from "../habit-constants";
import type { HabitItem } from "../habit-input";
import { MEASURE_COPY } from "../measure-copy";
import { formatDayName, formatWeekdayDay, PAUSE_COPY } from "../pause-copy";
import { HISTORY_COPY } from "../history-copy";
import { quantitySchema } from "../quantity-input";
import { addDays } from "../schedule";

/** The field's text as a number for the schema: blank is "missing", anything else as typed. */
function parseQuantity(text: string): number | undefined {
  const trimmed = text.trim();
  return trimmed === "" ? undefined : Number(trimmed);
}

/** H4: a day "Registrar otro día" offers, with what it has logged and whether it was paused. */
export type OtherDay = { day: string; quantity: number; target: number; paused: boolean };

export type AdjustDaySheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The habit, as it is today. */
  habit: HabitItem;
  /**
   * H4 ("Registrar otro día"): the earlier days that can be logged, newest first (yesterday
   * first). Without it, the sheet is H3's "Ajustar el día" for today (quantity habits only).
   */
  days?: readonly OtherDay[];
  /**
   * H5: the day picked first (a calendar day of the habit's page); the first of `days` without
   * it. `days` may then include today too.
   */
  initialDay?: string;
  /** Lima's today (the screen's): "Hoy" and "Ayer" among the days. */
  today: string;
  /** Where focus goes when the sheet closes (the pad's options key). */
  returnFocusRef: React.RefObject<HTMLElement | null>;
  onClosed?: () => void;
  /**
   * Save a day's exact quantity (the screen closes the sheet and saves it). `day` is null for
   * today ("Ajustar el día"); for a yes/no or a habit to avoid the quantity is 1 or 0.
   */
  onSave: (habit: HabitItem, quantity: number, day: OtherDay | null) => void;
};

/**
 * "Ajustar el día" (SPEC-habits "Toque en cantidad"): today's quantity of a habit as a numeric
 * field with −/+ (by its step), to set the exact value or take back what was added by mistake.
 * H4, with `days`, it is "Registrar otro día": first the day (one of the 7 before today, never
 * before the start date), then the same field for a quantity, or a switch for a yes/no ("Hecho
 * ese día") and a habit to avoid ("Recaída ese día"). Validates with the action's own schema.
 */
export function AdjustDaySheet({
  open,
  onOpenChange,
  habit,
  days,
  initialDay,
  today,
  returnFocusRef,
  onClosed,
  onSave,
}: AdjustDaySheetProps) {
  const isDesktop = useIsDesktop();
  const other = days !== undefined;
  const [picked, setPicked] = useState<OtherDay | null>(
    days?.find((option) => option.day === initialDay) ?? days?.[0] ?? null,
  );
  // H5: the habit's page offers today too ("Hoy" first).
  const withToday = days?.some((option) => option.day === today) ?? false;
  const shown = picked ?? { quantity: habit.quantity, target: habit.target };
  const [text, setText] = useState(String(shown.quantity));
  const [error, setError] = useState<string | undefined>();
  const ids = useId();
  const formId = `${ids}-form`;
  const fieldId = `${ids}-quantity`;
  const labelId = `${ids}-quantity-label`;
  const dayLabelId = `${ids}-day-label`;
  const pausedNoteId = `${ids}-paused-note`;
  const [nudged, setNudged] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const unit = habit.unit ?? "";
  const quantity = habit.kind === "build" && habit.measure === "quantity";

  /** −/+: from the field's number (or the day's, if it isn't one), by the step, within 0–99 999. */
  function nudge(direction: 1 | -1) {
    const current = quantitySchema.safeParse(parseQuantity(text));
    const base = current.success ? current.data : shown.quantity;
    const next = Math.min(Math.max(base + direction * habit.step, 0), HABIT_QUANTITY_MAX);
    setText(String(next));
    setError(undefined);
    // The same text twice (− at 0) would be silent: a trailing no-break space makes it new.
    const said = MEASURE_COPY.nudged(next, unit);
    setNudged((previous) => (previous === said ? `${said} ` : said));
  }

  function pickDay(day: string) {
    const next = days?.find((option) => option.day === day) ?? null;
    if (!next) return;
    setPicked(next);
    // The field shows the day picked (what it has, to correct it).
    setText(String(next.quantity));
    setError(undefined);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // "Registrar otro día" always has a day picked (never today by mistake).
    if (other && !picked) return;
    const parsed = quantitySchema.safeParse(parseQuantity(text));
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      input.current?.focus();
      return;
    }
    onSave(habit, parsed.data, picked);
  }

  // Each key's name starts with what it shows (WCAG 2.5.3): "Ayer, jueves 1 de octubre",
  // "martes 29, …"; a paused day says so in words too (not only a mark).
  const yesterday = addDays(today, -1);
  const dayOptions: RadioGridOption<string>[] = (days ?? []).map((option) => {
    const shown =
      option.day === today
        ? HISTORY_COPY.todayKey
        : option.day === yesterday
          ? PAUSE_COPY.yesterday
          : formatWeekdayDay(option.day);
    return {
      value: option.day,
      label: PAUSE_COPY.dayName(shown, formatDayName(option.day), option.paused),
      children: (
        <span className="bo-option-key__label">
          {shown}
          {option.paused ? (
            <span className="block text-text-secondary">{PAUSE_COPY.pausedDayMark}</span>
          ) : null}
        </span>
      ),
    };
  });

  const marked = Number(text) > 0;
  const quantityField = (
    <div className="bo-field">
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
          // H4: another day says its own goal (an error replaces it while shown).
          help={other ? MEASURE_COPY.quantityGoal(shown.target, unit) : undefined}
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
    </div>
  );

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      variant={isDesktop ? "side" : "bottom"}
      title={other ? PAUSE_COPY.otherDayTitle(habit.name) : MEASURE_COPY.adjustTitle(habit.name)}
      description={
        other
          ? withToday
            ? HISTORY_COPY.dayDescription
            : PAUSE_COPY.otherDayDescription
          : MEASURE_COPY.quantityGoal(habit.target, unit)
      }
      returnFocusRef={returnFocusRef}
      onClosed={onClosed}
      // "Registrar otro día" starts with the title (the day comes first, and on the phone a
      // focused field would open the keyboard); "Ajustar el día" with the field.
      initialFocusRef={other ? undefined : input}
      focusTitleOnOpen={other}
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
      <form id={formId} noValidate onSubmit={submit} className="flex flex-col gap-6">
        {other ? (
          <div className="bo-field">
            <span id={dayLabelId} className="bo-field__label">
              {PAUSE_COPY.dayLabel}
            </span>
            <RadioGrid
              options={dayOptions}
              value={picked?.day ?? null}
              onValueChange={pickDay}
              labelledBy={dayLabelId}
              describedBy={picked?.paused ? pausedNoteId : undefined}
              className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-2"
              itemClassName="bo-option-key min-w-0"
            />
            {picked?.paused ? (
              <span id={pausedNoteId} className="bo-field__help" data-paused-day-note="">
                {PAUSE_COPY.pausedDayNote}
              </span>
            ) : null}
          </div>
        ) : null}
        {quantity ? (
          quantityField
        ) : (
          <div className="flex items-center justify-between gap-4">
            <span id={labelId} className="bo-text-body">
              {habit.kind === "avoid" ? PAUSE_COPY.slipLabel : PAUSE_COPY.doneLabel}
            </span>
            <Switch
              aria-labelledby={labelId}
              checked={marked}
              onCheckedChange={(checked) => setText(checked ? "1" : "0")}
            />
          </div>
        )}
      </form>
    </Sheet>
  );
}
