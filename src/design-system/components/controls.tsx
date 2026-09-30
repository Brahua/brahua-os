"use client";

import { TriangleAlert } from "lucide-react";
import { useId, useRef } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "./icon";

type SwitchProps = Omit<React.ComponentProps<"button">, "onChange" | "role"> & {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /** Accessible name when there is no visible <label>. */
  label?: string;
};

/** Toggle switch (design system `Switch`). On = orange with a dark knob. */
export function Switch({
  checked = false,
  onCheckedChange,
  label,
  className,
  onClick,
  ...props
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={cn("bo-switch", className)}
      onClick={(event) => {
        onCheckedChange?.(!checked);
        onClick?.(event);
      }}
      {...props}
    />
  );
}

export type SegmentOption<T extends string> = {
  value: T;
  label: React.ReactNode;
  count?: React.ReactNode;
  disabled?: boolean;
};

type SegmentedControlProps<T extends string> = Omit<
  React.ComponentProps<"div">,
  "onChange" | "children"
> & {
  options: SegmentOption<T>[];
  value: T;
  onValueChange?: (value: T) => void;
  /** `tabs` (switches views) or `radio` (picks a value). */
  mode?: "tabs" | "radio";
  /** 44 px items for touch screens. */
  touch?: boolean;
  /** Accessible name of the group. */
  label: string;
};

/**
 * Segmented tabs or picker (design system `SegmentedControl`). The selected option is an
 * activated (inverted) key. Arrow keys, Home and End move the selection (roving tabindex).
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onValueChange,
  mode = "tabs",
  touch = false,
  label,
  className,
  ...props
}: SegmentedControlProps<T>) {
  const tabs = mode === "tabs";
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    const pos = enabled.indexOf(index);
    const target =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? enabled[(pos + 1) % enabled.length]
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? enabled[(pos - 1 + enabled.length) % enabled.length]
          : event.key === "Home"
            ? enabled[0]
            : event.key === "End"
              ? enabled[enabled.length - 1]
              : undefined;
    if (target === undefined) return;
    event.preventDefault();
    refs.current[target]?.focus();
    onValueChange?.(options[target].value);
  }

  return (
    <div
      role={tabs ? "tablist" : "radiogroup"}
      aria-label={label}
      className={cn("bo-segmented", touch && "bo-segmented--touch", className)}
      {...props}
    >
      {options.map((option, index) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role={tabs ? "tab" : "radio"}
            aria-selected={tabs ? on : undefined}
            aria-checked={tabs ? undefined : on}
            tabIndex={on ? 0 : -1}
            disabled={option.disabled}
            className="bo-segmented__item"
            onClick={() => onValueChange?.(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {option.label}
            {option.count != null ? (
              <span className="bo-segmented__count">{option.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

type FieldBaseProps = {
  label?: string;
  help?: string;
  /** Error message: orange 2px border + icon + message (never red). */
  error?: string;
  className?: string;
};

type TextFieldProps = FieldBaseProps & Omit<React.ComponentProps<"input">, "className">;
type TextAreaProps = FieldBaseProps & Omit<React.ComponentProps<"textarea">, "className">;

function Field({
  id,
  label,
  help,
  error,
  className,
  children,
}: FieldBaseProps & {
  id: string;
  children: (a11y: { "aria-invalid": boolean; "aria-describedby"?: string }) => React.ReactNode;
}) {
  const describedBy = error ? `${id}-error` : help ? `${id}-help` : undefined;
  return (
    <div className={cn("bo-field", error && "is-error", className)}>
      {label ? (
        <label className="bo-field__label" htmlFor={id}>
          {label}
        </label>
      ) : null}
      {children({ "aria-invalid": Boolean(error), "aria-describedby": describedBy })}
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

/** Text field with label, help and error (design system `TextField`). */
export function TextField({ label, help, error, className, id, ...props }: TextFieldProps) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <Field id={fieldId} label={label} help={help} error={error} className={className}>
      {(a11y) => <input id={fieldId} className="bo-field__control" {...a11y} {...props} />}
    </Field>
  );
}

/** Multi-line variant of TextField (design system `TextArea`). */
export function TextArea({ label, help, error, className, id, ...props }: TextAreaProps) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <Field id={fieldId} label={label} help={help} error={error} className={className}>
      {(a11y) => <textarea id={fieldId} className="bo-field__control" {...a11y} {...props} />}
    </Field>
  );
}
