"use client";

// The dnd-kit layer of "Ordenar hábitos" (H2). Loaded lazily (see habits-today.tsx): until it
// arrives, the plain list (habit-order-rows.tsx) shows the same rows with Subir/Bajar already
// working. The same pattern as the areas list (sortable-areas.tsx).
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
import { setDragging, verticalOnly } from "@/lib/sortable";
import type { HabitItem } from "../habit-input";
import { ORGANIZE_COPY } from "../organize-copy";
import {
  HabitOrderRow,
  ROW_CLASSES,
  useFocusAfterSwap,
  useMoveBy,
  type HabitOrderListProps,
} from "./habit-order-rows";

/**
 * Every active habit, in order, reorderable three ways: dragging the handle (mouse, or touch
 * after a short press), the keyboard on the handle (Space/Enter, arrows, Space/Enter; Esc
 * cancels; announced in Spanish), or the explicit "Subir"/"Bajar" keys.
 */
export default function SortableHabits({ habits, reducedMotion, onMove }: HabitOrderListProps) {
  const contextId = useId();
  const ids = useMemo(() => habits.map((habit) => habit.id), [habits]);
  const names = useMemo(() => new Map(habits.map((habit) => [habit.id, habit.name])), [habits]);
  const { moveBy, requestFocus } = useMoveBy(habits, onMove);
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

  // Where the lifted habit was last announced: dnd-kit also reports the starting position as a
  // move, which would talk over "Tomaste…".
  const lastOver = useRef<UniqueIdentifier | null>(null);
  const announcements = useMemo<Announcements>(() => {
    const name = (id: UniqueIdentifier) => names.get(String(id)) ?? "";
    const place = (id: UniqueIdentifier | undefined) =>
      ORGANIZE_COPY.position(id === undefined ? -1 : ids.indexOf(String(id)), ids.length);
    return {
      onDragStart: ({ active }) => {
        lastOver.current = active.id;
        return ORGANIZE_COPY.dragStart(name(active.id), place(active.id));
      },
      onDragOver: ({ active, over }) => {
        if (!over || over.id === lastOver.current) return undefined;
        lastOver.current = over.id;
        return ORGANIZE_COPY.dragOver(name(active.id), place(over.id));
      },
      // A real move is announced by the notice that shows with "Deshacer".
      onDragEnd: ({ active, over }) =>
        !over || over.id === active.id
          ? ORGANIZE_COPY.dragSame(name(active.id), place(active.id))
          : undefined,
      onDragCancel: ({ active }) => ORGANIZE_COPY.dragCancel(name(active.id), place(active.id)),
    };
  }, [ids, names]);

  function dropped({ active, over, activatorEvent }: DragEndEvent) {
    setDragging(false);
    const id = String(active.id);
    if (!over || active.id === over.id) return;
    const to = ids.indexOf(String(over.id));
    if (to === -1) return;
    // A keyboard drag leaves focus on the handle, wherever the row went.
    if (activatorEvent instanceof KeyboardEvent) requestFocus(id, "handle");
    onMove(id, to);
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
        screenReaderInstructions: { draggable: ORGANIZE_COPY.dragInstructions },
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul aria-label={ORGANIZE_COPY.orderList} className="bo-list max-w-160">
          {habits.map((habit, index) => (
            <SortableHabitRow
              key={habit.id}
              habit={habit}
              first={index === 0}
              last={index === habits.length - 1}
              locked={habits.length < 2}
              reducedMotion={reducedMotion}
              onMoveBy={moveBy}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function SortableHabitRow({
  habit,
  first,
  last,
  locked,
  reducedMotion,
  onMoveBy,
}: {
  habit: HabitItem;
  first: boolean;
  last: boolean;
  locked: boolean;
  reducedMotion: boolean;
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
    id: habit.id,
    disabled: locked,
    attributes: { roleDescription: ORGANIZE_COPY.dragRole },
    // Reduced motion: no sliding, rows jump to their new place.
    transition: reducedMotion ? null : undefined,
  });

  return (
    <li
      ref={setNodeRef}
      data-habit-row={habit.id}
      style={{ transform: DndCSS.Translate.toString(transform), transition }}
      className={cn(ROW_CLASSES, isDragging && "relative z-10 shadow-popover")}
    >
      <HabitOrderRow
        habit={habit}
        first={first}
        last={last}
        handleRef={setActivatorNodeRef}
        handleDisabled={locked}
        handleProps={{ ...attributes, ...listeners }}
        onMoveBy={onMoveBy}
      />
    </li>
  );
}
