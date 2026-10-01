"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type Modifier,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, GripVertical, Pencil } from "lucide-react";
import { useEffect, useId, useMemo, useRef } from "react";
import { AreaTag, Icon, IconKey, ListRow, keyClasses } from "@/design-system";
import { cn } from "@/lib/cn";
import { AREAS_COPY } from "@/modules/core/areas-copy";
import type { LifeAreaSummary } from "@/modules/core/life-area-input";

/** Rows only move up and down. */
const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 });

type SortableAreasProps = {
  areas: LifeAreaSummary[];
  /** Under prefers-reduced-motion: rows jump into place, keyboard drags scroll without easing. */
  reducedMotion: boolean;
  /** Move the area to position `to` (0-based) of the active list. */
  onMove: (id: string, to: number) => void;
  onEdit: (area: LifeAreaSummary, opener: HTMLElement) => void;
};

type MoveButton = "up" | "down";

/**
 * The active areas, in order, reorderable three ways: dragging the handle (mouse, or touch after
 * a short press), the keyboard on the handle (Space/Enter, arrows, Space/Enter; Esc cancels;
 * announced in Spanish), or the explicit "Subir"/"Bajar" buttons. Each row's main button edits.
 */
export function SortableAreas({ areas, reducedMotion, onMove, onEdit }: SortableAreasProps) {
  const contextId = useId();
  const ids = useMemo(() => areas.map((area) => area.id), [areas]);
  const names = useMemo(() => new Map(areas.map((area) => [area.id, area.name])), [areas]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    // A short press first, so a swipe over the handle still scrolls the page.
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      scrollBehavior: reducedMotion ? "auto" : "smooth",
    }),
  );

  // Where the lifted area was last announced: dnd-kit also reports the starting position as a
  // move, which would talk over "Tomaste…".
  const lastOver = useRef<UniqueIdentifier | null>(null);
  const announcements = useMemo<Announcements>(() => {
    const name = (id: UniqueIdentifier) => names.get(String(id)) ?? "";
    const place = (id: UniqueIdentifier | undefined) =>
      AREAS_COPY.position(id === undefined ? -1 : ids.indexOf(String(id)), ids.length);
    return {
      onDragStart: ({ active }) => {
        lastOver.current = active.id;
        return AREAS_COPY.dragStart(name(active.id), place(active.id));
      },
      onDragOver: ({ active, over }) => {
        if (!over || over.id === lastOver.current) return undefined;
        lastOver.current = over.id;
        return AREAS_COPY.dragOver(name(active.id), place(over.id));
      },
      // A real move is announced by the notice that shows with "Deshacer".
      onDragEnd: ({ active, over }) =>
        !over || over.id === active.id
          ? AREAS_COPY.dragSame(name(active.id), place(active.id))
          : undefined,
      onDragCancel: ({ active }) => AREAS_COPY.dragCancel(name(active.id), place(active.id)),
    };
  }, [ids, names]);

  // After "Subir"/"Bajar" the row moves; React may re-insert its node, which drops focus.
  const pendingFocus = useRef<{ id: string; button: MoveButton } | null>(null);
  useEffect(() => {
    const request = pendingFocus.current;
    if (!request) return;
    pendingFocus.current = null;
    const button = document.querySelector<HTMLElement>(
      `[data-area-move="${request.button}"][data-area-id="${request.id}"]`,
    );
    if (button && document.activeElement !== button) button.focus({ preventScroll: false });
  });

  function moveBy(id: string, delta: -1 | 1) {
    const from = ids.indexOf(id);
    const to = from + delta;
    if (from === -1 || to < 0 || to >= ids.length) return;
    pendingFocus.current = { id, button: delta < 0 ? "up" : "down" };
    onMove(id, to);
  }

  function dropped({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const to = ids.indexOf(String(over.id));
    if (to !== -1) onMove(String(active.id), to);
  }

  return (
    <DndContext
      id={contextId}
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[verticalOnly]}
      onDragEnd={dropped}
      accessibility={{
        announcements,
        screenReaderInstructions: { draggable: AREAS_COPY.dragInstructions },
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul aria-label={AREAS_COPY.listLabel} className="bo-list max-w-160">
          {areas.map((area, index) => (
            <SortableAreaRow
              key={area.id}
              area={area}
              first={index === 0}
              last={index === areas.length - 1}
              reducedMotion={reducedMotion}
              onEdit={onEdit}
              onMoveBy={moveBy}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

type SortableAreaRowProps = {
  area: LifeAreaSummary;
  first: boolean;
  last: boolean;
  reducedMotion: boolean;
  onEdit: (area: LifeAreaSummary, opener: HTMLElement) => void;
  onMoveBy: (id: string, delta: -1 | 1) => void;
};

function SortableAreaRow({
  area,
  first,
  last,
  reducedMotion,
  onEdit,
  onMoveBy,
}: SortableAreaRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: area.id,
    attributes: { roleDescription: AREAS_COPY.dragRole },
    // Reduced motion: no sliding, rows jump to their new place.
    transition: reducedMotion ? null : undefined,
  });

  return (
    <li
      ref={setNodeRef}
      data-area-row={area.id}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "flex items-center gap-1 bg-surface pr-2",
        isDragging && "relative z-10 shadow-popover",
      )}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        aria-label={AREAS_COPY.drag(area.name)}
        className={keyClasses({ variant: "ghost", className: "bo-key--icon bo-drag-handle" })}
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
    </li>
  );
}

function MoveKey({
  area,
  button,
  disabled,
  onMoveBy,
}: {
  area: LifeAreaSummary;
  button: MoveButton;
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
