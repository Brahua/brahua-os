"use client";

import { ArrowDown, ArrowUp, GripVertical, Pencil, Trash2 } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Icon, IconKey, Key, TextField, keyClasses } from "@/design-system";
import { cn } from "@/lib/cn";
import { formatDateKey } from "@/lib/time";
import {
  updateMilestoneInputSchema,
  type ProjectMilestoneItem,
} from "@/modules/projects/milestone-input";
import { MILESTONES_COPY } from "@/modules/projects/milestones-copy";
import { EditorForm, fieldErrorsOf } from "./inline-editor";

// The rows of a project's milestones, shared by the plain list (before dnd-kit loads) and the
// sortable one (sortable-milestones.tsx). Same pattern as the areas list (C6).

export type MilestoneListProps = {
  projectId: string;
  milestones: ProjectMilestoneItem[];
  /** Under prefers-reduced-motion: rows jump into place, keyboard drags scroll without easing. */
  reducedMotion: boolean;
  /** The milestone being edited (its row shows the editor instead), if any. */
  editingId: string | null;
  /** Move the milestone to position `to` (0-based). */
  onMove: (id: string, to: number) => void;
  onToggle: (milestone: ProjectMilestoneItem, done: boolean) => void;
  onEdit: (milestone: ProjectMilestoneItem) => void;
  onCancelEdit: (milestone: ProjectMilestoneItem) => void;
  onSave: (milestone: ProjectMilestoneItem, title: string, dueDate: string | null) => void;
  onDelete: (milestone: ProjectMilestoneItem) => void;
};

/**
 * The list's props for the loading state of the lazy dnd-kit layer: next/dynamic's `loading`
 * component receives no props, so it reads them from here.
 */
export const MilestoneListContext = createContext<MilestoneListProps | null>(null);

/**
 * Every focusable control of a row carries `data-milestone-focus="<control>:<id>"`, so focus can
 * be found again after React re-inserts the row (a move) or swaps the whole list (dnd-kit
 * arriving).
 */
export type FocusControl = "handle" | "check" | "edit" | "up" | "down";
export const focusSelector = (id: string, control: FocusControl) =>
  `[data-milestone-focus="${control}:${CSS.escape(id)}"]`;

/** A focus request older than this is dropped: it belongs to a move that never rendered. */
const FOCUS_REQUEST_TTL_MS = 100;

/**
 * Keeps focus on the control that moved a row: `request` right before the move; the commit it
 * causes restores it. A request no commit picks up soon is dropped.
 */
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
  const key = active.dataset.milestoneFocus;
  return key ? `[data-milestone-focus="${CSS.escape(key)}"]` : null;
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
export function useMoveBy(
  milestones: ProjectMilestoneItem[],
  onMove: MilestoneListProps["onMove"],
) {
  const requestFocus = useRowFocus();
  return {
    requestFocus,
    moveBy(id: string, delta: -1 | 1) {
      const from = milestones.findIndex((milestone) => milestone.id === id);
      const to = from + delta;
      if (from === -1 || to < 0 || to >= milestones.length) return;
      requestFocus(id, delta < 0 ? "up" : "down");
      onMove(id, to);
    },
  };
}

export const ROW_CLASSES = "bo-milestone-row flex items-center gap-1 bg-surface pr-2";

/**
 * The list before dnd-kit loads (and its loading state): the same rows, with Subir/Bajar
 * working and the handle not yet draggable.
 */
export function PlainMilestones() {
  const props = useContext(MilestoneListContext);
  const list = useRef<HTMLUListElement>(null);
  const { moveBy } = useMoveBy(props?.milestones ?? [], props?.onMove ?? (() => {}));
  useLayoutEffect(() => {
    const element = list.current;
    return () => {
      focusAcrossSwap = describeFocus(element);
    };
  }, []);
  if (!props) return null;
  const { milestones, editingId } = props;
  return (
    <ul ref={list} aria-label={MILESTONES_COPY.listLabel} className="bo-list">
      {milestones.map((milestone, index) => (
        <li
          key={milestone.id}
          data-milestone-row={milestone.id}
          className={cn(ROW_CLASSES, editingId === milestone.id && "p-4")}
        >
          <MilestoneRowContent
            {...props}
            milestone={milestone}
            first={index === 0}
            last={index === milestones.length - 1}
            handleDisabled
            onMoveBy={moveBy}
          />
        </li>
      ))}
    </ul>
  );
}

type RowContentProps = MilestoneListProps & {
  milestone: ProjectMilestoneItem;
  first: boolean;
  last: boolean;
  handleRef?: (element: HTMLElement | null) => void;
  /** Not draggable (dnd-kit not loaded yet, or a single milestone). */
  handleDisabled?: boolean;
  /** dnd-kit's attributes and listeners. */
  handleProps?: React.ButtonHTMLAttributes<HTMLButtonElement>;
  onMoveBy: (id: string, delta: -1 | 1) => void;
};

