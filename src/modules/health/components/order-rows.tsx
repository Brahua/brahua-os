"use client";

// The rows of `health`'s reorderable lists (the routines on /health, a routine's exercises),
// shared by the plain list (before dnd-kit loads, and its loading state) and the sortable one
// (sortable-rows.tsx). The same pattern as a track's syllabus (learning's step-rows.tsx): a
// handle, the row's content, «Subir» and «Bajar».
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { createContext, use, useEffect, useLayoutEffect, useRef } from "react";
import { IconKey, Icon, keyClasses } from "@/design-system";
import { cn } from "@/lib/cn";
import { ROUTINES_COPY as COPY } from "../routines-copy";

export type OrderItem = { id: string; name: string };

export type OrderListProps<T extends OrderItem> = {
  items: T[];
  /** The list's accessible name. */
  label: string;
  /** How the screen reader calls a row that can be lifted. */
  dragRole: string;
  /** Under prefers-reduced-motion: rows jump into place, keyboard drags scroll without easing. */
  reducedMotion: boolean;
  /** Rows can't move (one is being edited). */
  locked?: boolean;
  /** Move the row to position `to` (0-based). */
  onMove: (id: string, to: number) => void;
  /** The row's content between the handle and Subir/Bajar. */
  renderContent: (item: T) => React.ReactNode;
  /** When it returns something, the row shows it instead (an editor in place). */
  renderEditor?: (item: T) => React.ReactNode;
};

/**
 * The list's props for the loading state of the lazy dnd-kit layer: next/dynamic's `loading`
 * component receives no props, so it reads them from here.
 */
export const OrderListContext = createContext<OrderListProps<OrderItem> | null>(null);

/**
 * Every focusable control of a row carries `data-order-focus="<control>:<id>"`, so focus can be
 * found again after React re-inserts the row (a move) or swaps the whole list (dnd-kit arriving).
 * The content's main control (a link, an edit key) uses `main`.
 */
export type FocusControl = "handle" | "up" | "down" | "main";
export const orderFocusSelector = (id: string, control: FocusControl) =>
  `[data-order-focus="${control}:${CSS.escape(id)}"]`;

/** A focus request older than this is dropped: it belongs to a move that never rendered. */
const FOCUS_REQUEST_TTL_MS = 100;

/** Keeps focus on the control that moved a row (`request` right before the move). */
function useRowFocus() {
  const pending = useRef<{ id: string; control: FocusControl; at: number } | null>(null);
  useEffect(() => {
    const request = pending.current;
    if (!request) return;
    pending.current = null;
    if (performance.now() - request.at > FOCUS_REQUEST_TTL_MS) return;
    const element = document.querySelector<HTMLElement>(
      orderFocusSelector(request.id, request.control),
    );
    if (element && document.activeElement !== element) element.focus();
  });
  return (id: string, control: FocusControl) => {
    pending.current = { id, control, at: performance.now() };
  };
}

/** The control that had focus inside the plain list, to take it back after the swap. */
let focusAcrossSwap: string | null = null;

function describeFocus(list: HTMLElement | null): string | null {
  const active = document.activeElement as HTMLElement | null;
  if (!active || !list?.contains(active)) return null;
  const key = active.dataset.orderFocus;
  return key ? `[data-order-focus="${CSS.escape(key)}"]` : null;
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
export function useMoveBy(items: readonly OrderItem[], onMove: (id: string, to: number) => void) {
  const requestFocus = useRowFocus();
  return {
    requestFocus,
    moveBy(id: string, delta: -1 | 1) {
      const from = items.findIndex((item) => item.id === id);
      const to = from + delta;
      if (from === -1 || to < 0 || to >= items.length) return;
      requestFocus(id, delta < 0 ? "up" : "down");
      onMove(id, to);
    },
  };
}

export const ROW_CLASSES = "flex min-h-14 items-center gap-1 bg-surface pr-2";

/**
 * The list before dnd-kit loads (and its loading state): the same rows, with Subir/Bajar working
 * and the handle not yet draggable.
 */
export function PlainOrderRows() {
  const props = use(OrderListContext);
  const list = useRef<HTMLUListElement>(null);
  const { moveBy } = useMoveBy(props?.items ?? [], props?.onMove ?? (() => {}));
  useLayoutEffect(() => {
    const element = list.current;
    return () => {
      focusAcrossSwap = describeFocus(element);
    };
  }, []);
  if (!props) return null;
  const { items, label, locked, renderEditor } = props;
  return (
    <ul ref={list} aria-label={label} className="bo-list">
      {items.map((item, index) => {
        const editor = renderEditor?.(item);
        return (
          <li
            key={item.id}
            data-order-row={item.id}
            className={cn(ROW_CLASSES, editor ? "p-4" : null)}
          >
            {editor ?? (
              <OrderRowContent
                {...props}
                item={item}
                first={index === 0}
                last={index === items.length - 1}
                handleDisabled
                moveDisabled={locked}
                onMoveBy={moveBy}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

type RowContentProps<T extends OrderItem> = OrderListProps<T> & {
  item: T;
  first: boolean;
  last: boolean;
  handleRef?: (element: HTMLElement | null) => void;
  /** Not draggable (dnd-kit not loaded yet, a single row, or one is being edited). */
  handleDisabled?: boolean;
  /** Subir/Bajar do nothing (one is being edited). */
  moveDisabled?: boolean;
  /** dnd-kit's attributes and listeners. */
  handleProps?: React.ButtonHTMLAttributes<HTMLButtonElement>;
  onMoveBy: (id: string, delta: -1 | 1) => void;
};

/** Handle, the row's content and Subir/Bajar of one row (the <li> is the caller's). */
export function OrderRowContent<T extends OrderItem>({
  item,
  first,
  last,
  handleRef,
  handleDisabled = false,
  moveDisabled = false,
  handleProps,
  renderContent,
  onMoveBy,
}: RowContentProps<T>) {
  return (
    <>
      <button
        ref={handleRef}
        type="button"
        {...handleProps}
        aria-label={COPY.drag(item.name)}
        // aria-disabled, not disabled: it stays focusable and keeps its name and description.
        aria-disabled={handleDisabled || undefined}
        data-order-focus={`handle:${item.id}`}
        className={keyClasses({
          variant: "ghost",
          className: cn("bo-key--icon bo-drag-handle", handleDisabled && "is-disabled"),
        })}
      >
        <Icon icon={GripVertical} size="md" />
      </button>
      <div className="flex min-w-0 flex-1 items-center">{renderContent(item)}</div>
      <MoveKey item={item} button="up" disabled={first || moveDisabled} onMoveBy={onMoveBy} />
      <MoveKey item={item} button="down" disabled={last || moveDisabled} onMoveBy={onMoveBy} />
    </>
  );
}

function MoveKey({
  item,
  button,
  disabled,
  onMoveBy,
}: {
  item: OrderItem;
  button: "up" | "down";
  disabled: boolean;
  onMoveBy: (id: string, delta: -1 | 1) => void;
}) {
  const up = button === "up";
  return (
    <IconKey
      icon={up ? ArrowUp : ArrowDown}
      label={up ? COPY.moveUp(item.name) : COPY.moveDown(item.name)}
      variant="ghost"
      // No tooltip: the list clips with overflow: hidden (as in the milestones).
      tooltip={false}
      data-order-focus={`${button}:${item.id}`}
      // aria-disabled, not disabled: at the top or bottom, focus stays on the key.
      aria-disabled={disabled || undefined}
      className={cn(disabled && "is-disabled")}
      onClick={() => {
        if (!disabled) onMoveBy(item.id, up ? -1 : 1);
      }}
    />
  );
}
