"use client";

import { ChevronDown, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Icon, Key, TextField } from "@/design-system";
import { cn } from "@/lib/cn";
import { formatDateKey } from "@/lib/time";
import { nextDueDate, recurrenceSummary, WEEKDAY_NAMES, WEEKDAY_SHORT } from "../recurrence";
import { RECURRENCE_COPY, RECURRENCE_MODES } from "../recurrence-copy";
import {
  ruleFromDraft,
  type IntervalUnit,
  type RecurrenceDraft,
  type RecurrenceDraftErrors,
} from "../recurrence-draft";
import { ISO_WEEKDAYS } from "../task-constants";

const UNITS: IntervalUnit[] = ["every_days", "every_weeks", "every_months"];

type RecurrenceEditorProps = {
  /** Prefix for the ids of its controls (unique per editor). */
  id: string;
  draft: RecurrenceDraft;
  onDraftChange: (draft: RecurrenceDraft) => void;
  /** Lima's day for "Si la completas hoy, la siguiente vence el …". */
  now: Date;
  /** The task's due date (YYYY-MM-DD): weekdays and a day of the month start after it. */
  dueDate?: string | null;
  /**
   * Show every field's error now (e.g. after a submit). Otherwise a typed field shows its error
   * once it is left, and the weekdays as soon as none is left.
   */
  showErrors?: boolean;
  /** Errors from the server, by field (shown as they come). */
  serverErrors?: RecurrenceDraftErrors;
  /** A typed number was left (the detail saves then). */
  onCommit?: () => void;
  /** The legend only for screen readers (the detail's section heading already says it). */
  hideLegend?: boolean;
};

/**
 * The recurrence editor (SPEC-tasks: "editor simple con resumen legible"): how it repeats as a
 * radio group (none, every N days / weeks / months, some weekdays, a day of the month), the
 * fields of that rule, and the rule in words with the date the next one would get if completed
 * today. Controlled: the capture keeps the draft until it saves; the detail saves each valid
 * change.
 */
