"use client";

// The dnd-kit layer of a track's syllabus. Loaded lazily (see steps-section.tsx): until it
// arrives, the plain list (step-rows.tsx) shows the same rows with Subir/Bajar already working.
// The same pattern as a project's milestones (sortable-milestones.tsx).
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
import { STEPS_COPY } from "../steps-copy";
import type { StepItem } from "../steps-input";
import {
  ROW_CLASSES,
  StepRowContent,
  useFocusAfterSwap,
  useMoveBy,
  type StepListProps,
} from "./step-rows";

/**
 * The steps, in order, reorderable three ways: dragging the handle (mouse, or touch after a short
 * press), the keyboard on the handle (Space/Enter, arrows, Space/Enter; Esc cancels; announced in
 * Spanish), or the explicit «Subir»/«Bajar» keys.
 */
export default function SortableSteps(props: StepListProps) {
  const { steps, reducedMotion, onMove, editingId } = props;
  const contextId = useId();
  const ids = useMemo(() => steps.map((step) => step.id), [steps]);
  const titles = useMemo(() => new Map(steps.map((step) => [step.id, step.title])), [steps]);
  const { moveBy, requestFocus } = useMoveBy(steps, onMove);
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

  // Where the lifted step was last announced: dnd-kit also reports the starting position as a
  // move, which would talk over «Tomaste…».
  const lastOver = useRef<UniqueIdentifier | null>(null);
  const announcements = useMemo<Announcements>(() => {
    const title = (id: UniqueIdentifier) => titles.get(String(id)) ?? "";
    const place = (id: UniqueIdentifier | undefined) =>
      STEPS_COPY.position(id === undefined ? -1 : ids.indexOf(String(id)), ids.length);
    return {
      onDragStart: ({ active }) => {
        lastOver.current = active.id;
        return STEPS_COPY.dragStart(title(active.id), place(active.id));
      },
      onDragOver: ({ active, over }) => {
        if (!over || over.id === lastOver.current) return undefined;
        lastOver.current = over.id;
        return STEPS_COPY.dragOver(title(active.id), place(over.id));
      },
      // A real move is announced by the notice that shows with «Deshacer».
      onDragEnd: ({ active, over }) =>
        !over || over.id === active.id
          ? STEPS_COPY.dragSame(title(active.id), place(active.id))
          : undefined,
      onDragCancel: ({ active }) => STEPS_COPY.dragCancel(title(active.id), place(active.id)),
    };
  }, [ids, titles]);

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
        screenReaderInstructions: { draggable: STEPS_COPY.dragInstructions },
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul aria-label={STEPS_COPY.listLabel} className="bo-list">
          {steps.map((step, index) => (
            <SortableStepRow
              key={step.id}
              {...props}
              step={step}
              first={index === 0}
              last={index === steps.length - 1}
              // Nothing to reorder with a single step, nor while one is being edited.
              locked={steps.length < 2 || editingId !== null}
              onMoveBy={moveBy}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function SortableStepRow(
  props: StepListProps & {
    step: StepItem;
    first: boolean;
    last: boolean;
    locked: boolean;
    onMoveBy: (id: string, delta: -1 | 1) => void;
  },
) {
  const { step, locked, reducedMotion, editingId } = props;
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: step.id,
    disabled: locked,
    attributes: { roleDescription: STEPS_COPY.dragRole },
    // Reduced motion: no sliding, rows jump to their new place.
    transition: reducedMotion ? null : undefined,
  });

  return (
    <li
      ref={setNodeRef}
      data-step-row={step.id}
      style={{ transform: DndCSS.Translate.toString(transform), transition }}
      className={cn(
        ROW_CLASSES,
        editingId === step.id && "p-4",
        isDragging && "relative z-10 shadow-popover",
      )}
    >
      <StepRowContent
        {...props}
        handleRef={setActivatorNodeRef}
        handleDisabled={locked}
        handleProps={{ ...attributes, ...listeners }}
      />
    </li>
  );
}
