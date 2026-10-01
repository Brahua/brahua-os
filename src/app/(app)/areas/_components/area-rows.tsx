"use client";

import { ArrowDown, ArrowUp, GripVertical, Pencil } from "lucide-react";
import { createContext, useContext, useEffect, useLayoutEffect, useRef } from "react";
import { AreaTag, Icon, IconKey, ListRow, keyClasses } from "@/design-system";
import { cn } from "@/lib/cn";
import { AREAS_COPY } from "@/modules/core/areas-copy";
import type { LifeAreaSummary } from "@/modules/core/life-area-input";

export type AreaListProps = {
  areas: LifeAreaSummary[];
  /** Under prefers-reduced-motion: rows jump into place, keyboard drags scroll without easing. */
  reducedMotion: boolean;
  /** Move the area to position `to` (0-based) of the active list. */
  onMove: (id: string, to: number) => void;
  onEdit: (area: LifeAreaSummary, opener: HTMLElement) => void;
};

/**
 * The list's props for the loading state of the lazy dnd-kit layer: next/dynamic's `loading`
 * component receives no props, so it reads them from here.
 */
export const AreaListContext = createContext<AreaListProps | null>(null);

type FocusTarget = "up" | "down" | "handle";

const focusSelector = (id: string, target: FocusTarget) =>
  target === "handle"
    ? `[data-area-handle="${CSS.escape(id)}"]`
    : `[data-area-move="${target}"][data-area-id="${CSS.escape(id)}"]`;

/**
 * Keeps focus on the control that moved a row: React may re-insert the row's node when the
 * order changes, which drops focus. `request` before the move; the next commit restores it.
 */
export function useRowFocus() {
  const pending = useRef<{ id: string; target: FocusTarget } | null>(null);
  useEffect(() => {
    const request = pending.current;
    if (!request) return;
    pending.current = null;
    const element = document.querySelector<HTMLElement>(focusSelector(request.id, request.target));
    if (element && document.activeElement !== element) element.focus();
  });
  return (id: string, target: FocusTarget) => {
    pending.current = { id, target };
  };
}

/**
 * When the plain list is swapped for the sortable one (once dnd-kit has loaded), focus inside
 * it would be lost with the old nodes: remember which control had it.
 */
let focusAcrossSwap: string | null = null;

function describeFocus(list: HTMLElement | null): string | null {
  const active = document.activeElement as HTMLElement | null;
  if (!active || !list?.contains(active)) return null;
  const { areaEdit, areaHandle, areaMove, areaId } = active.dataset;
  if (areaEdit) return `[data-area-edit="${CSS.escape(areaEdit)}"]`;
  if (areaHandle) return `[data-area-handle="${CSS.escape(areaHandle)}"]`;
  if (areaMove && areaId) return focusSelector(areaId, areaMove as FocusTarget);
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
export function useMoveBy(areas: LifeAreaSummary[], onMove: AreaListProps["onMove"]) {
  const requestFocus = useRowFocus();
  return {
    requestFocus,
    moveBy(id: string, delta: -1 | 1) {
      const from = areas.findIndex((area) => area.id === id);
      const to = from + delta;
      if (from === -1 || to < 0 || to >= areas.length) return;
      requestFocus(id, delta < 0 ? "up" : "down");
      onMove(id, to);
    },
  };
}

/**
 * The list before dnd-kit loads (and its loading state): the same rows, with Subir/Bajar
 * working and the handle not yet draggable.
 */
export function PlainAreas() {
  const props = useContext(AreaListContext);
  const list = useRef<HTMLUListElement>(null);
  const { moveBy } = useMoveBy(props?.areas ?? [], props?.onMove ?? (() => {}));
  useLayoutEffect(() => {
    const element = list.current;
    return () => {
      focusAcrossSwap = describeFocus(element);
    };
  }, []);
  if (!props) return null;
  const { areas, onEdit } = props;
  return (
    <ul ref={list} aria-label={AREAS_COPY.listLabel} className="bo-list max-w-160">
      {areas.map((area, index) => (
        <li key={area.id} data-area-row={area.id} className={ROW_CLASSES}>
          <AreaRowContent
            area={area}
            first={index === 0}
            last={index === areas.length - 1}
            handleDisabled
            onEdit={onEdit}
            onMoveBy={moveBy}
          />
        </li>
      ))}
    </ul>
  );
}

export const ROW_CLASSES = "bo-area-row flex items-center gap-1 bg-surface pr-2";

/** Handle, edit button and Subir/Bajar of one row (the <li> is the caller's). */
export function AreaRowContent({
  area,
  first,
  last,
  handleRef,
  handleDisabled = false,
  handleProps,
  onEdit,
  onMoveBy,
}: {
  area: LifeAreaSummary;
  first: boolean;
  last: boolean;
  handleRef?: (element: HTMLElement | null) => void;
  /** Not draggable (dnd-kit not loaded yet, or only one area). */
  handleDisabled?: boolean;
  /** dnd-kit's attributes and listeners. */
  handleProps?: React.ButtonHTMLAttributes<HTMLButtonElement>;
  onEdit: AreaListProps["onEdit"];
  onMoveBy: (id: string, delta: -1 | 1) => void;
}) {
  return (
    <>
      <button
        ref={handleRef}
        type="button"
        {...handleProps}
        aria-label={AREAS_COPY.drag(area.name)}
        // aria-disabled, not disabled: it stays focusable and keeps its name and description.
        aria-disabled={handleDisabled || undefined}
        data-area-handle={area.id}
        className={keyClasses({
          variant: "ghost",
          className: cn("bo-key--icon bo-drag-handle", handleDisabled && "is-disabled"),
        })}
      >
        <Icon icon={GripVertical} size="md" />
      </button>
      <ListRow
        title={
          <AreaTag
            area={area.color}
            icon={area.icon}
            label={area.name}
            variant="large"
            // Long names wrap to two lines; the full name is in the tooltip.
            className="max-w-full [&>span:last-child]:line-clamp-2 [&>span:last-child]:break-words"
            title={area.name}
          />
        }
        trailing={<Icon icon={Pencil} size="sm" />}
        aria-label={AREAS_COPY.editRow(area.name)}
        aria-haspopup="dialog"
        data-area-edit={area.id}
        className="min-w-0 flex-1 pl-1"
        onClick={(event) => onEdit(area, event.currentTarget)}
      />
      <MoveKey area={area} button="up" disabled={first} onMoveBy={onMoveBy} />
      <MoveKey area={area} button="down" disabled={last} onMoveBy={onMoveBy} />
    </>
  );
}

function MoveKey({
  area,
  button,
  disabled,
  onMoveBy,
}: {
  area: LifeAreaSummary;
  button: "up" | "down";
  disabled: boolean;
  onMoveBy: (id: string, delta: -1 | 1) => void;
}) {
  const up = button === "up";
  return (
    <IconKey
      icon={up ? ArrowUp : ArrowDown}
      label={up ? AREAS_COPY.moveUp(area.name) : AREAS_COPY.moveDown(area.name)}
      variant="ghost"
      // No tooltip: the arrows speak for themselves, and the list's rounded clip (overflow:
      // hidden) would cut it at the edge. The name is still the key's aria-label.
      tooltip={false}
      data-area-move={button}
      data-area-id={area.id}
      // aria-disabled, not disabled: at the top or bottom, focus stays on the key.
      aria-disabled={disabled || undefined}
      className={cn(disabled && "is-disabled")}
      onClick={() => {
        if (!disabled) onMoveBy(area.id, up ? -1 : 1);
      }}
    />
  );
}
