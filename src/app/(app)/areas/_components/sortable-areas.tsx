"use client";

// The dnd-kit layer of the areas list. Loaded lazily (see areas-manager.tsx): until it arrives,
// the plain list (area-rows.tsx) shows the same rows with Subir/Bajar already working.
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
import { CSS as DndCSS } from "@dnd-kit/utilities";
import { useEffect, useId, useMemo, useRef } from "react";
import { cn } from "@/lib/cn";
import { DRAGGING_ATTRIBUTE } from "@/lib/shortcuts";
import { AREAS_COPY } from "@/modules/core/areas-copy";
import type { LifeAreaSummary } from "@/modules/core/life-area-input";
import {
  AreaRowContent,
  ROW_CLASSES,
  useFocusAfterSwap,
  useMoveBy,
  type AreaListProps,
} from "./area-rows";

/** Rows only move up and down. */
const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 });

function setDragging(on: boolean) {
  if (on) document.documentElement.setAttribute(DRAGGING_ATTRIBUTE, "");
  else document.documentElement.removeAttribute(DRAGGING_ATTRIBUTE);
}

/**
 * The active areas, in order, reorderable three ways: dragging the handle (mouse, or touch after
 * a short press), the keyboard on the handle (Space/Enter, arrows, Space/Enter; Esc cancels;
 * announced in Spanish), or the explicit "Subir"/"Bajar" buttons. Each row's main button edits.
 */
export default function SortableAreas({ areas, reducedMotion, onMove, onEdit }: AreaListProps) {
  const contextId = useId();
  const ids = useMemo(() => areas.map((area) => area.id), [areas]);
  const names = useMemo(() => new Map(areas.map((area) => [area.id, area.name])), [areas]);
  const { moveBy, requestFocus } = useMoveBy(areas, onMove);
  useFocusAfterSwap();
  // <html data-dragging> while a row is lifted: Esc and ⌘Z then belong to the drag.
  useEffect(() => () => setDragging(false), []);

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

  function dropped({ active, over, activatorEvent }: DragEndEvent) {
    setDragging(false);
    const id = String(active.id);
    // A keyboard drag leaves focus on the handle, wherever the row went (down too).
    if (activatorEvent instanceof KeyboardEvent) requestFocus(id, "handle");
    if (!over || active.id === over.id) return;
    const to = ids.indexOf(String(over.id));
    if (to !== -1) onMove(id, to);
  }

  return (
    <DndContext
      id={contextId}
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[verticalOnly]}
      onDragStart={() => setDragging(true)}
      onDragEnd={dropped}
      onDragCancel={() => setDragging(false)}
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
              // With a single area there is nothing to reorder.
              locked={areas.length < 2}
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

function SortableAreaRow({
  area,
  first,
  last,
  locked,
  reducedMotion,
  onEdit,
  onMoveBy,
}: {
  area: LifeAreaSummary;
  first: boolean;
  last: boolean;
  locked: boolean;
  reducedMotion: boolean;
  onEdit: AreaListProps["onEdit"];
  onMoveBy: (id: string, delta: -1 | 1) => void;
}) {
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
    disabled: locked,
    attributes: { roleDescription: AREAS_COPY.dragRole },
    // Reduced motion: no sliding, rows jump to their new place.
    transition: reducedMotion ? null : undefined,
  });

  return (
    <li
      ref={setNodeRef}
      data-area-row={area.id}
      style={{ transform: DndCSS.Translate.toString(transform), transition }}
      className={cn(ROW_CLASSES, isDragging && "relative z-10 shadow-popover")}
    >
      <AreaRowContent
        area={area}
        first={first}
        last={last}
        handleRef={setActivatorNodeRef}
        handleDisabled={locked}
        handleProps={{ ...attributes, ...listeners }}
        onEdit={onEdit}
        onMoveBy={onMoveBy}
      />
    </li>
  );
}
