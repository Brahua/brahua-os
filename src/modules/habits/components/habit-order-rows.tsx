"use client";

// The rows of "Ordenar hábitos" (H2), shared by the plain list (before dnd-kit loads, and its
// loading state) and the sortable one (sortable-habits.tsx). The same pattern as the areas list
// (src/app/(app)/areas/_components/area-rows.tsx): a handle, the habit, "Subir" and "Bajar".
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { createContext, useContext, useEffect, useLayoutEffect, useRef } from "react";
import { AREA_ICONS, Icon, IconKey, Led, keyClasses } from "@/design-system";
import { cn } from "@/lib/cn";
import type { HabitItem } from "../habit-input";
import { ORGANIZE_COPY } from "../organize-copy";

export type HabitOrderListProps = {
  /** Every active habit, in the manual order (also the ones not due today). */
  habits: HabitItem[];
  /** Under prefers-reduced-motion: rows jump into place, keyboard drags scroll without easing. */
  reducedMotion: boolean;
  /** Move the habit to position `to` (0-based) of the list. */
  onMove: (id: string, to: number) => void;
};

/**
 * The list's props for the loading state of the lazy dnd-kit layer: next/dynamic's `loading`
 * component receives no props, so it reads them from here.
 */
export const HabitOrderContext = createContext<HabitOrderListProps | null>(null);

type FocusTarget = "up" | "down" | "handle";

const focusSelector = (id: string, target: FocusTarget) =>
  target === "handle"
    ? `[data-habit-handle="${CSS.escape(id)}"]`
    : `[data-habit-move="${target}"][data-habit-id="${CSS.escape(id)}"]`;

/** A focus request older than this is dropped: it belongs to a move that never rendered. */
const FOCUS_REQUEST_TTL_MS = 100;

/**
 * Keeps focus on the control that moved a row: React may re-insert the row's node when the
 * order changes, which drops focus. `request` right before the move; the commit it causes
 * restores it. A request no commit picks up soon is dropped.
 */
function useRowFocus() {
  const pending = useRef<{ id: string; target: FocusTarget; at: number } | null>(null);
  useEffect(() => {
    const request = pending.current;
    if (!request) return;
    pending.current = null;
    if (performance.now() - request.at > FOCUS_REQUEST_TTL_MS) return;
    const element = document.querySelector<HTMLElement>(focusSelector(request.id, request.target));
    if (element && document.activeElement !== element) element.focus();
  });
  return (id: string, target: FocusTarget) => {
    pending.current = { id, target, at: performance.now() };
  };
}

/** Which control had focus when the plain list was swapped for the sortable one. */
let focusAcrossSwap: string | null = null;

function describeFocus(list: HTMLElement | null): string | null {
  const active = document.activeElement as HTMLElement | null;
  if (!active || !list?.contains(active)) return null;
  const { habitHandle, habitMove, habitId } = active.dataset;
  if (habitHandle) return focusSelector(habitHandle, "handle");
  if (habitMove && habitId) return focusSelector(habitId, habitMove as FocusTarget);
  return null;
}

/** For the sortable list: takes focus back after the swap, if the plain list had it. */
export function useFocusAfterSwap() {
  useLayoutEffect(() => {
    const selector = focusAcrossSwap;
    focusAcrossSwap = null;
    if (selector) document.querySelector<HTMLElement>(selector)?.focus();
  }, []);
}

/** Moves within the list by one place, keeping focus on the pressed key. */
export function useMoveBy(habits: HabitItem[], onMove: HabitOrderListProps["onMove"]) {
  const requestFocus = useRowFocus();
  return {
    requestFocus,
    moveBy(id: string, delta: -1 | 1) {
      const from = habits.findIndex((habit) => habit.id === id);
      const to = from + delta;
      if (from === -1 || to < 0 || to >= habits.length) return;
      requestFocus(id, delta < 0 ? "up" : "down");
      onMove(id, to);
    },
  };
}

