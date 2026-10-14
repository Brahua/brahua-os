"use client";

import { ChevronDown } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Icon, Key, Sheet, TextField } from "@/design-system";
import { cn } from "@/lib/cn";
import { useIsDesktop } from "@/lib/use-is-desktop";
import { FREQUENCIES, SUGGESTED_ZONES, type Frequency } from "../cleaning";
import { CLEANING_COPY as COPY } from "../cleaning-copy";
import { ADD_CLEANING_FIELDS, addCleaningInputSchema } from "../cleaning-input";
import type { CleaningItem } from "../cleaning-view";
import { addCleaning } from "../actions";

type AddCleaningSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The key that opened it: focus comes back here. */
  returnFocusRef: React.RefObject<HTMLElement | null>;
  /** Runs the save in the screen's queue; null if it could not be queued. */
  onAdded: (item: CleaningItem) => void;
  onClosed?: () => void;
  /** Saves through the screen's queue and answers with the action's result. */
  save: (input: unknown) => ReturnType<typeof addCleaning>;
};

type Errors = Partial<Record<(typeof ADD_CLEANING_FIELDS)[number], string>>;

/**
 * «Añadir limpieza» (SPEC-household "Pantallas"): a title, a zone (the owner's suggestions, or a
 * new one), how often, the days when it is weekly and, optionally, the first day. The same sheet
 * the lists use (bottom on the phone, side panel on the desktop). It stays open with the error
 * on its field when the save is refused, and closes when it is saved.
 */
export function AddCleaningSheet({
  open,
  onOpenChange,
  returnFocusRef,
  onAdded,
  onClosed,
  save,
}: AddCleaningSheetProps) {
  const isDesktop = useIsDesktop();
  const ids = useId();
  const formId = `${ids}-form`;
  const titleInput = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [zone, setZone] = useState("");
  const [frequency, setFrequency] = useState<Frequency>("weekly");
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [firstDate, setFirstDate] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);

  function focusField(field: keyof Errors) {
    const element = document.getElementById(`${ids}-${field}`);
    element?.focus();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const input = { title, zone, frequency, weekdays, firstDate };
    const parsed = addCleaningInputSchema.safeParse(input);
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as keyof Errors;
        next[field] ??= issue.message;
      }
      setErrors(next);
      const first = ADD_CLEANING_FIELDS.find((field) => next[field]);
      if (first) focusField(first);
      return;
    }
    setErrors({});
    setSaving(true);
    const result = await save(input);
    setSaving(false);
    if (!result.ok) {
      const next: Errors = {};
      for (const [field, messages] of Object.entries(result.fieldErrors ?? {})) {
        next[field as keyof Errors] = messages[0];
      }
      if (Object.keys(next).length === 0) next.title = result.error;
      setErrors(next);
      const first = ADD_CLEANING_FIELDS.find((field) => next[field]);
      if (first) focusField(first);
      return;
    }
    setTitle("");
    setZone("");
    setWeekdays([]);
    setFirstDate("");
    onAdded(result.data);
    onOpenChange(false);
  }

  const weekdaysError = errors.weekdays;
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (saving) return;
        onOpenChange(next);
      }}
      variant={isDesktop ? "side" : "bottom"}
      title={COPY.sheetTitle}
      returnFocusRef={returnFocusRef}
      initialFocusRef={isDesktop ? titleInput : undefined}
      focusTitleOnOpen={!isDesktop}
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
            form={formId}
            variant="signal"
            className="flex-1"
            aria-disabled={saving || undefined}
          >
            {COPY.submit}
          </Key>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={submit} className="flex flex-col gap-5">
        <TextField
          ref={titleInput}
          id={`${ids}-title`}
          label={COPY.titleLabel}
          placeholder={COPY.titlePlaceholder}
          autoComplete="off"
          value={title}
          error={errors.title}
          onChange={(event) => {
            setTitle(event.target.value);
            setErrors((current) => ({ ...current, title: undefined }));
          }}
        />
        <div>
          <TextField
            id={`${ids}-zone`}
            label={COPY.zoneLabel}
            help={COPY.zoneHelp}
            list={`${ids}-zones`}
            autoComplete="off"
            value={zone}
            error={errors.zone}
            onChange={(event) => {
              setZone(event.target.value);
              setErrors((current) => ({ ...current, zone: undefined }));
            }}
          />
          <datalist id={`${ids}-zones`}>
            {SUGGESTED_ZONES.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </div>
        <div className={cn("bo-field", errors.frequency && "is-error")}>
          <label className="bo-field__label" htmlFor={`${ids}-frequency`}>
            {COPY.frequencyLabel}
          </label>
          <div className="bo-select">
            <select
              id={`${ids}-frequency`}
              className="bo-field__control"
              value={frequency}
              onChange={(event) => {
                setFrequency(event.target.value as Frequency);
                setErrors((current) => ({ ...current, frequency: undefined, weekdays: undefined }));
              }}
            >
              {FREQUENCIES.map((value) => (
                <option key={value} value={value}>
                  {COPY.frequencies[value]}
                </option>
              ))}
            </select>
            <Icon icon={ChevronDown} size="sm" className="bo-select__chevron" />
          </div>
        </div>
        {frequency === "weekly" ? (
          <fieldset
            id={`${ids}-weekdays`}
            tabIndex={-1}
            className={cn("bo-field outline-none", weekdaysError && "is-error")}
          >
            <legend className="bo-field__label mb-2">{COPY.weekdaysLegend}</legend>
            <div className="grid grid-cols-7 gap-1">
              {COPY.weekdayShort.map((short, index) => {
                const day = index + 1;
                const on = weekdays.includes(day);
                return (
                  <Key
                    key={day}
                    toggle
                    pressed={on}
                    className="min-w-0 px-0"
                    aria-label={WEEKDAY_FULL[index]}
                    data-weekday={day}
                    onPressedChange={(pressed) => {
                      setWeekdays((current) =>
                        pressed
                          ? [...current, day].sort((a, b) => a - b)
                          : current.filter((value) => value !== day),
                      );
                      setErrors((current) => ({
                        ...current,
                        weekdays: undefined,
                        firstDate: undefined,
                      }));
                    }}
                  >
                    <span aria-hidden>{short}</span>
                  </Key>
                );
              })}
            </div>
            <div role="alert">
              {weekdaysError ? <span className="bo-field__error">{weekdaysError}</span> : null}
            </div>
          </fieldset>
        ) : null}
        <div className={cn("bo-field", errors.firstDate && "is-error")}>
          <label className="bo-field__label" htmlFor={`${ids}-firstDate`}>
            {COPY.firstDateLabel}
          </label>
          <input
            id={`${ids}-firstDate`}
            type="date"
            className="bo-field__control"
            value={firstDate}
            aria-invalid={Boolean(errors.firstDate)}
            aria-describedby={`${ids}-firstDate-note`}
            onChange={(event) => {
              setFirstDate(event.target.value);
              setErrors((current) => ({ ...current, firstDate: undefined }));
            }}
          />
          <span
            id={`${ids}-firstDate-note`}
            className={errors.firstDate ? "bo-field__error" : "bo-field__help"}
          >
            {errors.firstDate ?? COPY.firstDateHelp}
          </span>
        </div>
      </form>
    </Sheet>
  );
}

const WEEKDAY_FULL = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