/** Handle, checkbox, title (edits) and Subir/Bajar of one row, or its editor (the <li> is the caller's). */
export function MilestoneRowContent(props: RowContentProps) {
  const {
    milestone,
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
  const dueId = useId();
  if (editingId === milestone.id) return <MilestoneEditor {...props} />;
  const done = milestone.doneAt !== null;
  const { title, id } = milestone;
  return (
    <>
      <button
        ref={handleRef}
        type="button"
        {...handleProps}
        aria-label={MILESTONES_COPY.drag(title)}
        // aria-disabled, not disabled: it stays focusable and keeps its name and description.
        aria-disabled={handleDisabled || undefined}
        data-milestone-focus={`handle:${id}`}
        className={keyClasses({
          variant: "ghost",
          className: cn("bo-key--icon bo-drag-handle", handleDisabled && "is-disabled"),
        })}
      >
        <Icon icon={GripVertical} size="md" />
      </button>
      <label className="flex size-11 shrink-0 cursor-pointer items-center justify-center">
        <input
          type="checkbox"
          checked={done}
          aria-label={MILESTONES_COPY.checkbox(title)}
          data-milestone-focus={`check:${id}`}
          className="bo-milestone-check"
          onChange={(event) => onToggle(milestone, event.currentTarget.checked)}
        />
      </label>
      <button
        type="button"
        aria-label={MILESTONES_COPY.edit(title)}
        aria-describedby={milestone.dueDate ? dueId : undefined}
        data-milestone-focus={`edit:${id}`}
        className="bo-milestone-title flex min-h-11 min-w-0 flex-1 flex-col items-start justify-center gap-0.5 rounded-md px-2 py-2 text-left"
        onClick={() => onEdit(milestone)}
      >
        <span
          className={cn(
            "bo-text-body max-w-full break-words",
            done && "text-text-secondary line-through",
          )}
        >
          {title}
        </span>
        {milestone.dueDate ? (
          <span id={dueId} className="bo-text-label text-text-secondary">
            <time dateTime={milestone.dueDate}>
              {MILESTONES_COPY.dueOn(formatDateKey(milestone.dueDate, "short"))}
            </time>
          </span>
        ) : null}
      </button>
      {/* That the title edits, at a glance (no room for it under 360 px; the name says it). */}
      <Icon icon={Pencil} size="sm" className="shrink-0 text-text-secondary max-[359px]:hidden" />
      <MoveKey milestone={milestone} button="up" disabled={first} onMoveBy={onMoveBy} />
      <MoveKey milestone={milestone} button="down" disabled={last} onMoveBy={onMoveBy} />
    </>
  );
}

function MoveKey({
  milestone,
  button,
  disabled,
  onMoveBy,
}: {
  milestone: ProjectMilestoneItem;
  button: "up" | "down";
  disabled: boolean;
  onMoveBy: (id: string, delta: -1 | 1) => void;
}) {
  const up = button === "up";
  return (
    <IconKey
      icon={up ? ArrowUp : ArrowDown}
      label={
        up ? MILESTONES_COPY.moveUp(milestone.title) : MILESTONES_COPY.moveDown(milestone.title)
      }
      variant="ghost"
      // No tooltip: the list clips with overflow: hidden (as in areas).
      tooltip={false}
      data-milestone-focus={`${button}:${milestone.id}`}
      // aria-disabled, not disabled: at the top or bottom, focus stays on the key.
      aria-disabled={disabled || undefined}
      className={cn(disabled && "is-disabled")}
      onClick={() => {
        if (!disabled) onMoveBy(milestone.id, up ? -1 : 1);
      }}
    />
  );
}

const EDIT_FIELDS = ["title", "dueDate"] as const;
type EditField = (typeof EDIT_FIELDS)[number];

/** Title and date of one milestone, edited in its row, plus "Eliminar hito". */
function MilestoneEditor({
  projectId,
  milestone,
  onCancelEdit,
  onSave,
  onDelete,
}: RowContentProps) {
  const [title, setTitle] = useState(milestone.title);
  const [due, setDue] = useState(milestone.dueDate ?? "");
  const [errors, setErrors] = useState<Partial<Record<EditField, string>>>({});
  const titleInput = useRef<HTMLInputElement>(null);
  const dueInput = useRef<HTMLInputElement>(null);
  const ids = useId();

  function submit() {
    const parsed = updateMilestoneInputSchema.safeParse({
      projectId,
      id: milestone.id,
      title,
      dueDate: due,
    });
    if (!parsed.success) {
      const found = fieldErrorsOf(parsed.error, EDIT_FIELDS);
      setErrors(found);
      (found.title ? titleInput : dueInput).current?.focus();
      return;
    }
    onSave(milestone, parsed.data.title, parsed.data.dueDate);
  }

  return (
    <EditorForm
      label={MILESTONES_COPY.editForm}
      onSubmit={submit}
      onCancel={() => onCancelEdit(milestone)}
      error={errors.title ?? errors.dueDate}
      extra={
        <Key
          variant="ghost"
          icon={Trash2}
          className="self-start"
          data-milestone-delete={milestone.id}
          onClick={() => onDelete(milestone)}
        >
          {MILESTONES_COPY.delete}
        </Key>
      }
    >
      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <TextField
          ref={titleInput}
          id={`${ids}-title`}
          label={MILESTONES_COPY.titleLabel}
          value={title}
          autoFocus
          error={errors.title}
          help={MILESTONES_COPY.titleHelp}
          onChange={(event) => {
            setTitle(event.target.value);
            setErrors((previous) => ({ ...previous, title: undefined }));
          }}
        />
        <TextField
          ref={dueInput}
          id={`${ids}-due`}
          type="date"
          className="bo-date-field"
          label={MILESTONES_COPY.dueLabel}
          value={due}
          error={errors.dueDate}
          help={MILESTONES_COPY.dueHelp}
          onChange={(event) => {
            setDue(event.target.value);
            setErrors((previous) => ({ ...previous, dueDate: undefined }));
          }}
        />
      </div>
    </EditorForm>
  );
}
