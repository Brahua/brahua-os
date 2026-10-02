"use client";

import { TriangleAlert } from "lucide-react";
import { Icon } from "@/design-system";
import { cn } from "@/lib/cn";
import { TASKS_COPY } from "../tasks-copy";

type DateFieldProps = {
  id: string;
  label: string;
  /** YYYY-MM-DD, or "" for none. */
  value: string;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  help?: string;
  error?: string;
  ref?: React.Ref<HTMLInputElement>;
};

/**
 * A native date field with the design system's look (`TextField` markup). iOS draws an empty
 * date input as a blank box (no placeholder, no icon), so an empty one shows "Sin fecha" over
 * it there (`.bo-date-empty`, only where `-webkit-touch-callout` exists: iOS Safari); other
 * browsers draw their own placeholder and calendar icon. The hint is decorative: the field is
 * named by its label and an empty value reads as such.
 */
export function DateField({ id, label, value, onChange, help, error, ref }: DateFieldProps) {
  const describedBy = error ? `${id}-error` : help ? `${id}-help` : undefined;
  return (
    <div className={cn("bo-field bo-date-field", error && "is-error")}>
      <label className="bo-field__label" htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <input
          ref={ref}
          id={id}
          type="date"
          className="bo-field__control"
          value={value}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          onChange={onChange}
        />
        {value === "" ? (
          <span className="bo-date-empty" aria-hidden>
            {TASKS_COPY.noDate}
          </span>
        ) : null}
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
