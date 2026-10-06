"use client";

import { ChevronDown, TriangleAlert } from "lucide-react";
import { Icon } from "@/design-system";
import { cn } from "@/lib/cn";

export type SelectOption = { value: string; label: string };

type SelectFieldProps = {
  id: string;
  label: string;
  value: string;
  options: readonly SelectOption[];
  onValueChange: (value: string) => void;
  help?: string;
  error?: string;
  ref?: React.Ref<HTMLSelectElement>;
};

/**
 * A native select with the design system's field look (like the tasks' "Área o proyecto"):
 * on the phone it is the system's wheel, on the desktop one tab stop with type-ahead.
 */
export function SelectField({
  id,
  label,
  value,
  options,
  onValueChange,
  help,
  error,
  ref,
}: SelectFieldProps) {
  const describedBy = error ? `${id}-error` : help ? `${id}-help` : undefined;
  return (
    <div className={cn("bo-field", error && "is-error")}>
      <label className="bo-field__label" htmlFor={id}>
        {label}
      </label>
      <div className="bo-select">
        <select
          ref={ref}
          id={id}
          className="bo-field__control"
          value={value}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          onChange={(event) => onValueChange(event.target.value)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
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
