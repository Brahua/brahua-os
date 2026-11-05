"use client";

import { EllipsisVertical, RotateCw, Trash2 } from "lucide-react";
import { useId, useLayoutEffect, useState } from "react";
import { IconKey, Key } from "@/design-system";
import { cn } from "@/lib/cn";
import type { ExerciseKind } from "../health-constants";
import { SESSION_ERRORS as ERRORS, SESSIONS_COPY as COPY } from "../sessions-copy";
import { SET_FIELDS, missingValue, type SessionSet, type SetValues } from "../sessions-input";
import {
  formatClock,
  formatDistance,
  formatWeight,
  parseDistance,
  parseDuration,
  parseReps,
  parseWeight,
  type Parsed,
} from "../weight";
import { useRowMenu } from "./use-row-menu";

type Field = keyof SetValues;
type Drafts = Record<Field, string>;

/** How each field is typed and shown. */
function fieldText(field: Field, value: number | null): string {
  if (value === null) return "";
  switch (field) {
    case "weightGrams":
      return formatWeight(value);
    case "reps":
      return String(value);
    case "seconds":
      return formatClock(value);
    case "distanceMeters":
      return formatDistance(value);
  }
}

function parseField(field: Field, kind: ExerciseKind, text: string): Parsed<number | null> {
  if (text.trim() === "") return { ok: true, value: null };
  switch (field) {
    case "weightGrams":
      return parseWeight(text);
    case "reps":
      return parseReps(text);
    case "seconds":
      return parseDuration(text, kind === "cardio" ? "minutes" : "seconds");
    case "distanceMeters":
      return parseDistance(text);
  }
}

const FIELD_ERRORS: Record<Field, string> = {
  weightGrams: ERRORS.weight,
  reps: ERRORS.reps,
  seconds: ERRORS.seconds,
  distanceMeters: ERRORS.distance,
};

const toDrafts = (set: SetValues): Drafts => ({
  weightGrams: fieldText("weightGrams", set.weightGrams),
  reps: fieldText("reps", set.reps),
  seconds: fieldText("seconds", set.seconds),
  distanceMeters: fieldText("distanceMeters", set.distanceMeters),
});

const valuesKey = (set: SetValues) =>
  `${set.weightGrams}|${set.reps}|${set.seconds}|${set.distanceMeters}`;

/** The drafts as values, or the first field that doesn't parse. */
function draftsToValues(
  kind: ExerciseKind,
  drafts: Drafts,
  base: SetValues,
): { ok: true; values: SetValues } | { ok: false; field: Field } {
  const values = { ...base };
  for (const field of SET_FIELDS[kind].shown) {
    const parsed = parseField(field, kind, drafts[field]);
    if (!parsed.ok) return { ok: false, field };
    values[field] = parsed.value;
  }
  return { ok: true, values };
}

type SetRowProps = {
  kind: ExerciseKind;
  /** The exercise's name: every control of the row says it («Serie 2 de Sentadilla…»). */
  exerciseName: string;
  set: SessionSet;
  /** Position among the exercise's sets (0-based). */
  index: number;
  /** The last save of this set failed on the network: «Sin guardar» and «Reintentar». */
  unsaved: boolean;
  /** New values (each valid change, saved at once). */
  onValues: (values: SetValues) => void;
  /** «hecha» marked (with the values it was marked with) or cleared. */
  onDone: (done: boolean, values: SetValues, from: HTMLElement) => void;
  onWarmup: (warmup: boolean) => void;
  onRemove: () => void;
  onRetry: () => void;
  /**
   * Whether a field holds text that doesn't parse (`,`, `8a`, a blurred invalid value): the screen
   * doesn't see that text, so it must not take the set as empty (E5's copy would land over it).
   */
  onDraftHeld: (held: boolean) => void;
};

/**
 * One set (SPEC-health "Serie"): its values by the exercise's kind (kilos and reps, time and
 * distance…), a checkbox that marks it done in one tap (it asks for the values its kind needs
 * first) and a menu with «Calentamiento» and «Quitar serie». Each valid change is saved at once.
 * The `<li>` is the caller's.
 */