export function RecurrenceEditor({
  id,
  draft,
  onDraftChange,
  now,
  dueDate = null,
  showErrors = false,
  serverErrors,
  onCommit,
  hideLegend = false,
}: RecurrenceEditorProps) {
  const [left, setLeft] = useState<{ interval?: boolean; monthDay?: boolean }>({});
  const parsed = ruleFromDraft(draft);
  const draftErrors = parsed.ok ? {} : parsed.errors;
  const errorOf = (field: keyof RecurrenceDraftErrors) => {
    const own =
      field === "weekdays" || showErrors || left[field as "interval" | "monthDay"]
        ? draftErrors[field]
        : undefined;
    return own ?? serverErrors?.[field];
  };
  // What screen readers hear: the summary once a change is made (a choice at once, a typed
  // number when it is left), never on every keystroke. "No se repite" says nothing here: the
  // radio already says it (and the detail announces "Ya no se repite." once saved).
  const [spoken, setSpoken] = useState("");
  const speak = (next: RecurrenceDraft) => {
    if (next.mode === "none") return;
    const text = summaryOf(next, now, dueDate);
    if (!text) return;
    // Cleared first, so the same summary twice is read twice.
    setSpoken("");
    window.setTimeout(() => setSpoken(text), 50);
  };
  const change = (patch: Partial<RecurrenceDraft>, typed = false) => {
    const next = { ...draft, ...patch };
    onDraftChange(next);
    if (!typed) speak(next);
  };
  const leave = (field: "interval" | "monthDay") => {
    setLeft((previous) => ({ ...previous, [field]: true }));
    speak(draft);
    onCommit?.();
  };

  const summaryId = `${id}-summary`;
  const intervalError = errorOf("interval");
  const weekdaysError = errorOf("weekdays");
  const monthDayError = errorOf("monthDay");

  return (
    <div className="flex flex-col gap-4" data-recurrence-editor="">
      <fieldset className="flex flex-col" aria-describedby={summaryId}>
        <legend className={hideLegend ? "sr-only" : "bo-field__label mb-1"}>
          {RECURRENCE_COPY.modeLegend}
        </legend>
        {RECURRENCE_MODES.map((mode) => (
          <label
            key={mode}
            className="bo-text-body flex min-h-11 cursor-pointer items-center gap-3"
          >
            <input
              type="radio"
              className="bo-milestone-check shrink-0"
              name={`${id}-mode`}
              value={mode}
              checked={draft.mode === mode}
              onChange={() => change({ mode })}
            />
            {RECURRENCE_COPY.modes[mode]}
          </label>
        ))}
      </fieldset>

      {draft.mode === "every" ? (
        <div className="flex flex-wrap items-start gap-3">
          <TextField
            id={`${id}-interval`}
            label={RECURRENCE_COPY.intervalLabel}
            className="w-24"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            enterKeyHint="done"
            value={draft.interval}
            error={intervalError}
            onChange={(event) => change({ interval: event.target.value.trim() }, true)}
            onBlur={() => leave("interval")}
            onKeyDown={(event) => {
              // Enter keeps the number (in the capture it would also add the task: not here).
              if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
              event.preventDefault();
              leave("interval");
            }}
          />
          <div className="bo-field min-w-32 flex-1">
            <label className="bo-field__label" htmlFor={`${id}-unit`}>
              {RECURRENCE_COPY.unitLabel}
            </label>
            <div className="bo-select">
              <select
                id={`${id}-unit`}
                className="bo-field__control"
                value={draft.unit}
                onChange={(event) => change({ unit: event.target.value as IntervalUnit })}
              >
                {UNITS.map((unit) => (
                  <option key={unit} value={unit}>
                    {RECURRENCE_COPY.units[unit]}
                  </option>
                ))}
              </select>
              <Icon icon={ChevronDown} size="sm" className="bo-select__chevron" />
            </div>
          </div>
        </div>
      ) : null}

      {draft.mode === "weekdays" ? (
        <fieldset
          className={cn("bo-field", weekdaysError && "is-error")}
          aria-describedby={weekdaysError ? `${id}-weekdays-error` : undefined}
        >
          <legend className="bo-field__label mb-2">{RECURRENCE_COPY.weekdaysLegend}</legend>
          <div className="grid grid-cols-7 gap-1">
            {ISO_WEEKDAYS.map((day) => {
              const on = draft.weekdays.includes(day);
              return (
                <Key
                  key={day}
                  toggle
                  pressed={on}
                  className="min-w-0 px-0"
                  aria-label={WEEKDAY_NAMES[day]}
                  data-weekday={day}
                  onPressedChange={(pressed) =>
                    change({
                      weekdays: pressed
                        ? [...draft.weekdays, day].sort((a, b) => a - b)
                        : draft.weekdays.filter((value) => value !== day),
                    })
                  }
                >
                  <span aria-hidden>{WEEKDAY_SHORT[day]}</span>
                </Key>
              );
            })}
          </div>
          {/* An alert: unpressing the last day says why nothing is saved. */}
          <div role="alert">
            {weekdaysError ? (
              <span id={`${id}-weekdays-error`} className="bo-field__error">
                <Icon icon={TriangleAlert} size="sm" />
                {weekdaysError}
              </span>
            ) : null}
          </div>
        </fieldset>
      ) : null}

      {draft.mode === "month_day" ? (
        <TextField
          id={`${id}-month-day`}
          label={RECURRENCE_COPY.monthDayLabel}
          className="w-32"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          enterKeyHint="done"
          value={draft.monthDay}
          help={RECURRENCE_COPY.monthDayHelp}
          error={monthDayError}
          onChange={(event) => change({ monthDay: event.target.value.trim() }, true)}
          onBlur={() => leave("monthDay")}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            leave("monthDay");
          }}
        />
      ) : null}

      {/* The rule in words (seen as it changes; heard through the status below). */}
      <p id={summaryId} className="bo-text-body-sm text-text-secondary" data-recurrence-summary="">
        {summaryOf(draft, now, dueDate)}
      </p>
      <p role="status" className="sr-only" data-recurrence-status="">
        {spoken}
      </p>
    </div>
  );
}

/** "Cada 3 días desde que la completas. Si la completas hoy, …", "No se repite.", or null. */
function summaryOf(draft: RecurrenceDraft, now: Date, dueDate: string | null): string | null {
  const parsed = ruleFromDraft(draft);
  if (!parsed.ok) return null;
  if (!parsed.rule) return RECURRENCE_COPY.summaryNone;
  return `${recurrenceSummary(parsed.rule)}. ${RECURRENCE_COPY.nextIfToday(
    formatDateKey(nextDueDate(parsed.rule, now, dueDate)),
  )}`;
}
