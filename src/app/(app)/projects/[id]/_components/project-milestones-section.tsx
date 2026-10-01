"use client";

import { Plus } from "lucide-react";
import dynamic from "next/dynamic";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
import { Key, SectionLabel, TextField } from "@/design-system";
import type { ActionResult } from "@/lib/action-result";
import { hasNotice } from "@/lib/toast/queue";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import { applyOrder, moveId } from "@/modules/core/life-area-order";
import {
  addMilestone,
  checkMilestone,
  deleteMilestone,
  reorderMilestones,
  restoreMilestone,
  updateMilestone,
} from "@/modules/projects/milestone-actions";
import {
  addMilestoneInputSchema,
  MAX_MILESTONES_PER_PROJECT,
  MILESTONE_ERRORS,
  type ProjectMilestoneItem,
} from "@/modules/projects/milestone-input";
import {
  applyMilestoneChange,
  type MilestoneChange,
} from "@/modules/projects/milestone-optimistic";
import { MILESTONES_COPY } from "@/modules/projects/milestones-copy";
import { countMilestones } from "@/modules/projects/progress";
import { PROJECTS_COPY } from "@/modules/projects/projects-copy";
import { usePublishMilestoneCounts } from "./milestone-progress";
import {
  focusSelector,
  MilestoneListContext,
  PlainMilestones,
  type MilestoneListProps,
} from "./milestone-rows";
import { useProjectDetail } from "./project-detail-context";

// dnd-kit only loads in the browser, after the page: until then (and on the server) the plain
// list with the same rows and working Subir/Bajar keys stands in.
const SortableMilestones = dynamic(() => import("./sortable-milestones"), {
  ssr: false,
  loading: () => <PlainMilestones />,
});

type SaveOptions<T> = {
  change: MilestoneChange;
  /** Queue key: calls with the same key collapse (null: every call is sent). */
  key: string | null;
  call: () => Promise<ActionResult<T>>;
  /** First part of the rollback notice; the reason follows. */
  failure: string;
  onSuccess?: (data: T) => void;
  /** Runs on failure; returning false skips the notice (a later save already decides). */
  onFailure?: () => boolean | void;
};

/** The server's message for a field when it gives one, else its general one. */
function failureReason(result: ActionResult<unknown>): string {
  if (result.ok) return "";
  const own = Object.values(result.fieldErrors ?? {}).find((messages) => messages.length)?.[0];
  return own ?? result.error;
}

const editButton = (id: string) => document.querySelector<HTMLElement>(focusSelector(id, "edit"));

/**
 * "Hitos" (SPEC-projects): the project's milestones with a checkbox each, added inline (Enter
 * adds another), edited in their row (title and date, plus "Eliminar hito"), reordered by
 * dragging or with Subir/Bajar. Every change shows at once (its own useOptimistic) and is saved
 * through the page's queue; a refusal or a network failure rolls it back with a notice. Delete
 * and reorder offer "Deshacer". The counts it shows drive the progress meter (P3 slot of
 * "Objetivo y fechas").
 */