export function SetRow({
  kind,
  exerciseName,
  set,
  index,
  unsaved,
  onValues,
  onDone,
  onWarmup,
  onRemove,
  onRetry,
  onDraftHeld,
}: SetRowProps) {
  const ids = useId();
  const [drafts, setDrafts] = useState<Drafts>(() => toDrafts(set));
  const [error, setError] = useState<{ field: Field; message: string } | null>(null);
  const menu = useRowMenu();
  // Values from outside (a rollback, «Deshacer», the server's answer) replace the drafts unless
  // they already say the same; synced while rendering (CLAUDE.md "household": no remount).
  const [seen, setSeen] = useState(() => valuesKey(set));
  const key = valuesKey(set);
  if (key !== seen) {
    setSeen(key);
    const current = draftsToValues(kind, drafts, set);
    if (!current.ok || valuesKey(current.values) !== key) {
      setDrafts(toDrafts(set));
      // The old error spoke of text that is gone.
      setError(null);
    }
  }

  // Reported after every commit that changes it (before a click can reach the screen); the
  // cleanup clears it when the row goes.
  const held = !draftsToValues(kind, drafts, set).ok;
  useLayoutEffect(() => {
    onDraftHeld(held);
    return () => onDraftHeld(false);
  }, [held, onDraftHeld]);

  const name = set.warmup
    ? COPY.warmupName(index, exerciseName)
    : COPY.setName(index, exerciseName);
  const fields = SET_FIELDS[kind].shown;
  const fieldId = (field: Field) => `${ids}-${field}`;
  const errorId = `${ids}-error`;
  const done = set.doneAt !== null;

  function change(field: Field, text: string) {
    const next = { ...drafts, [field]: text };
    setDrafts(next);
    if (error?.field === field) setError(null);
    const parsed = parseField(field, kind, text);
    if (!parsed.ok) return;
    const values = { ...set, [field]: parsed.value } as SetValues;
    // A done set keeps the values its kind needs: emptying one waits for a value.
    if (done && missingValue(kind, values) !== null) return;
    if (valuesKey(values) !== valuesKey(set)) onValues(values);
  }

  function blur(field: Field) {
    const parsed = parseField(field, kind, drafts[field]);
    if (!parsed.ok) setError({ field, message: FIELD_ERRORS[field] });
    else if (done && parsed.value === null && SET_FIELDS[kind].required.includes(field)) {
      setError({ field, message: ERRORS.missing[field] });
    }
  }

  function toggle(checked: boolean, from: HTMLElement) {
    if (!checked) {
      onDone(false, set, from);
      return;
    }
    const parsed = draftsToValues(kind, drafts, set);
    if (!parsed.ok) {
      setError({ field: parsed.field, message: FIELD_ERRORS[parsed.field] });
      document.getElementById(fieldId(parsed.field))?.focus();
      return;
    }
    const missing = missingValue(kind, parsed.values);
    if (missing !== null) {
      setError({ field: missing, message: ERRORS.missing[missing] });
      document.getElementById(fieldId(missing))?.focus();
      return;
    }
    setError(null);
    onDone(true, parsed.values, from);
  }

  const labels: Record<Field, string> = {
    weightGrams: kind === "reps" ? COPY.extraWeightName(name) : COPY.weightName(name),
    reps: COPY.repsName(name),
    seconds: COPY.timeName(name),
    distanceMeters: COPY.distanceName(name),
  };

  return (
    <div className="flex flex-col gap-1" data-set={set.id} data-set-done={done || undefined}>
      <div className="bo-set-grid">
        <span
          className={cn(
            "bo-text-label text-center tabular-nums",
            set.warmup ? "text-text-secondary" : null,
          )}
          aria-hidden
        >
          {set.warmup ? COPY.warmupShort : COPY.setNumber(index)}
        </span>
        {fields.map((field, position) => (
          <input
            key={field}
            id={fieldId(field)}
            className={cn(
              "bo-field__control bo-set-field min-w-0 text-center tabular-nums",
              error?.field === field && "is-error",
            )}
            inputMode={field === "reps" ? "numeric" : field === "seconds" ? "text" : "decimal"}
            // From kg the keyboard goes on to reps; the last field closes it.
            enterKeyHint={position < fields.length - 1 ? "next" : "done"}
            autoComplete="off"
            aria-label={labels[field]}
            aria-invalid={error?.field === field || undefined}
            aria-describedby={error?.field === field ? errorId : undefined}
            value={drafts[field]}
            data-set-field={field}
            onChange={(event) => change(field, event.target.value)}
            onBlur={() => blur(field)}
          />
        ))}
        {fields.length === 1 ? <span aria-hidden /> : null}
        {/* A label: the whole 44 px square toggles the checkbox. */}
        <label className="flex size-11 cursor-pointer items-center justify-center">
          <input
            type="checkbox"
            className="bo-milestone-check bo-set-check"
            checked={done}
            aria-label={COPY.doneName(name)}
            data-set-check={set.id}
            onChange={(event) => toggle(event.target.checked, event.currentTarget)}
          />
        </label>
        <IconKey
          icon={EllipsisVertical}
          label={COPY.setMenu(index, exerciseName)}
          variant="ghost"
          tooltip={false}
          data-set-menu={set.id}
          {...menu.keyProps}
        />
      </div>
      {error ? (
        <p id={errorId} className="bo-field__error pl-6" data-set-error="">
          {error.message}
        </p>
      ) : null}
      {unsaved ? (
        <div className="flex flex-wrap items-center gap-2 pl-6" data-set-unsaved="">
          <span className="bo-text-body-sm text-signal-text">{COPY.unsaved}</span>
          <Key
            variant="ghost"
            icon={RotateCw}
            aria-label={COPY.retryName(index, exerciseName)}
            onClick={onRetry}
          >
            {COPY.retry}
          </Key>
        </div>
      ) : null}
      {menu.open ? (
        <div className="flex flex-wrap gap-2 pl-6" data-set-options="" {...menu.panelProps}>
          <Key
            variant={set.warmup ? "default" : "ghost"}
            aria-pressed={set.warmup}
            data-set-warmup={set.id}
            onClick={() => {
              menu.close();
              onWarmup(!set.warmup);
            }}
          >
            {COPY.warmup}
          </Key>
          <Key
            variant="ghost"
            icon={Trash2}
            data-set-remove={set.id}
            onClick={() => {
              menu.close();
              onRemove();
            }}
          >
            {COPY.removeSet}
          </Key>
        </div>
      ) : null}
    </div>
  );
}
