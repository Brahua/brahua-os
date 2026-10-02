"use client";

import { TriangleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Icon, Key, Sheet, TextField } from "@/design-system";
import { fail, type ActionResult, type FieldErrors } from "@/lib/action-result";
import { useIsDesktop } from "@/lib/use-is-desktop";
import { HABIT_PAUSE_REASON_MAX_LENGTH } from "../habit-constants";
import type { HabitItem, HabitPauseSummary } from "../habit-input";
import { pauseHabit } from "../pause-actions";
import { PAUSE_COPY } from "../pause-copy";
import {
  PAUSE_FIELDS,
  pauseHabitInputSchema,
  pauseLength,
  pauseStartError,
  type PauseField,
  type PauseHabitInput,
} from "../pause-input";
import { addDays } from "../schedule";

type Errors = Partial<Record<PauseField, string>>;

function firstErrors(fieldErrors: FieldErrors | undefined): Errors {
  const errors: Errors = {};
  for (const field of PAUSE_FIELDS) {
    const message = fieldErrors?.[field]?.[0];
    if (message) errors[field] = message;
  }
  return errors;
}

/** A pause starts today and lasts a week, unless changed. */
const DEFAULT_DAYS = 7;

export type PauseSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  habit: HabitItem;
  /** Lima's today (the screen's): the default start and the start's window. */
  today: string;
  /** False when the page is out of date (Lima's day changed): it reloads instead of saving. */
  canSave?: () => boolean;
  /** Where focus goes if the sheet closes without pausing (the options key). */
  returnFocusRef: React.RefObject<HTMLElement | null>;
  /** Paused: the screen closes the sheet, says so and offers "Deshacer" (removes `pause`). */
  onPaused: (habit: HabitItem, pause: HabitPauseSummary, input: PauseHabitInput) => void;
  onClosed?: () => void;
};

/**
 * "Pausar" (SPEC-habits "Pausas"): the first and last day (both included, up to 90 days; from 7
 * days back to a year ahead) and an optional reason ("Viaje"). Validates with the action's own
 * schema first; the server checks the window and overlaps again, under the habit's lock. Not
 * optimistic (an overlap is only known there): "Pausando…", and the sheet stays open meanwhile.
 */
export function PauseSheet({
  open,
  onOpenChange,
  habit,
  today,
  canSave,
  returnFocusRef,
  onPaused,
  onClosed,
}: PauseSheetProps) {
  const isDesktop = useIsDesktop();
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(addDays(today, DEFAULT_DAYS - 1));
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const focusFirstInvalid = useRef(false);
  const ids = useId();
  const formId = `${ids}-form`;
  const summaryId = `${ids}-summary`;
  const startInput = useRef<HTMLInputElement>(null);
  const endInput = useRef<HTMLInputElement>(null);
  const reasonInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!focusFirstInvalid.current) return;
    focusFirstInvalid.current = false;
    const first = PAUSE_FIELDS.find((field) => errors[field]);
    const input = first === "startDate" ? startInput : first === "endDate" ? endInput : reasonInput;
    if (first) input.current?.focus();
  });

  // While saving, the sheet stays open: Esc, the scrim, ✕ and Cancelar do nothing.
  function requestOpenChange(next: boolean) {
    if (!next && pending) return;
    onOpenChange(next);
  }

  function showErrors(result: { error: string; fieldErrors?: FieldErrors }) {
    const fieldErrors = firstErrors(result.fieldErrors);
    focusFirstInvalid.current = true;
    setErrors(fieldErrors);
    setFormError(Object.keys(fieldErrors).length > 0 ? null : result.error);
  }

  function clearError(field: PauseField) {
    setErrors((previous) => {
      if (!previous[field]) return previous;
      const next = { ...previous };
      delete next[field];
      return next;
    });
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const parsed = pauseHabitInputSchema.safeParse({
      id: habit.id,
      startDate,
      endDate,
      reason,
    });
    if (!parsed.success) {
      const failed = fail(parsed.error);
      if (!failed.ok) showErrors(failed);
      return;
    }
    const outOfWindow = pauseStartError(parsed.data.startDate, today, habit.startDate);
    if (outOfWindow) {
      showErrors({ error: outOfWindow, fieldErrors: { startDate: [outOfWindow] } });
      return;
    }
    if (canSave && !canSave()) return;
    setFormError(null);
    startTransition(async () => {
      let result: ActionResult<{ habit: HabitItem; pause: HabitPauseSummary }>;
      try {
        result = await pauseHabit(parsed.data);
      } catch {
        // Network failure or a new deployment: the action itself never throws.
        result = fail(PAUSE_COPY.notPaused);
      }
      if (!result.ok) {
        showErrors(result);
        return;
      }
      onPaused(result.data.habit, result.data.pause, parsed.data);
    });
  }

  const validRange = startDate !== "" && endDate !== "" && endDate >= startDate;

  return (
    <Sheet
      open={open}
      onOpenChange={requestOpenChange}
      variant={isDesktop ? "side" : "bottom"}
      title={PAUSE_COPY.sheetTitle(habit.name)}
      description={PAUSE_COPY.sheetDescription}
      returnFocusRef={returnFocusRef}
      onClosed={onClosed}
      closeDisabled={pending}
      initialFocusRef={startInput}
      footer={
        <>
          <Key
            variant="ghost"
            className="flex-1 lg:flex-none"
            aria-disabled={pending || undefined}
            onClick={() => requestOpenChange(false)}
          >
            {PAUSE_COPY.cancel}
          </Key>
          <Key
            type="submit"
            form={formId}
            variant="signal"
            className="flex-1"
            aria-disabled={pending || undefined}
            aria-describedby={validRange ? summaryId : undefined}
          >
            {pending ? PAUSE_COPY.saving : PAUSE_COPY.save}
          </Key>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={submit}
        className="flex flex-col gap-6"
        data-saving={pending ? "" : undefined}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            ref={startInput}
            id={`${ids}-start`}
            type="date"
            className="bo-date-field"
            label={PAUSE_COPY.startLabel}
            name="startDate"
            value={startDate}
            required
            error={errors.startDate}
            help={PAUSE_COPY.startHelp}
            onChange={(event) => {
              setStartDate(event.target.value);
              clearError("startDate");
            }}
          />
          <TextField
            ref={endInput}
            id={`${ids}-end`}
            type="date"
            className="bo-date-field"
            label={PAUSE_COPY.endLabel}
            name="endDate"
            value={endDate}
            min={startDate || undefined}
            required
            error={errors.endDate}
            onChange={(event) => {
              setEndDate(event.target.value);
              clearError("endDate");
            }}
          />
        </div>
        <TextField
          ref={reasonInput}
          id={`${ids}-reason`}
          label={PAUSE_COPY.reasonLabel}
          name="reason"
          value={reason}
          autoComplete="off"
          maxLength={HABIT_PAUSE_REASON_MAX_LENGTH * 2}
          error={errors.reason}
          help={PAUSE_COPY.reasonHelp}
          onChange={(event) => {
            setReason(event.target.value);
            clearError("reason");
          }}
        />
        {validRange ? (
          <p id={summaryId} className="bo-text-body-sm text-text-secondary">
            {PAUSE_COPY.summary(pauseLength(startDate, endDate))}
          </p>
        ) : null}
        {formError ? (
          <p role="alert" className="bo-field__error">
            <Icon icon={TriangleAlert} size="sm" />
            {formError}
          </p>
        ) : null}
        <p role="status" className="sr-only">
          {pending ? PAUSE_COPY.savingStatus : ""}
        </p>
      </form>
    </Sheet>
  );
}
