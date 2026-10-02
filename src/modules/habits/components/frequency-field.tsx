"use client";

import { Key, SegmentedControl, type SegmentOption } from "@/design-system";
import { cn } from "@/lib/cn";
import { FieldError } from "@/modules/core/components/field-error";
import {
  HABIT_FREQUENCIES,
  HABIT_WEEKLY_TARGET_MAX,
  type HabitFrequency,
} from "../habit-constants";
import type { HabitItem } from "../habit-input";
import { FREQUENCY_COPY, ISO_WEEKDAYS, WEEKDAY_NAMES, WEEKDAY_SHORT } from "../frequency-copy";

/** The form's draft of the frequency: every field kept while switching, only one sent. */
export type FrequencyDraft = {
  frequency: HabitFrequency;
  weeklyTarget: number;
  weekdays: number[];
};

/** X when "Por semana" is first picked. */
const DEFAULT_WEEKLY_TARGET = 3;

/** A new habit's draft (daily), or an edited habit's. */
export function frequencyDraftOf(habit?: HabitItem | null): FrequencyDraft {
  return {
    frequency: habit?.frequency ?? "daily",
    weeklyTarget: habit?.weeklyTarget ?? DEFAULT_WEEKLY_TARGET,
    weekdays: habit?.weekdays ?? [],
  };
}

/** What the form sends: the frequency with exactly its own field (the others null). */
export function frequencyValues(draft: FrequencyDraft) {
  return {
    frequency: draft.frequency,
    weeklyTarget: draft.frequency === "weekly_count" ? draft.weeklyTarget : null,
    weekdays: draft.frequency === "weekdays" ? draft.weekdays : null,
  };
}

export type FrequencyErrors = { frequency?: string; weeklyTarget?: string; weekdays?: string };

/** Focuses a field of the frequency (after a failed submit) inside `container`. */
export function focusFrequencyField(
  container: HTMLElement | null,
  field: keyof FrequencyErrors,
): void {
  const selector =
    field === "weekdays"
      ? "[data-weekday]"
      : field === "weeklyTarget"
        ? "[data-weekly-target] [aria-checked='true']"
        : "[data-frequency] [aria-checked='true']";
  container?.querySelector<HTMLElement>(selector)?.focus();
}

const FREQUENCY_OPTIONS: SegmentOption<HabitFrequency>[] = HABIT_FREQUENCIES.map((value) => ({
  value,
  label: FREQUENCY_COPY.options[value],
}));

const TIMES_OPTIONS: SegmentOption<string>[] = Array.from(
  { length: HABIT_WEEKLY_TARGET_MAX },
  (_, index) => ({ value: String(index + 1), label: String(index + 1) }),
);

type FrequencyFieldProps = {
  /** Prefix for the ids of its controls (unique per form). */
  id: string;
  draft: FrequencyDraft;
  onDraftChange: (draft: FrequencyDraft) => void;
  errors: FrequencyErrors;
  ref?: React.Ref<HTMLDivElement>;
};

/**
 * "Frecuencia" (SPEC-habits "Crear y editar"): Diaria · Por semana · Días fijos as a radio group,
 * then X (1–6) as radio keys or the days of the week as toggle keys. Controlled by the form.
 */
export function FrequencyField({ id, draft, onDraftChange, errors, ref }: FrequencyFieldProps) {
  const change = (patch: Partial<FrequencyDraft>) => onDraftChange({ ...draft, ...patch });
  const labelId = `${id}-label`;
  const timesLabelId = `${id}-times-label`;
  const timesHelpId = `${id}-times-help`;
  const timesErrorId = `${id}-times-error`;
  const daysHelpId = `${id}-days-help`;
  const daysErrorId = `${id}-days-error`;

  return (
    <div ref={ref} className="flex flex-col gap-4">
      <div className={cn("bo-field", errors.frequency && "is-error")}>
        <span id={labelId} className="bo-field__label">
          {FREQUENCY_COPY.label}
        </span>
        <SegmentedControl
          mode="radio"
          touch
          options={FREQUENCY_OPTIONS}
          value={draft.frequency}
          onValueChange={(frequency) => change({ frequency })}
          label={FREQUENCY_COPY.label}
          aria-labelledby={labelId}
          data-frequency=""
        />
        {errors.frequency ? <FieldError id={`${id}-error`} message={errors.frequency} /> : null}
      </div>

      {draft.frequency === "weekly_count" ? (
        <div className={cn("bo-field", errors.weeklyTarget && "is-error")}>
          <span id={timesLabelId} className="bo-field__label">
            {FREQUENCY_COPY.weeklyTargetLabel}
          </span>
          <SegmentedControl
            mode="radio"
            touch
            options={TIMES_OPTIONS}
            value={String(draft.weeklyTarget)}
            onValueChange={(value) => change({ weeklyTarget: Number(value) })}
            label={FREQUENCY_COPY.weeklyTargetLabel}
            aria-labelledby={timesLabelId}
            aria-describedby={errors.weeklyTarget ? `${timesHelpId} ${timesErrorId}` : timesHelpId}
            data-weekly-target=""
          />
          <span id={timesHelpId} className="bo-field__help">
            {FREQUENCY_COPY.weeklyTargetHelp}
          </span>
          {errors.weeklyTarget ? (
            <FieldError id={timesErrorId} message={errors.weeklyTarget} />
          ) : null}
        </div>
      ) : null}

      {draft.frequency === "weekdays" ? (
        <fieldset
          className={cn("bo-field", errors.weekdays && "is-error")}
          aria-describedby={errors.weekdays ? `${daysHelpId} ${daysErrorId}` : daysHelpId}
        >
          <legend className="bo-field__label mb-2">{FREQUENCY_COPY.weekdaysLabel}</legend>
          <div className="grid grid-cols-7 gap-1">
            {ISO_WEEKDAYS.map((day) => (
              <Key
                key={day}
                toggle
                pressed={draft.weekdays.includes(day)}
                className="min-w-0 px-0"
                aria-label={WEEKDAY_NAMES[day]}
                data-weekday={day}
                onPressedChange={(pressed) =>
                  change({
                    weekdays: pressed
                      ? [...new Set([...draft.weekdays, day])].sort((a, b) => a - b)
                      : draft.weekdays.filter((value) => value !== day),
                  })
                }
              >
                <span aria-hidden>{WEEKDAY_SHORT[day]}</span>
              </Key>
            ))}
          </div>
          <span id={daysHelpId} className="bo-field__help">
            {FREQUENCY_COPY.weekdaysHelp}
          </span>
          {errors.weekdays ? <FieldError id={daysErrorId} message={errors.weekdays} /> : null}
        </fieldset>
      ) : null}
    </div>
  );
}
