"use client";

import { ChevronDown, TriangleAlert } from "lucide-react";
import { Icon } from "@/design-system";
import { cn } from "@/lib/cn";

export type SourceOption = { id: string; name: string };

type SourceSelectProps = {
  id: string;
  label: string;
  /** The option that means "nothing picked yet". */
  placeholder: string;
  value: string;
  options: readonly SourceOption[];
  onValueChange: (value: string) => void;
  help?: string;
  error?: string;
  ref?: React.Ref<HTMLSelectElement>;
};

/**
 * The habit or project a goal follows: a native select with the design system's field look (the
 * phone's own wheel, one tab stop with type-ahead on the desktop), like the tasks' placement.
 */
export function SourceSelect({
  id,
  label,
  placeholder,
  value,
  options,
  onValueChange,
  help,
  error,
  ref,
}: SourceSelectProps) {
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
          <option value="">{placeholder}</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
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
