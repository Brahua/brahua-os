"use client";

import { TriangleAlert, X } from "lucide-react";
import { useId, useImperativeHandle, useRef, useState } from "react";
import { Icon, Key } from "@/design-system";
import { cn } from "@/lib/cn";
import { FieldError } from "@/modules/core/components/field-error";
import {
  focusRadioGrid,
  RadioGrid,
  type RadioGridOption,
} from "@/modules/core/components/radio-grid";
import { HABIT_DAYPARTS, type HabitDaypart } from "../habit-constants";
import { DAYPART_LABELS, REMINDER_COPY } from "../reminder-copy";
import { INCOMPLETE_TIME, type ReminderField } from "../reminder-input";

/** "Hora del aviso" and "Franja" as typed: `""` is none. */
export type ReminderDraft = { time: string; daypart: HabitDaypart | "" };

export type ReminderFieldsHandle = {
  /** Focuses a field (the first invalid one after a submit). */
  focus: (field: ReminderField) => void;
};

type ReminderFieldsProps = {
  ref?: React.Ref<ReminderFieldsHandle>;
  value: ReminderDraft;
  onChange: (value: ReminderDraft) => void;
  errors: Partial<Record<ReminderField, string>>;
  /** A habit to avoid takes no time: its field isn't offered (the part of the day still is). */
  offerTime: boolean;
  /** A field was changed (its error clears). */
  onEdit: (field: ReminderField) => void;
};

const NO_DAYPART = "";

/**
 * R4: the optional "Hora del aviso" (a native `type=time`, minute precision, 48 px, with "Quitar
 * hora") and "Franja" (Mañana / Tarde / Noche / Sin franja) of the create and edit form. Its own
 * field and not tasks' `TimeField` (a module never imports another's components), with the same
 * markup and classes.
 *
 * A half-edited time (one segment emptied) makes the input say `value === ""` with
 * `validity.badInput`: that is NOT "no time". Decision (R4 review): it is reported as an
 * incomplete time (`INCOMPLETE_TIME`), so saving is blocked with the field's error instead of
 * silently keeping the previous time, and "Quitar hora" stays operative meanwhile. The input
 * keeps a draft of its own so React never rewrites what the person is in the middle of typing.
 * "Quitar hora" is always rendered (aria-disabled only while there is nothing to remove): a key
 * never unmounts under focus.
 */
