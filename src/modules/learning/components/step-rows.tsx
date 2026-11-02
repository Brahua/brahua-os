"use client";

import { ArrowDown, ArrowUp, GripVertical, Pencil, Trash2 } from "lucide-react";
import { createContext, use, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { IconKey, Icon, Key, TextField, keyClasses } from "@/design-system";
import { cn } from "@/lib/cn";
import { LEARNING_COPY } from "../learning-copy";
import { STEPS_COPY } from "../steps-copy";
import { stepTitleSchema, type StepItem } from "../steps-input";

// The rows of a track's syllabus, shared by the plain list (before dnd-kit loads) and the
// sortable one (sortable-steps.tsx). The same pattern as a project's milestones (P3).

export type StepListProps = {
  steps: StepItem[];
  /** The next step (the first one not done), highlighted. */
  nextId: string | null;
  /** Under prefers-reduced-motion: rows jump into place, keyboard drags scroll without easing. */
  reducedMotion: boolean;
  /** The step being edited (its row shows the editor instead), if any. */
  editingId: string | null;
  /** Move the step to position `to` (0-based). */
  onMove: (id: string, to: number) => void;
  onToggle: (step: StepItem, done: boolean) => void;
  onEdit: (step: StepItem) => void;
  onCancelEdit: (step: StepItem) => void;
  onSave: (step: StepItem, title: string) => void;
  onDelete: (step: StepItem) => void;
};

/**
 * The list's props for the loading state of the lazy dnd-kit layer: next/dynamic's `loading`
 * component receives no props, so it reads them from here.
 */
export const StepListContext = createContext<StepListProps | null>(null);

/**
 * Every focusable control of a row carries `data-step-focus="<control>:<id>"`, so focus can be
 * found again after React re-inserts the row (a move) or swaps the whole list (dnd-kit arriving).
 */
export type FocusControl = "handle" | "check" | "edit" | "up" | "down";
export const focusSelector = (id: string, control: FocusControl) =>
  `[data-step-focus="${control}:${CSS.escape(id)}"]`;

/** A focus request older than this is dropped: it belongs to a move that never rendered. */
const FOCUS_REQUEST_TTL_MS = 100;

/** Keeps focus on the control that moved a row (`request` right before the move). */
export function useRowFocus() {
  const pending = useRef<{ id: string; control: FocusControl; at: number } | null>(null);
  useEffect(() => {
    const request = pending.current;
    if (!request) return;
    pending.current = null;
    if (performance.now() - request.at > FOCUS_REQUEST_TTL_MS) return;
    const element = document.querySelector<HTMLElement>(focusSelector(request.id, request.control));
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
  const key = active.dataset.stepFocus;
  return key ? `[data-step-focus="${CSS.escape(key)}"]` : null;
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
export function useMoveBy(steps: StepItem[], onMove: StepListProps["onMove"]) {
  const requestFocus = useRowFocus();
  return {
    requestFocus,
    moveBy(id: string, delta: -1 | 1) {
      const from = steps.findIndex((step) => step.id === id);
      const to = from + delta;
      if (from === -1 || to < 0 || to >= steps.length) return;
      requestFocus(id, delta < 0 ? "up" : "down");
      onMove(id, to);
    },
  };
}

export const ROW_CLASSES = "bo-milestone-row flex items-center gap-1 bg-surface pr-2";

/**
 * The list before dnd-kit loads (and its loading state): the same rows, with Subir/Bajar working
 * and the handle not yet draggable.
 */
export function PlainSteps() {
  const props = use(StepListContext);
  const list = useRef<HTMLUListElement>(null);
  const { moveBy } = useMoveBy(props?.steps ?? [], props?.onMove ?? (() => {}));
  useLayoutEffect(() => {
    const element = list.current;
    return () => {
      focusAcrossSwap = describeFocus(element);
    };
  }, []);
  if (!props) return null;
  const { steps, editingId } = props;
  return (
    <ul ref={list} aria-label={STEPS_COPY.listLabel} className="bo-list">
      {steps.map((step, index) => (
        <li
          key={step.id}
          data-step-row={step.id}
          className={cn(ROW_CLASSES, editingId === step.id && "p-4")}
        >
          <StepRowContent
            {...props}
            step={step}
            first={index === 0}
            last={index === steps.length - 1}
            handleDisabled
            onMoveBy={moveBy}
          />
        </li>
      ))}
    </ul>
  );
}

type RowContentProps = StepListProps & {
  step: StepItem;
  first: boolean;
  last: boolean;
  handleRef?: (element: HTMLElement | null) => void;
  /** Not draggable (dnd-kit not loaded yet, a single step, or one is being edited). */
  handleDisabled?: boolean;
  /** dnd-kit's attributes and listeners. */
  handleProps?: React.ButtonHTMLAttributes<HTMLButtonElement>;
  onMoveBy: (id: string, delta: -1 | 1) => void;
};

/** Handle, checkbox, title (edits) and Subir/Bajar of one row, or its editor (the <li> is the caller's). */
export function StepRowContent(props: RowContentProps) {
  const {
    step,
    nextId,
    first,
    last,
    handleRef,
    handleDisabled = false,
    handleProps,
    editingId,
    onToggle,
    onEdit,
    onMoveBy,
  } = props;
  const nextLabelId = useId();
  if (editingId === step.id) return <StepEditor {...props} />;
  const done = step.doneAt !== null;
  const isNext = step.id === nextId;
  const { title, id } = step;
  return (
    <>
      <button
        ref={handleRef}
        type="button"
        {...handleProps}
        aria-label={STEPS_COPY.drag(title)}
        // aria-disabled, not disabled: it stays focusable and keeps its name and description.
        aria-disabled={handleDisabled || undefined}
        data-step-focus={`handle:${id}`}
        className={keyClasses({
          variant: "ghost",
          className: cn("bo-key--icon bo-drag-handle", handleDisabled && "is-disabled"),
        })}
      >
        <Icon icon={GripVertical} size="md" />
      </button>
      {/* A label: the whole 44 px square toggles the 20 px checkbox. */}
      <label className="flex size-11 shrink-0 cursor-pointer items-center justify-center">
        <input
          type="checkbox"
          className="bo-milestone-check"
          checked={done}
          aria-label={STEPS_COPY.check(title)}
          data-step-focus={`check:${id}`}
          onChange={(event) => onToggle(step, event.target.checked)}
        />
      </label>
      <button
        type="button"
        aria-label={STEPS_COPY.edit(title)}
        aria-describedby={isNext ? nextLabelId : undefined}
        data-step-focus={`edit:${id}`}
        data-step-next={isNext || undefined}
        className="bo-milestone-title flex min-h-11 min-w-0 flex-1 flex-col items-start justify-center gap-0.5 rounded-md px-2 py-2 text-left"
        onClick={() => onEdit(step)}
      >
        {isNext ? (
          <span id={nextLabelId} className="bo-text-label text-signal-text">
            {STEPS_COPY.next}
          </span>
        ) : null}
        <span
          className={cn(
            "bo-text-body max-w-full break-words",
            isNext && "font-medium",
            done && "text-text-secondary line-through",
          )}
        >
          {title}
        </span>
      </button>
      {/* That the title edits, at a glance (no room for it under 360 px; the name says it). */}
      <Icon icon={Pencil} size="sm" className="shrink-0 text-text-secondary max-[359px]:hidden" />
      <MoveKey step={step} button="up" disabled={first} onMoveBy={onMoveBy} />
      <MoveKey step={step} button="down" disabled={last} onMoveBy={onMoveBy} />
    </>
  );
}

function MoveKey({
  step,
  button,
  disabled,
  onMoveBy,
}: {
  step: StepItem;
  button: "up" | "down";
  disabled: boolean;
  onMoveBy: (id: string, delta: -1 | 1) => void;
}) {
  const up = button === "up";
  return (
    <IconKey
      icon={up ? ArrowUp : ArrowDown}
      label={up ? STEPS_COPY.moveUp(step.title) : STEPS_COPY.moveDown(step.title)}
      variant="ghost"
      // No tooltip: the list clips with overflow: hidden (as in the milestones).
      tooltip={false}
      data-step-focus={`${button}:${step.id}`}
      // aria-disabled, not disabled: at the top or bottom, focus stays on the key.
      aria-disabled={disabled || undefined}
      className={cn(disabled && "is-disabled")}
      onClick={() => {
        if (!disabled) onMoveBy(step.id, up ? -1 : 1);
      }}
    />
  );
}

/** The title of one step, edited in its row, plus «Quitar paso». Enter saves, Esc cancels. */
function StepEditor({ step, onCancelEdit, onSave, onDelete }: RowContentProps) {
  const [title, setTitle] = useState(step.title);
  const [error, setError] = useState<string | undefined>();
  const ids = useId();

  function submit() {
    const parsed = stepTitleSchema.safeParse(title);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      document.getElementById(`${ids}-title`)?.focus();
      return;
    }
    onSave(step, parsed.data);
  }

  return (
    <form
      noValidate
      aria-label={STEPS_COPY.editForm}
      className="flex min-w-0 flex-1 flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        // The notice viewport also listens for Esc on the document: this one is the editor's.
        event.preventDefault();
        event.stopPropagation();
        onCancelEdit(step);
      }}
    >
      <TextField
        id={`${ids}-title`}
        label={STEPS_COPY.titleLabel}
        value={title}
        autoFocus
        autoComplete="off"
        error={error}
        help={STEPS_COPY.titleHelp}
        onChange={(event) => {
          setTitle(event.target.value);
          setError(undefined);
        }}
      />
      <p role="status" className="sr-only">
        {error ?? ""}
      </p>
      <div className="flex flex-wrap gap-2">
        <Key type="submit" variant="signal">
          {LEARNING_COPY.save}
        </Key>
        <Key variant="ghost" onClick={() => onCancelEdit(step)}>
          {LEARNING_COPY.cancel}
        </Key>
      </div>
      <Key
        variant="ghost"
        icon={Trash2}
        className="self-start"
        data-step-delete={step.id}
        onClick={() => onDelete(step)}
      >
        {STEPS_COPY.remove}
      </Key>
    </form>
  );
}
