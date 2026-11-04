"use client";

// The dnd-kit layer of `health`'s reorderable lists. Loaded lazily (see routines-section.tsx and
// routine-items-section.tsx): until it arrives, the plain list (order-rows.tsx) shows the same
// rows with Subir/Bajar already working. The same pattern as a track's syllabus
// (learning's sortable-steps.tsx).
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
import { ROUTINES_COPY as COPY } from "../routines-copy";
import {
  OrderRowContent,
  ROW_CLASSES,
  useFocusAfterSwap,
  useMoveBy,
  type OrderItem,
  type OrderListProps,
} from "./order-rows";

/**
 * The rows, in order, reorderable three ways: dragging the handle (mouse, or touch after a short
 * press), the keyboard on the handle (Space/Enter, arrows, Space/Enter; Esc cancels; announced in
 * Spanish), or the explicit «Subir»/«Bajar» keys.
 */
export default function SortableRows<T extends OrderItem>(props: OrderListProps<T>) {
  const { items, label, reducedMotion, onMove, locked = false, renderEditor } = props;
  const contextId = useId();
  const ids = useMemo(() => items.map((item) => item.id), [items]);
  const names = useMemo(() => new Map(items.map((item) => [item.id, item.name])), [items]);
  const { moveBy, requestFocus } = useMoveBy(items, onMove);
  useFocusAfterSwap();
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

  // Where the lifted row was last announced: dnd-kit also reports the starting position as a
  // move, which would talk over «Tomaste…».
  const lastOver = useRef<UniqueIdentifier | null>(null);
  const announcements = useMemo<Announcements>(() => {
    const name = (id: UniqueIdentifier) => names.get(String(id)) ?? "";
    const place = (id: UniqueIdentifier | undefined) =>
      COPY.position(id === undefined ? -1 : ids.indexOf(String(id)), ids.length);
    return {
      onDragStart: ({ active }) => {
        lastOver.current = active.id;
        return COPY.dragStart(name(active.id), place(active.id));
      },
      onDragOver: ({ active, over }) => {
        if (!over || over.id === lastOver.current) return undefined;
        lastOver.current = over.id;
        return COPY.dragOver(name(active.id), place(over.id));
      },
      // A real move is announced by the notice that shows with «Deshacer».
      onDragEnd: ({ active, over }) =>
        !over || over.id === active.id
          ? COPY.dragSame(name(active.id), place(active.id))
          : undefined,
      onDragCancel: ({ active }) => COPY.dragCancel(name(active.id), place(active.id)),
    };
  }, [ids, names]);

  function dropped({ active, over, activatorEvent }: DragEndEvent) {
    setDragging(false);
    const id = String(active.id);
    if (!over || active.id === over.id) return;
    const to = ids.indexOf(String(over.id));
    if (to === -1) return;
    // A keyboard drag leaves focus on the handle, wherever the row went (down too).
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
        screenReaderInstructions: { draggable: COPY.dragInstructions },
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul aria-label={label} className="bo-list">
          {items.map((item, index) => (
            <SortableRow
              key={item.id}
              {...props}
              item={item}
              editor={renderEditor?.(item)}
              first={index === 0}
              last={index === items.length - 1}
              // Nothing to reorder with a single row, nor while one is being edited.
              rowLocked={items.length < 2 || locked}
              onMoveBy={moveBy}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function SortableRow<T extends OrderItem>(
  props: OrderListProps<T> & {
    item: T;
    editor: React.ReactNode;
    first: boolean;
    last: boolean;
    rowLocked: boolean;
    onMoveBy: (id: string, delta: -1 | 1) => void;
  },
) {
  const { item, editor, rowLocked, reducedMotion, dragRole, locked } = props;
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: item.id,
    disabled: rowLocked,
    attributes: { roleDescription: dragRole },
    // Reduced motion: no sliding, rows jump to their new place.
    transition: reducedMotion ? null : undefined,
  });

  return (
    <li
      ref={setNodeRef}
      data-order-row={item.id}
      style={{ transform: DndCSS.Translate.toString(transform), transition }}
      className={cn(
        ROW_CLASSES,
        editor ? "p-4" : null,
        isDragging && "relative z-10 shadow-popover",
      )}
    >
      {editor ?? (
        <OrderRowContent
          {...props}
          handleRef={setActivatorNodeRef}
          handleDisabled={rowLocked}
          moveDisabled={locked}
          handleProps={{ ...attributes, ...listeners }}
        />
      )}
    </li>
  );
}