export function ProjectMilestonesSection({ milestones }: { milestones: ProjectMilestoneItem[] }) {
  const { project, enqueue, toaster, announce } = useProjectDetail();
  const projectId = project.id;
  const [view, applyChange] = useOptimistic(milestones, applyMilestoneChange);
  usePublishMilestoneCounts(projectId, countMilestones(view));
  const reducedMotion = usePrefersReducedMotion();
  const headingId = useId();
  const fieldId = useId();
  // While a save is on its way the section says so (data-saving): E2E waits for it to clear.
  const [saving, startTransition] = useTransition();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [addError, setAddError] = useState<string | undefined>();
  const addInput = useRef<HTMLInputElement>(null);

  // Element to focus after the next render (a row's editor closed, or a row went away).
  const pendingFocus = useRef<(() => HTMLElement | null) | null>(null);
  useEffect(() => {
    const find = pendingFocus.current;
    if (!find) return;
    pendingFocus.current = null;
    find()?.focus();
  });

  // The list as last rendered, for undo actions that run from an older notice.
  const latest = useRef(view);
  useLayoutEffect(() => {
    latest.current = view;
  });

  // Consecutive moves share one notice; its "Deshacer" restores the order before the first.
  const reorderBurst = useRef<{ noticeId: string; before: string[]; moves: number } | null>(null);
  const noticeSerial = useRef(0);

  /** Applies a change at once and saves it; on failure it rolls back and says why. */
  function save<T>({ change, key, call, failure, onSuccess, onFailure }: SaveOptions<T>) {
    startTransition(async () => {
      applyChange(change);
      const queued = await enqueue(key, call);
      // Skipped, or a newer save of the same thing is coming: that one decides.
      if (queued.kind === "skipped" || queued.superseded) return;
      if (queued.kind === "done" && queued.value.ok) {
        onSuccess?.(queued.value.data);
        return;
      }
      if (onFailure?.() === false) return;
      // A throw is a network failure or a new deployment: the actions themselves never throw.
      const reason =
        queued.kind === "threw" ? PROJECTS_COPY.checkConnection : failureReason(queued.value);
      toaster.push({
        title: PROJECTS_COPY.notSavedTitle,
        text: `${failure} ${reason}`,
        tone: "error",
      });
    });
  }

  // ── Add ───────────────────────────────────────────────────────────────────────────────────

  function add() {
    const id = crypto.randomUUID();
    const parsed = addMilestoneInputSchema.safeParse({ projectId, id, title: draft });
    if (!parsed.success) {
      setAddError(parsed.error.issues.find((issue) => issue.path[0] === "title")?.message);
      addInput.current?.focus();
      return;
    }
    if (view.length >= MAX_MILESTONES_PER_PROJECT) {
      setAddError(MILESTONE_ERRORS.tooMany);
      addInput.current?.focus();
      return;
    }
    const { title } = parsed.data;
    setDraft("");
    setAddError(undefined);
    // Enter adds another: the field stays (or comes back) under the cursor.
    addInput.current?.focus();
    save({
      change: {
        type: "add",
        milestone: { id, title, dueDate: null, doneAt: null, sortOrder: view.length },
      },
      key: null,
      call: () => addMilestone(parsed.data),
      failure: MILESTONES_COPY.notSaved.add,
      onSuccess: () => announce(MILESTONES_COPY.added(title)),
      // The text comes back to the field, unless something new was typed meanwhile.
      onFailure: () => setDraft((current) => (current === "" ? title : current)),
    });
  }

  // ── Check ─────────────────────────────────────────────────────────────────────────────────

  function toggle(milestone: ProjectMilestoneItem, done: boolean) {
    const { id } = milestone;
    save({
      change: { type: "done", id, doneAt: done ? new Date() : null },
      // Quick toggles collapse: the one in flight, then only the last.
      key: `milestone-done:${id}`,
      call: () => checkMilestone({ projectId, id, done }),
      failure: MILESTONES_COPY.notSaved.done,
    });
  }

  // ── Edit ──────────────────────────────────────────────────────────────────────────────────

  function closeEditor(milestone: ProjectMilestoneItem) {
    setEditingId(null);
    // The title button unmounted while editing: focus goes back to it.
    pendingFocus.current = () => editButton(milestone.id);
  }

  function saveEdit(milestone: ProjectMilestoneItem, title: string, dueDate: string | null) {
    closeEditor(milestone);
    if (title === milestone.title && dueDate === milestone.dueDate) return;
    const { id } = milestone;
    save({
      change: { type: "update", id, title, dueDate },
      key: `milestone-edit:${id}`,
      call: () => updateMilestone({ projectId, id, title, dueDate }),
      failure: MILESTONES_COPY.notSaved.update,
      onSuccess: () => announce(MILESTONES_COPY.saved),
    });
  }

  // ── Delete and undo ───────────────────────────────────────────────────────────────────────

  function remove(milestone: ProjectMilestoneItem) {
    const position = view.findIndex((item) => item.id === milestone.id);
    if (position === -1) return;
    const neighbour = view[position + 1] ?? view[position - 1];
    const afterId = view[position - 1]?.id ?? null;
    setEditingId(null);
    // The row is going away: focus moves to the next one (or the previous), else to "Nuevo hito".
    pendingFocus.current = () => (neighbour ? editButton(neighbour.id) : addInput.current);
    const noticeId = toaster.push({
      id: `milestone-delete-${milestone.id}-${++noticeSerial.current}`,
      title: MILESTONES_COPY.deletedTitle,
      text: MILESTONES_COPY.deleted(milestone.title),
      action: {
        label: PROJECTS_COPY.undo,
        run: () => undoDelete(milestone, position, afterId),
      },
    });
    save({
      change: { type: "remove", id: milestone.id },
      key: null,
      call: () => deleteMilestone({ projectId, id: milestone.id }),
      failure: MILESTONES_COPY.notSaved.remove,
      onFailure: () => toaster.dismiss(noticeId),
    });
  }

  function undoDelete(milestone: ProjectMilestoneItem, position: number, afterId: string | null) {
    // At the limit (others were added since), restoring would only be refused: say so instead.
    if (latest.current.length >= MAX_MILESTONES_PER_PROJECT) {
      toaster.push({
        title: PROJECTS_COPY.notSavedTitle,
        text: `${PROJECTS_COPY.undoFailed} ${MILESTONE_ERRORS.tooMany}`,
        tone: "error",
      });
      return;
    }
    save({
      change: { type: "restore", milestone, position, afterId },
      key: null,
      call: () => restoreMilestone({ projectId, id: milestone.id, position, afterId }),
      failure: PROJECTS_COPY.undoFailed,
      onSuccess: () =>
        toaster.push({
          title: PROJECTS_COPY.undoneTitle,
          text: MILESTONES_COPY.restored(milestone.title),
        }),
    });
  }

  // ── Reorder ───────────────────────────────────────────────────────────────────────────────

  function move(id: string, to: number) {
    const ids = view.map((milestone) => milestone.id);
    const from = ids.indexOf(id);
    if (from === -1 || from === to) return;
    const next = moveId(ids, from, to);
    const milestone = view[from];

    const current = reorderBurst.current;
    const burst =
      current && hasNotice(toaster.state, current.noticeId)
        ? current
        : { noticeId: `milestone-order-${++noticeSerial.current}`, before: ids, moves: 0 };
    reorderBurst.current = burst;
    const step = ++burst.moves;
    toaster.replace({
      id: burst.noticeId,
      title: MILESTONES_COPY.orderTitle,
      text: MILESTONES_COPY.moved(milestone.title, MILESTONES_COPY.position(to, next.length)),
      action: { label: PROJECTS_COPY.undo, run: () => restoreOrder(burst.before) },
    });
    save({
      change: { type: "reorder", ids: next },
      // Every step is sent: each one matters for the burst's "Deshacer".
      key: null,
      call: () => reorderMilestones({ projectId, ids: next }),
      failure: MILESTONES_COPY.notSaved.reorder,
      onFailure: () => {
        // Only if this was the burst's last move: a later one may still be on its way.
        // A later move is on its way (or saved) and decides: no notice for this one either.
        if (step !== burst.moves) return false;
        toaster.dismiss(burst.noticeId);
        if (reorderBurst.current === burst) reorderBurst.current = null;
      },
    });
  }

  function restoreOrder(before: string[]) {
    reorderBurst.current = null;
    // The order from before the moves, over today's milestones: one added since goes last, one
    // deleted since is left out, so the list sent is still exactly the project's set.
    const ids = applyOrder(latest.current, before).map((milestone) => milestone.id);
    save({
      change: { type: "reorder", ids },
      key: null,
      call: () => reorderMilestones({ projectId, ids }),
      failure: PROJECTS_COPY.undoFailed,
      onSuccess: () =>
        toaster.push({ title: PROJECTS_COPY.undoneTitle, text: MILESTONES_COPY.orderRestored }),
    });
  }

  const listProps: MilestoneListProps = {
    projectId,
    milestones: view,
    reducedMotion,
    editingId,
    onMove: move,
    onToggle: toggle,
    onEdit: (milestone) => setEditingId(milestone.id),
    onCancelEdit: closeEditor,
    onSave: saveEdit,
    onDelete: remove,
  };

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3"
      data-milestones
      data-saving={saving || undefined}
    >
      <SectionLabel
        id={headingId}
        as="h2"
        title={MILESTONES_COPY.section}
        count={view.length > 0 ? view.length : undefined}
        aria-label={MILESTONES_COPY.sectionName(view.length)}
      />
      {view.length > 0 ? (
        <MilestoneListContext value={listProps}>
          <SortableMilestones {...listProps} />
        </MilestoneListContext>
      ) : (
        <p className="bo-text-body-sm text-text-secondary">{MILESTONES_COPY.empty}</p>
      )}
      <form
        noValidate
        aria-label={MILESTONES_COPY.add}
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <TextField
          ref={addInput}
          id={fieldId}
          label={MILESTONES_COPY.addLabel}
          value={draft}
          autoComplete="off"
          enterKeyHint="enter"
          error={addError}
          help={MILESTONES_COPY.addHelp}
          onChange={(event) => {
            setDraft(event.target.value);
            setAddError(undefined);
          }}
        />
        <Key type="submit" icon={Plus} className="self-start">
          {MILESTONES_COPY.add}
        </Key>
      </form>
    </section>
  );
}
