"use client";

import { TriangleAlert, X } from "lucide-react";
import { Icon, Key } from "@/design-system";
import { cn } from "@/lib/cn";
import { TASKS_COPY } from "../tasks-copy";

type TimeFieldProps = {
  id: string;
  label: string;
  /** HH:MM (24 h), or "" for none. */
  value: string;
  /** The new value: HH:MM, or "" (cleared with the key, or a half-typed time). */
  onChange: (value: string) => void;
  help?: string;
  error?: string;
  ref?: React.Ref<HTMLInputElement>;
};

/**
 * The optional time of a task (polish → task-time): a native time input (24 h, minute
 * precision) with the design system's look (`TextField` markup), and a "Quitar hora" key beside
 * it once there is one. Like the date field, an empty input shows "Sin hora" over it on iOS,
 * which draws it blank. Clearing never unmounts the focused key before it moves focus back to
 * the input.
 */
export function TimeField({ id, label, value, onChange, help, error, ref }: TimeFieldProps) {
  const describedBy = error ? `${id}-error` : help ? `${id}-help` : undefined;
  return (
    <div className={cn("bo-field bo-date-field", error && "is-error")}>
      <label className="bo-field__label" htmlFor={id}>
        {label}
      </label>
      <div className="bo-time-field__row">
        <div className="relative">
          <input
            ref={ref}
            id={id}
            type="time"
            step={60}
            className="bo-field__control font-mono tabular-nums"
            value={value}
            aria-invalid={Boolean(error)}
            aria-describedby={describedBy}
            onChange={(event) => onChange(event.target.value)}
          />
          {value === "" ? (
            <span className="bo-date-empty" aria-hidden>
              {TASKS_COPY.noTime}
            </span>
          ) : null}
        </div>
        {/* Always rendered (aria-disabled while empty): a key never unmounts under focus. */}
        <Key
          variant="ghost"
          icon={X}
          aria-disabled={value === "" || undefined}
          data-time-clear=""
          onClick={(event) => {
            if (value === "") return;
            onChange("");
            const input = event.currentTarget.parentElement?.querySelector("input");
            input?.focus();
          }}
        >
          {TASKS_COPY.clearTime}
        </Key>
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