export const ROW_CLASSES = "flex min-h-14 items-center gap-1 bg-surface pr-2";

/**
 * The list before dnd-kit loads (and its loading state): the same rows, with Subir/Bajar
 * working and the handle not yet draggable.
 */
export function PlainHabitOrder() {
  const props = useContext(HabitOrderContext);
  const list = useRef<HTMLUListElement>(null);
  const { moveBy } = useMoveBy(props?.habits ?? [], props?.onMove ?? (() => {}));
  useLayoutEffect(() => {
    const element = list.current;
    return () => {
      focusAcrossSwap = describeFocus(element);
    };
  }, []);
  if (!props) return null;
  const { habits } = props;
  return (
    <ul ref={list} aria-label={ORGANIZE_COPY.orderList} className="bo-list max-w-160">
      {habits.map((habit, index) => (
        <li key={habit.id} data-habit-row={habit.id} className={ROW_CLASSES}>
          <HabitOrderRow
            habit={habit}
            first={index === 0}
            last={index === habits.length - 1}
            handleDisabled
            onMoveBy={moveBy}
          />
        </li>
      ))}
    </ul>
  );
}

/** Handle, the habit and Subir/Bajar of one row (the <li> is the caller's). */
export function HabitOrderRow({
  habit,
  first,
  last,
  handleRef,
  handleDisabled = false,
  handleProps,
  onMoveBy,
}: {
  habit: HabitItem;
  first: boolean;
  last: boolean;
  handleRef?: (element: HTMLElement | null) => void;
  /** Not draggable (dnd-kit not loaded yet, or only one habit). */
  handleDisabled?: boolean;
  /** dnd-kit's attributes and listeners. */
  handleProps?: React.ButtonHTMLAttributes<HTMLButtonElement>;
  onMoveBy: (id: string, delta: -1 | 1) => void;
}) {
  const { area } = habit;
  return (
    <>
      <button
        ref={handleRef}
        type="button"
        {...handleProps}
        aria-label={ORGANIZE_COPY.drag(habit.name)}
        // aria-disabled, not disabled: it stays focusable and keeps its name and description.
        aria-disabled={handleDisabled || undefined}
        data-habit-handle={habit.id}
        className={keyClasses({
          variant: "ghost",
          className: cn("bo-key--icon bo-drag-handle", handleDisabled && "is-disabled"),
        })}
      >
        <Icon icon={GripVertical} size="md" />
      </button>
      <span className="bo-text-body flex min-w-0 flex-1 items-center gap-2 pl-1">
        <Led area={area?.color} on />
        {area ? <Icon icon={AREA_ICONS[area.icon]} size="sm" aria-hidden /> : null}
        <span className="line-clamp-2 break-words" title={habit.name}>
          {habit.name}
        </span>
      </span>
      <MoveKey habit={habit} button="up" disabled={first} onMoveBy={onMoveBy} />
      <MoveKey habit={habit} button="down" disabled={last} onMoveBy={onMoveBy} />
    </>
  );
}

function MoveKey({
  habit,
  button,
  disabled,
  onMoveBy,
}: {
  habit: HabitItem;
  button: "up" | "down";
  disabled: boolean;
  onMoveBy: (id: string, delta: -1 | 1) => void;
}) {
  const up = button === "up";
  return (
    <IconKey
      icon={up ? ArrowUp : ArrowDown}
      label={up ? ORGANIZE_COPY.moveUp(habit.name) : ORGANIZE_COPY.moveDown(habit.name)}
      variant="ghost"
      // No tooltip: the list's rounded clip would cut it; the name is the key's aria-label.
      tooltip={false}
      data-habit-move={button}
      data-habit-id={habit.id}
      // aria-disabled, not disabled: at the top or bottom, focus stays on the key.
      aria-disabled={disabled || undefined}
      className={cn(disabled && "is-disabled")}
      onClick={() => {
        if (!disabled) onMoveBy(habit.id, up ? -1 : 1);
      }}
    />
  );
}
