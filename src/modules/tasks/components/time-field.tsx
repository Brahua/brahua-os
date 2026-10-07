"use client";

import { TriangleAlert, X } from "lucide-react";
import { useState } from "react";
import { Icon, Key } from "@/design-system";
import { cn } from "@/lib/cn";
import { TASKS_COPY } from "../tasks-copy";

type TimeFieldProps = {
  id: string;
  label: string;
  /** HH:MM (24 h), or "" for none. */
  value: string;
  /** The new value: HH:MM, or "" (every segment emptied, or the "Quitar hora" key). */
  onChange: (value: string) => void;
  help?: string;
  error?: string;
  ref?: React.Ref<HTMLInputElement>;
};

/**
 * The optional time of a task (polish → task-time): a native time input (minute precision) with
 * the design system's look (`TextField` markup), and a "Quitar hora" key beside it. Like the date
 * field, an empty input shows "Sin hora" over it on iOS, which draws it blank.
 *
 * A half-edited time (one segment emptied) makes the input say `value === ""` with
 * `validity.badInput`: that is NOT "no time", so it reports nothing and the saved time stays until
 * the time is complete again (a valid value saves right away) or the key clears it. The input
 * keeps a draft of its own so React never rewrites what the user is in the middle of typing.
 */
export function TimeField({ id, label, value, onChange, help, error, ref }: TimeFieldProps) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    // The saved value changed under us (a save, a rollback): it becomes the draft.
    setSeen(value);
    setDraft(value);
  }
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
            value={draft}
            aria-invalid={Boolean(error)}
            aria-describedby={describedBy}
            onChange={(event) => {
              const next = event.target.value;
              setDraft(next);
              if (next === "" && event.target.validity.badInput) return;
              onChange(next);
            }}
          />
          {draft === "" ? (
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
            setDraft("");
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
