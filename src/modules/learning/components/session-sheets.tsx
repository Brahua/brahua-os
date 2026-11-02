"use client";

import { ChevronDown } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Icon, Key, Sheet, TextField } from "@/design-system";
import type { ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/cn";
import { useIsDesktop } from "@/lib/use-is-desktop";
import { FieldError } from "@/modules/core/components/field-error";
import { SESSION_MAX_MINUTES } from "../learning-constants";
import { manualDays } from "../pace";
import { logSession } from "../sessions-actions";
import { SESSION_ERRORS, SESSIONS_COPY as COPY } from "../sessions-copy";
import {
  logSessionInputSchema,
  parseMinutesField,
  sessionMinutesSchema,
  type SessionItem,
} from "../sessions-input";
import { relativeDay } from "../sessions-view";
import { useLearningSave } from "./use-learning-save";

type SheetBase = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The key that opened it: focus comes back here. */
  returnFocusRef: React.RefObject<HTMLElement | null>;
  /** After the sheet fully closed (announce here: the page is no longer aria-hidden). */
  onClosed?: () => void;
};

/** The first message of a refused result on one of `fields`, else its general message. */
function fieldMessage(
  result: { error: string; fieldErrors?: Record<string, string[]> },
  fields: string[],
) {
  for (const field of fields) {
    const message = result.fieldErrors?.[field]?.[0];
    if (message) return message;
  }
  return result.error;
}

/**
 * «¿Cuánto estudiaste?» (SPEC-learning "Cronómetro"): a timer that ran more than 4 h saves only the
 * minutes the owner confirms or corrects here (pre-filled with what it ran, up to 600). Cancelling
 * leaves it running. Mount it with a new `key` on each opening (its field starts from props).
 */
export function ConfirmMinutesSheet({
  open,
  onOpenChange,
  returnFocusRef,
  onClosed,
  trackTitle,
  ranMinutes,
  onConfirm,
}: SheetBase & {
  trackTitle: string;
  /** What the timer ran, in whole minutes (the most it may save, capped at 600). */
  ranMinutes: number;
  /** Saves the minutes; a refusal keeps the sheet open with its reason on the field. */
  onConfirm: (minutes: number) => Promise<ActionResult<unknown>>;
}) {
  const isDesktop = useIsDesktop();
  const ids = useId();
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(
    String(Math.min(Math.max(ranMinutes, 1), SESSION_MAX_MINUTES)),
  );
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const parsed = sessionMinutesSchema.safeParse(parseMinutesField(value));
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? SESSION_ERRORS.minutes);
      input.current?.focus();
      return;
    }
    setSaving(true);
    const result = await onConfirm(parsed.data);
    setSaving(false);
    if (!result.ok) {
      setError(fieldMessage(result, ["minutes", "stopMinutes"]));
      input.current?.focus();
      return;
    }
    onOpenChange(false);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!saving) onOpenChange(next);
      }}
      variant={isDesktop ? "side" : "bottom"}
      title={COPY.confirmTitle}
      description={COPY.confirmText(trackTitle, ranMinutes)}
      returnFocusRef={returnFocusRef}
      initialFocusRef={input}
      closeDisabled={saving}
      onClosed={onClosed}
      footer={
        <>
          <Key
            variant="ghost"
            className="flex-1 lg:flex-none"
            aria-disabled={saving || undefined}
            onClick={() => {
              if (!saving) onOpenChange(false);
            }}
          >
            {COPY.cancel}
          </Key>
          <Key
            type="submit"
            form={`${ids}-form`}
            variant="signal"
            className="flex-1"
            aria-disabled={saving || undefined}
            data-session-confirm=""
          >
            {COPY.confirmSave}
          </Key>
        </>
      }
    >
      <form
        id={`${ids}-form`}
        noValidate
        onSubmit={submit}
        className="flex flex-col gap-5"
        data-saving={saving || undefined}
      >
        <TextField
          ref={input}
          id={`${ids}-minutes`}
          label={COPY.minutesLabel}
          help={COPY.minutesHelp}
          inputMode="numeric"
          autoComplete="off"
          value={value}
          error={error}
          onChange={(event) => {
            setValue(event.target.value);
            setError(undefined);
          }}
        />
      </form>
    </Sheet>
  );
}