export function ReminderFields({
  ref,
  value,
  onChange,
  errors,
  offerTime,
  onEdit,
}: ReminderFieldsProps) {
  const ids = useId();
  const timeId = `${ids}-time`;
  const daypartLabelId = `${ids}-daypart-label`;
  const daypartHelpId = `${ids}-daypart-help`;
  const daypartErrorId = `${ids}-daypart-error`;
  const timeInput = useRef<HTMLInputElement>(null);
  const daypartGroup = useRef<HTMLDivElement>(null);
  // The form mounts this fresh for every opening, so the draft starts from the value and only
  // this component changes it afterwards.
  const [draft, setDraft] = useState(value.time);
  // The input holds a half-edited time (its `value` reads "" but it is not empty).
  const [incomplete, setIncomplete] = useState(false);

  useImperativeHandle(ref, () => ({
    focus(field) {
      if (field === "reminderTime") timeInput.current?.focus();
      else focusRadioGrid(daypartGroup.current);
    },
  }));

  const timeDescribedBy = errors.reminderTime ? `${timeId}-error` : `${timeId}-help`;
  const options: RadioGridOption<string>[] = [
    ...HABIT_DAYPARTS.map((daypart) => ({
      value: daypart as string,
      label: DAYPART_LABELS[daypart],
      children: <span className="bo-option-key__label">{DAYPART_LABELS[daypart]}</span>,
    })),
    {
      value: NO_DAYPART,
      label: REMINDER_COPY.noDaypart,
      children: <span className="bo-option-key__label">{REMINDER_COPY.noDaypart}</span>,
    },
  ];

  return (
    <>
      {offerTime ? (
        <div
          className={cn("bo-field bo-date-field", errors.reminderTime && "is-error")}
          data-habit-reminder-time=""
        >
          <label className="bo-field__label" htmlFor={timeId}>
            {REMINDER_COPY.timeLabel}
          </label>
          <div className="bo-time-field__row">
            <div className="relative">
              <input
                ref={timeInput}
                id={timeId}
                name="reminderTime"
                type="time"
                step={60}
                className="bo-field__control font-mono tabular-nums"
                value={draft}
                aria-invalid={Boolean(errors.reminderTime)}
                aria-describedby={timeDescribedBy}
                onChange={(event) => {
                  const next = event.target.value;
                  const half = next === "" && event.target.validity.badInput;
                  setDraft(next);
                  setIncomplete(half);
                  onChange({ ...value, time: half ? INCOMPLETE_TIME : next });
                  onEdit("reminderTime");
                }}
              />
              {draft === "" ? (
                <span className="bo-date-empty" aria-hidden>
                  {REMINDER_COPY.noTime}
                </span>
              ) : null}
            </div>
            <Key
              variant="ghost"
              icon={X}
              aria-disabled={(draft === "" && !incomplete) || undefined}
              data-reminder-time-clear=""
              onClick={() => {
                if (draft === "" && !incomplete) return;
                // React won't touch an input whose value stays "": empty a half-edited one by hand.
                if (timeInput.current) timeInput.current.value = "";
                setDraft("");
                setIncomplete(false);
                onChange({ ...value, time: "" });
                onEdit("reminderTime");
                timeInput.current?.focus();
              }}
            >
              {REMINDER_COPY.clearTime}
            </Key>
          </div>
          {errors.reminderTime ? (
            <span id={`${timeId}-error`} className="bo-field__error">
              <Icon icon={TriangleAlert} size="sm" />
              {errors.reminderTime}
            </span>
          ) : (
            <span id={`${timeId}-help`} className="bo-field__help">
              {REMINDER_COPY.timeHelp}
            </span>
          )}
        </div>
      ) : null}

      <div className={cn("bo-field", errors.daypart && "is-error")} data-habit-daypart="">
        <span id={daypartLabelId} className="bo-field__label">
          {REMINDER_COPY.daypartLabel}
        </span>
        <RadioGrid
          ref={daypartGroup}
          options={options}
          value={value.daypart}
          onValueChange={(next) => {
            onChange({ ...value, daypart: next as HabitDaypart | "" });
            onEdit("daypart");
          }}
          labelledBy={daypartLabelId}
          describedBy={errors.daypart ? `${daypartHelpId} ${daypartErrorId}` : daypartHelpId}
          errorId={errors.daypart ? daypartErrorId : undefined}
          invalid={Boolean(errors.daypart)}
          className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2"
          itemClassName="bo-option-key min-w-0"
        />
        <span id={daypartHelpId} className="bo-field__help">
          {REMINDER_COPY.daypartHelp}
        </span>
        {errors.daypart ? <FieldError id={daypartErrorId} message={errors.daypart} /> : null}
      </div>
    </>
  );
}

/** The reminder block of a new habit (empty) or of the habit edited. */
export function reminderDraftOf(
  habit: { reminderTime?: string | null; daypart?: HabitDaypart | null } | null,
): ReminderDraft {
  return { time: habit?.reminderTime ?? "", daypart: habit?.daypart ?? "" };
}

/**
 * What the form sends. Editing: only what changed ("" clears). Creating: what was filled in. A
 * habit to avoid sends no time (its field is hidden); when an edit turns out to be one, the
 * server refuses a time anyway.
 */
export function reminderValues(
  draft: ReminderDraft,
  habit: { reminderTime?: string | null; daypart?: HabitDaypart | null } | null,
  offerTime: boolean,
) {
  if (habit) {
    return {
      reminderTime: offerTime && draft.time !== (habit.reminderTime ?? "") ? draft.time : undefined,
      daypart: draft.daypart !== (habit.daypart ?? "") ? draft.daypart : undefined,
    };
  }
  return {
    reminderTime: offerTime ? draft.time || undefined : undefined,
    daypart: draft.daypart || undefined,
  };
}
