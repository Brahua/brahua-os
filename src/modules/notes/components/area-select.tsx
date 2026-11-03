"use client";

import { ChevronDown, TriangleAlert } from "lucide-react";
import { Icon } from "@/design-system";
import { NOTES_COPY as COPY } from "../copy";
import type { NoteArea } from "../note-input";

/** The `<select>` value of «Sin área» (an area id is never empty). */
export const NO_AREA = "";

type AreaSelectProps = {
  id: string;
  label: string;
  /** The active areas, in their order. */
  areas: readonly NoteArea[];
  /** The picked area id, or `NO_AREA`. */
  value: string;
  onValueChange: (value: string) => void;
  /** The text of the empty option («Sin área», or «Todas las áreas» in the list's filter). */
  emptyLabel?: string;
  /** An archived area the note still has: offered too, marked «(archivada)». */
  kept?: NoteArea | null;
  help?: string;
  error?: string;
  disabled?: boolean;
};

/** A native `<select>` of life areas, styled like the app's fields (as goals' source picker). */
export function AreaSelect({
  id,
  label,
  areas,
  value,
  onValueChange,
  emptyLabel = COPY.noArea,
  kept = null,
  help,
  error,
  disabled,
}: AreaSelectProps) {
  const describedBy = error ? `${id}-error` : help ? `${id}-help` : undefined;
  const options = kept && !areas.some((area) => area.id === kept.id) ? [...areas, kept] : areas;
  return (
    <div className={error ? "bo-field is-error" : "bo-field"}>
      <label className="bo-field__label" htmlFor={id}>
        {label}
      </label>
      <div className="bo-select">
        <select
          id={id}
          className="bo-field__control"
          value={value}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          aria-disabled={disabled || undefined}
          onChange={(event) => {
            if (disabled) return;
            onValueChange(event.target.value);
          }}
        >
          <option value={NO_AREA}>{emptyLabel}</option>
          {options.map((area) => (
            <option key={area.id} value={area.id}>
              {area.id === kept?.id && !areas.some((active) => active.id === area.id)
                ? COPY.archivedArea(area.name)
                : area.name}
            </option>
          ))}
        </select>
        <Icon icon={ChevronDown} size="sm" className="bo-select__chevron" />
      </div>
      {error ? (
        <span id={`${id}-error`} className="bo-field__error">
          <Icon icon={TriangleAlert} size="sm" />
          {error}
        </span>
      ) : help ? (
        <span id={`${id}-help`} className="bo-field__help">
          {help}
        </span>
      ) : null}
    </div>
  );
}
