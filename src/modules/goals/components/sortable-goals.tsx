"use client";

// The dnd-kit layer of "Ordenar" (SPEC-goals "Orden"). Loaded lazily and only in the browser
// (see goals-list.tsx), once "Ordenar" is pressed. The same pattern as `sortable-habits.tsx`: a
// handle (mouse, touch after a short press, or the keyboard on it) and the explicit
// "Subir"/"Bajar" keys, all announced in Spanish.
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
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { useEffect, useId, useMemo, useRef } from "react";
import { AREA_ICONS, Icon, IconKey, Led, keyClasses } from "@/design-system";
import { cn } from "@/lib/cn";
import { setDragging, verticalOnly } from "@/lib/sortable";
import type { GoalItem } from "../goal-input";
import { GOALS_COPY } from "../goals-copy";

export type GoalOrderListProps = {
  /** The heading of the section ("Este año (2026)"): names the list. */
  heading: string;
  /** The goals of one section, in their manual order. */
  goals: GoalItem[];
  /** Under prefers-reduced-motion: rows jump into place, keyboard drags scroll without easing. */
  reducedMotion: boolean;
  /** Move the goal to position `to` (0-based) of this section. */
  onMove: (id: string, to: number) => void;
};

type FocusTarget = "up" | "down" | "handle";

const focusSelector = (id: string, target: FocusTarget) =>
  target === "handle"
    ? `[data-goal-handle="${CSS.escape(id)}"]`
    : `[data-goal-move="${target}"][data-goal-id="${CSS.escape(id)}"]`;

/** A focus request older than this is dropped: it belongs to a move that never rendered. */
const FOCUS_REQUEST_TTL_MS = 100;

/**
 * Keeps focus on the control that moved a row: React may re-insert the row's node when the order
 * changes, which drops focus. `request` right before the move; the commit it causes restores it.
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

/** Every goal of a section, reorderable: the handle, or the "Subir"/"Bajar" keys. */
export default function SortableGoals({
  heading,
  goals,
  reducedMotion,
  onMove,
}: GoalOrderListProps) {
  const contextId = useId();
  const ids = useMemo(() => goals.map((goal) => goal.id), [goals]);
  const titles = useMemo(() => new Map(goals.map((goal) => [goal.id, goal.title])), [goals]);
  const requestFocus = useRowFocus();
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

  // Where the lifted goal was last announced: dnd-kit also reports the starting position as a
  // move, which would talk over "Tomaste…".
  const lastOver = useRef<UniqueIdentifier | null>(null);
  const announcements = useMemo<Announcements>(() => {
    const title = (id: UniqueIdentifier) => titles.get(String(id)) ?? "";
    const place = (id: UniqueIdentifier | undefined) =>
      GOALS_COPY.position(id === undefined ? -1 : ids.indexOf(String(id)), ids.length);
    return {
      onDragStart: ({ active }) => {
        lastOver.current = active.id;
        return GOALS_COPY.dragStart(title(active.id), place(active.id));
      },
      onDragOver: ({ active, over }) => {
        if (!over || over.id === lastOver.current) return undefined;
        lastOver.current = over.id;
        return GOALS_COPY.dragOver(title(active.id), place(over.id));
      },
      // A real move is announced by the notice that shows with "Deshacer".
      onDragEnd: ({ active, over }) =>
        !over || over.id === active.id
          ? GOALS_COPY.dragSame(title(active.id), place(active.id))
          : undefined,
      onDragCancel: ({ active }) => GOALS_COPY.dragCancel(title(active.id), place(active.id)),
    };
  }, [ids, titles]);

  function moveBy(id: string, delta: -1 | 1) {
    const from = ids.indexOf(id);
    const to = from + delta;
    if (from === -1 || to < 0 || to >= ids.length) return;
    requestFocus(id, delta < 0 ? "up" : "down");
    onMove(id, to);
  }

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
        screenReaderInstructions: { draggable: GOALS_COPY.dragInstructions },
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul aria-label={GOALS_COPY.orderList(heading)} className="bo-list max-w-160">
          {goals.map((goal, index) => (
            <SortableGoalRow
              key={goal.id}
              goal={goal}
              first={index === 0}
              last={index === goals.length - 1}
              locked={goals.length < 2}
              reducedMotion={reducedMotion}
              onMoveBy={moveBy}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function SortableGoalRow({
  goal,
  first,
  last,
  locked,
  reducedMotion,
  onMoveBy,
}: {
  goal: GoalItem;
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
    id: goal.id,
    disabled: locked,
    attributes: { roleDescription: GOALS_COPY.dragRole },
    // Reduced motion: no sliding, rows jump to their new place.
    transition: reducedMotion ? null : undefined,
  });
  const { area } = goal;

  return (
    <li
      ref={setNodeRef}
      data-goal-order-row={goal.id}
      style={{ transform: DndCSS.Translate.toString(transform), transition }}
      className={cn(
        "flex min-h-14 items-center gap-1 bg-surface pr-2",
        isDragging && "relative z-10 shadow-popover",
      )}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        aria-label={GOALS_COPY.drag(goal.title)}
        // aria-disabled, not disabled: it stays focusable and keeps its name and description.
        aria-disabled={locked || undefined}
        data-goal-handle={goal.id}
        className={keyClasses({
          variant: "ghost",
          className: cn("bo-key--icon bo-drag-handle", locked && "is-disabled"),
        })}
      >
        <Icon icon={GripVertical} size="md" />
      </button>
      <span className="bo-text-body flex min-w-0 flex-1 items-center gap-2 pl-1">
        <Led area={area?.color} on />
        {area ? <Icon icon={AREA_ICONS[area.icon]} size="sm" aria-hidden /> : null}
        <span className="line-clamp-2 break-words" title={goal.title}>
          {goal.title}
        </span>
      </span>
      <MoveKey goal={goal} button="up" disabled={first} onMoveBy={onMoveBy} />
      <MoveKey goal={goal} button="down" disabled={last} onMoveBy={onMoveBy} />
    </li>
  );
}

function MoveKey({
  goal,
  button,
  disabled,
  onMoveBy,
}: {
  goal: GoalItem;
  button: "up" | "down";
  disabled: boolean;
  onMoveBy: (id: string, delta: -1 | 1) => void;
}) {
  const up = button === "up";
  return (
    <IconKey
      icon={up ? ArrowUp : ArrowDown}
      label={up ? GOALS_COPY.moveUp(goal.title) : GOALS_COPY.moveDown(goal.title)}
      variant="ghost"
      // No tooltip: the list's rounded clip would cut it; the title is the key's aria-label.
      tooltip={false}
      data-goal-move={button}
      data-goal-id={goal.id}
      // aria-disabled, not disabled: at the top or bottom, focus stays on the key.
      aria-disabled={disabled || undefined}
      className={cn(disabled && "is-disabled")}
      onClick={() => {
        if (!disabled) onMoveBy(goal.id, up ? -1 : 1);
      }}
    />
  );
}