/**
 * «Anotar tiempo» (SPEC-learning "Sesión manual"): minutes (1–600) and the day, today by default
 * and up to 30 days back. Stays open with the reason on its field when the save is refused. Mount
 * it with a new `key` on each opening.
 */
export function LogSessionSheet({
  open,
  onOpenChange,
  returnFocusRef,
  onClosed,
  track,
  today,
  onSaved,
}: SheetBase & {
  track: { id: string; title: string };
  /** Lima's today (YYYY-MM-DD). */
  today: string;
  onSaved: (session: SessionItem, day: string) => void;
}) {
  const isDesktop = useIsDesktop();
  const { send } = useLearningSave();
  const ids = useId();
  const minutesInput = useRef<HTMLInputElement>(null);
  const [minutes, setMinutes] = useState("");
  const [day, setDay] = useState(today);
  const [errors, setErrors] = useState<{ minutes?: string; day?: string }>({});
  const [saving, setSaving] = useState(false);

  function showErrors(next: { minutes?: string; day?: string }) {
    setErrors(next);
    const first = next.minutes ? "minutes" : next.day ? "day" : null;
    if (first) document.getElementById(`${ids}-${first}`)?.focus();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const data = { trackId: track.id, minutes: parseMinutesField(minutes), day };
    const parsed = logSessionInputSchema.safeParse(data);
    if (!parsed.success) {
      const next: { minutes?: string; day?: string } = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === "minutes" || field === "day") next[field] ??= issue.message;
      }
      showErrors(next.minutes || next.day ? next : { minutes: SESSION_ERRORS.minutes });
      return;
    }
    setErrors({});
    setSaving(true);
    const result = await send(() => logSession(parsed.data));
    setSaving(false);
    if (!result.ok) {
      const day = result.fieldErrors?.day?.[0];
      showErrors(day ? { day } : { minutes: fieldMessage(result, ["minutes"]) });
      return;
    }
    onSaved(result.data, parsed.data.day);
    onOpenChange(false);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!saving) onOpenChange(next);
      }}
      variant={isDesktop ? "side" : "bottom"}
      title={COPY.logTitle}
      description={COPY.logDescription(track.title)}
      returnFocusRef={returnFocusRef}
      initialFocusRef={minutesInput}
      closeDisabled={saving}
      onClosed={onClosed}
      footer={
        <>
          <Key
            variant="ghost"
            className="flex-1 lg:flex-none"
            aria-disabled={saving || undefined}
            onClick={() => {
              if (!saving) onOpenChange(false);
            }}
          >
            {COPY.cancel}
          </Key>
          <Key
            type="submit"
            form={`${ids}-form`}
            variant="signal"
            className="flex-1"
            aria-disabled={saving || undefined}
            data-session-log-submit=""
          >
            {COPY.save}
          </Key>
        </>
      }
    >
      <form
        id={`${ids}-form`}
        noValidate
        onSubmit={submit}
        className="flex flex-col gap-5"
        data-saving={saving || undefined}
      >
        <TextField
          ref={minutesInput}
          id={`${ids}-minutes`}
          label={COPY.minutesLabel}
          help={COPY.minutesHelp}
          inputMode="numeric"
          autoComplete="off"
          value={minutes}
          error={errors.minutes}
          onChange={(event) => {
            setMinutes(event.target.value);
            setErrors((current) => ({ ...current, minutes: undefined }));
          }}
        />
        <div className={cn("bo-field", errors.day && "is-error")}>
          <label className="bo-field__label" htmlFor={`${ids}-day`}>
            {COPY.dayLabel}
          </label>
          <div className="bo-select">
            <select
              id={`${ids}-day`}
              className="bo-field__control"
              value={day}
              aria-invalid={Boolean(errors.day)}
              aria-describedby={errors.day ? `${ids}-day-error` : undefined}
              onChange={(event) => {
                setDay(event.target.value);
                setErrors((current) => ({ ...current, day: undefined }));
              }}
            >
              {manualDays(today).map((option) => (
                <option key={option} value={option}>
                  {relativeDay(option, today)}
                </option>
              ))}
            </select>
            <Icon icon={ChevronDown} size="sm" className="bo-select__chevron" />
          </div>
          {errors.day ? <FieldError id={`${ids}-day-error`} message={errors.day} /> : null}
        </div>
      </form>
    </Sheet>
  );
}
