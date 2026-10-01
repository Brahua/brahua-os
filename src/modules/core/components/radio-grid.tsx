"use client";

import { useRef } from "react";
import { cn } from "@/lib/cn";

export type RadioGridOption<T extends string> = {
  value: T;
  /** Accessible name. Shown only if `children` renders it. */
  label: string;
  children: React.ReactNode;
};

type RadioGridProps<T extends string> = {
  options: readonly RadioGridOption<T>[];
  /** null: nothing picked yet (the first option is the one Tab lands on). */
  value: T | null;
  /** `source`: an arrow or Home/End key, or a click or tap (Enter and Space click too). */
  onValueChange: (value: T, source: "keyboard" | "pointer") => void;
  /** Id of the visible label. */
  labelledBy: string;
  /** Ids of the group's help and error texts. */
  describedBy?: string;
  /**
   * Id of the error text, also set on the tab-stop radio: some screen readers only read the
   * focused radio's description, not the group's.
   */
  errorId?: string;
  invalid?: boolean;
  /** Also show each option's name as a tooltip (for options that only show an icon). */
  titles?: boolean;
  required?: boolean;
  className?: string;
  itemClassName?: string;
  ref?: React.Ref<HTMLDivElement>;
};

/** Options per row in the current layout (items that share the first one's top). */
function columnsOf(items: (HTMLButtonElement | null)[]): number {
  const present = items.filter((item): item is HTMLButtonElement => item !== null);
  if (present.length === 0) return 1;
  const top = present[0].offsetTop;
  return present.filter((item) => item.offsetTop === top).length;
}

/**
 * Radio group laid out as a grid of keys (WAI-ARIA radio group): one tab stop, selection follows
 * focus. ←/→ move to the previous/next option (wrapping); ↑/↓ move a row up or down in the grid
 * (or act like ←/→ when everything fits on one row); Inicio/Fin go to the first/last option.
 * Checked options are activated keys (`is-on`).
 */
export function RadioGrid<T extends string>({
  options,
  value,
  onValueChange,
  labelledBy,
  describedBy,
  errorId,
  invalid = false,
  titles = false,
  required = false,
  className,
  itemClassName,
  ref,
}: RadioGridProps<T>) {
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const checkedIndex = options.findIndex((option) => option.value === value);
  const tabStop = checkedIndex >= 0 ? checkedIndex : 0;

  function move(to: number) {
    items.current[to]?.focus();
    onValueChange(options[to].value, "keyboard");
  }

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    const count = options.length;
    const columns = columnsOf(items.current);
    const grid = columns > 1 && columns < count;
    let target: number | undefined;
    switch (event.key) {
      case "ArrowRight":
        target = (index + 1) % count;
        break;
      case "ArrowLeft":
        target = (index - 1 + count) % count;
        break;
      case "ArrowDown":
        target = grid ? (index + columns < count ? index + columns : index) : (index + 1) % count;
        break;
      case "ArrowUp":
        target = grid
          ? index - columns >= 0
            ? index - columns
            : index
          : (index - 1 + count) % count;
        break;
      case "Home":
        target = 0;
        break;
      case "End":
        target = count - 1;
        break;
    }
    if (target === undefined) return;
    event.preventDefault();
    if (target !== index || value !== options[index].value) move(target);
  }

  return (
    <div
      ref={ref}
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      aria-required={required || undefined}
      className={className}
    >
      {options.map((option, index) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            ref={(element) => {
              items.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={option.label}
            aria-describedby={index === tabStop && errorId ? errorId : undefined}
            title={titles ? option.label : undefined}
            tabIndex={index === tabStop ? 0 : -1}
            className={cn("bo-key", checked && "is-on", itemClassName)}
            onClick={() => onValueChange(option.value, "pointer")}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {option.children}
          </button>
        );
      })}
    </div>
  );
}

/** Focuses the option a Tab would land on (the checked one, else the first). */
export function focusRadioGrid(group: HTMLElement | null) {
  group?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]')?.focus();
}
