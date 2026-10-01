"use client";

import { LayoutGrid, Plus } from "lucide-react";
import dynamic from "next/dynamic";
import {
  startTransition,
  useEffect,
  useLayoutEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Icon, Key } from "@/design-system";
import { fail, type ActionResult } from "@/lib/action-result";
import { archiveLifeArea, reorderLifeAreas, unarchiveLifeArea } from "@/modules/core/actions";
import { AREAS_COPY } from "@/modules/core/areas-copy";
import {
  applyAreasChange,
  type AreasChange,
  type AreasView,
} from "@/modules/core/areas-optimistic";
import { ToastViewport } from "@/modules/core/components/toast-viewport";
import type { LifeAreaSummary } from "@/modules/core/life-area-input";
import { applyOrder, moveId } from "@/modules/core/life-area-order";
import { hasNotice } from "@/lib/toast/queue";
import { useToaster, type NoticeInput } from "@/lib/toast/use-toaster";
import { useSaveQueue } from "@/lib/use-save-queue";
import { AreaListContext, PlainAreas, type AreaListProps } from "./area-rows";
import { ArchivedAreas } from "./archived-areas";

// dnd-kit only loads in the browser, after the page: until then (and on the server) the plain
// list with the same rows and working Subir/Bajar keys stands in.
const SortableAreas = dynamic(() => import("./sortable-areas"), {
  ssr: false,
  loading: () => <PlainAreas />,
});

// The sheet (form, pickers, 55 icons, the actions' client) only loads when first opened.
const AreaSheet = dynamic(() => import("./area-sheet").then((loaded) => loaded.AreaSheet));

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeToReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeToReducedMotion,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}

type Editor = {
  /** New key per opening, so the form starts from the area (or empty) every time. */
  key: number;
  area: LifeAreaSummary | null;
};

type ChangeOptions = {
  change: AreasChange;
  call: () => Promise<ActionResult<unknown>>;
  /** Shown when the server refuses (or can't be reached); the optimistic change rolls back. */
  failure: string;
  onFailure?: () => void;
  onSuccess?: () => void;
};

/** The server's own message when it says something specific; else the screen's. */
function failureText(result: ActionResult<unknown>, fallback: string): string {
  if (result.ok) return fallback;
  return result.fieldErrors ? fallback : result.error;
}

const editButton = (id: string) =>
  document.querySelector<HTMLElement>(`[data-area-edit="${CSS.escape(id)}"]`);
const unarchiveButton = (id: string) =>
  document.querySelector<HTMLElement>(`[data-area-unarchive="${CSS.escape(id)}"]`);

/**
 * The areas screen: header with "Nueva área", the reorderable list, the archived areas and the
 * notices. Every change shows at once (useOptimistic) and is saved in the background; if the
 * server refuses, the list goes back to what the server has and a notice says so. Reorders,
 * archives and unarchives can be undone from their notice ("Deshacer" or ⌘Z / Ctrl+Z).
 */
export function AreasManager({
  areas,
  archived,
}: {
  areas: LifeAreaSummary[];
  archived: LifeAreaSummary[];
}) {
  const base = useMemo<AreasView>(() => ({ active: areas, archived }), [areas, archived]);
  const [view, applyChange] = useOptimistic(base, applyAreasChange);
  const reducedMotion = usePrefersReducedMotion();
  const toaster = useToaster();

  const [open, setOpen] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const returnFocus = useRef<HTMLElement | null>(null);
  const newAreaKey = useRef<HTMLButtonElement>(null);
  // The opening currently on screen, and what to say once its sheet has fully closed.
  const currentKey = useRef(0);
  const pendingAnnouncement = useRef<string | null>(null);
  const pendingNotice = useRef<NoticeInput | null>(null);
  // Element to focus after the next render (a row that appears or replaces the focused one).
  const pendingFocus = useRef<(() => HTMLElement | null) | null>(null);
  // Consecutive moves share one notice; its "Deshacer" restores the order before the first.
  // `moves` counts the moves in the burst, so a failure knows whether a later one exists.
  const reorderBurst = useRef<{ noticeId: string; before: string[]; moves: number } | null>(null);
  // Server calls run one after another, in the order they were made (undo included), so the
  // last order sent is the one that stays, whatever the network does.
  const enqueue = useSaveQueue();
  const noticeSerial = useRef(0);

  // The list as last rendered, for undo actions that run from an older notice.
  const latest = useRef(view);
  useLayoutEffect(() => {
    latest.current = view;
  });

  useEffect(() => {
    const find = pendingFocus.current;
    if (!find) return;
    pendingFocus.current = null;
    find()?.focus();
  });

  /** Applies a change at once and saves it; on failure it rolls back and says so. */
  function save({ change, call, failure, onFailure, onSuccess }: ChangeOptions) {
    startTransition(async () => {
      applyChange(change);
      // No key: every step of a reorder is sent (each one matters for its undo).
      const queued = await enqueue(null, call);
      // A throw is a network failure or a new deployment: the actions themselves never throw.
      const result: ActionResult<unknown> =
        queued.kind === "done" ? queued.value : fail(AREAS_COPY.unexpected);
      if (result.ok) {
        onSuccess?.();
        return;
      }
      onFailure?.();
      toaster.push({
        title: AREAS_COPY.notSavedTitle,
        text: failureText(result, failure),
        tone: "error",
      });
    });
  }

  /** If focus is inside the row that is about to go away, move it to `next` first. */
  function keepFocusOff(selector: string, next: () => HTMLElement | null) {
    if (document.activeElement?.closest(selector)) pendingFocus.current = next;
  }

  /** Neighbour of an active row (next, else previous), else "Nueva área". */
  function activeNeighbour(id: string): () => HTMLElement | null {
    const { active } = latest.current;
    const index = active.findIndex((area) => area.id === id);
    const neighbour = index === -1 ? undefined : (active[index + 1] ?? active[index - 1]);
    return () => (neighbour ? editButton(neighbour.id) : newAreaKey.current);
  }

  // ── Reorder ────────────────────────────────────────────────────────────────────────────────

  function move(id: string, to: number) {
    const ids = view.active.map((area) => area.id);
    const from = ids.indexOf(id);
    if (from === -1 || from === to) return;
    const next = moveId(ids, from, to);
    const area = view.active[from];

    const current = reorderBurst.current;
    const burst =
      current && hasNotice(toaster.state, current.noticeId)
        ? current
        : { noticeId: `reorder-${++noticeSerial.current}`, before: ids, moves: 0 };
    reorderBurst.current = burst;
    const move = ++burst.moves;
    toaster.replace({
      id: burst.noticeId,
      title: AREAS_COPY.orderTitle,
      text: AREAS_COPY.moved(area.name, AREAS_COPY.position(to, next.length)),
      action: { label: AREAS_COPY.undo, run: () => restoreOrder(burst.before) },
    });
    save({
      change: { type: "reorder", ids: next },
      call: () => reorderLifeAreas({ ids: next }),
      failure: AREAS_COPY.orderFailed,
      onFailure: () => {
        // Only if this was the burst's last move: a later one may still be on its way, or
        // saved, and its "Deshacer" must stay.
        if (move !== burst.moves) return;
        toaster.dismiss(burst.noticeId);
        if (reorderBurst.current === burst) reorderBurst.current = null;
      },
    });
  }

  function restoreOrder(before: string[]) {
    reorderBurst.current = null;
    // The order from before the moves, over today's areas: one restored or created since goes
    // last, one archived since is left out. So the list sent is still exactly the active set.
    const ids = applyOrder(latest.current.active, before).map((area) => area.id);
    save({
      change: { type: "reorder", ids },
      call: () => reorderLifeAreas({ ids }),
      failure: AREAS_COPY.undoFailed,
      onSuccess: () =>
        toaster.push({ title: AREAS_COPY.undoneTitle, text: AREAS_COPY.orderRestored }),
    });
  }

  // ── Archive ────────────────────────────────────────────────────────────────────────────────

  /** From the edit sheet: the row leaves at once; the notice shows once the sheet is gone. */
  function archiveFromSheet(key: number, area: LifeAreaSummary) {
    if (key !== currentKey.current) return;
    // The edited row is going away: focus returns to its neighbour.
    returnFocus.current = activeNeighbour(area.id)();
    const noticeId = `archive-${area.id}-${++noticeSerial.current}`;
    pendingNotice.current = {
      id: noticeId,
      title: AREAS_COPY.archivedNoticeTitle,
      text: AREAS_COPY.archivedNotice(area.name),
      action: { label: AREAS_COPY.undo, run: () => undoArchive(area) },
    };
    setOpen(false);
    save({
      change: { type: "archive", id: area.id },
      call: () => archiveLifeArea({ id: area.id }),
      failure: AREAS_COPY.archiveFailed(area.name),
      onFailure: () => {
        if (pendingNotice.current?.id === noticeId) pendingNotice.current = null;
        toaster.dismiss(noticeId);
      },
    });
  }

  function undoArchive(area: LifeAreaSummary) {
    keepFocusOff(`[data-archived-row="${CSS.escape(area.id)}"]`, () => editButton(area.id));
    save({
      change: { type: "unarchive", id: area.id, position: "original" },
      call: () => unarchiveLifeArea({ id: area.id, position: "original" }),
      failure: AREAS_COPY.undoFailed,
      onSuccess: () =>
        toaster.push({ title: AREAS_COPY.undoneTitle, text: AREAS_COPY.backInPlace(area.name) }),
    });
  }

  function unarchive(area: LifeAreaSummary) {
    // Focus moves to the next archived area, or the previous one, or (when none is left) to the
    // restored row at the end of the list.
    const index = view.archived.findIndex((item) => item.id === area.id);
    const neighbour = view.archived[index + 1] ?? view.archived[index - 1];
    pendingFocus.current = () => (neighbour ? unarchiveButton(neighbour.id) : editButton(area.id));
    const noticeId = toaster.push({
      title: AREAS_COPY.restoredTitle,
      text: AREAS_COPY.restored(area.name),
      action: { label: AREAS_COPY.undo, run: () => undoUnarchive(area) },
    });
    save({
      change: { type: "unarchive", id: area.id, position: "end" },
      call: () => unarchiveLifeArea({ id: area.id }),
      failure: AREAS_COPY.unarchiveFailed(area.name),
      onFailure: () => toaster.dismiss(noticeId),
    });
  }

  function undoUnarchive(area: LifeAreaSummary) {
    keepFocusOff(`[data-area-row="${CSS.escape(area.id)}"]`, activeNeighbour(area.id));
    save({
      change: { type: "archive", id: area.id },
      call: () => archiveLifeArea({ id: area.id }),
      failure: AREAS_COPY.undoFailed,
      onSuccess: () =>
        toaster.push({ title: AREAS_COPY.undoneTitle, text: AREAS_COPY.archivedAgain(area.name) }),
    });
  }

  // ── Create / edit sheet ────────────────────────────────────────────────────────────────────

  function openEditor(area: LifeAreaSummary | null, opener: HTMLElement | null) {
    returnFocus.current = opener;
    currentKey.current += 1;
    pendingAnnouncement.current = null;
    pendingNotice.current = null;
    setAnnouncement("");
    setEditor({ key: currentKey.current, area });
    setOpen(true);
  }

  function saved(key: number, area: LifeAreaSummary, mode: "created" | "updated") {
    // A result for an earlier opening never closes (or speaks over) the current one.
    if (key !== currentKey.current) return;
    pendingAnnouncement.current =
      mode === "created" ? AREAS_COPY.created(area.name) : AREAS_COPY.updated(area.name);
    setOpen(false);
  }

  // Only after the sheet is gone: until then the page is aria-hidden and a live region inside
  // it would not be read.
  function closed(key: number) {
    if (key !== currentKey.current) return;
    const message = pendingAnnouncement.current;
    const notice = pendingNotice.current;
    pendingAnnouncement.current = null;
    pendingNotice.current = null;
    if (message) setAnnouncement(message);
    if (notice) toaster.push(notice);
  }

  const listProps: AreaListProps = {
    areas: view.active,
    reducedMotion,
    onMove: move,
    onEdit: openEditor,
  };

  return (
    <div className="mx-auto flex w-full max-w-(--content-max) flex-col gap-8 px-4 py-8 pb-28 md:px-6 lg:py-12 lg:pb-28">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="bo-text-display">{AREAS_COPY.title}</h1>
          <p className="bo-text-label text-text-secondary">
            {AREAS_COPY.count(view.active.length)}
          </p>
        </div>
        <Key
          ref={newAreaKey}
          variant="signal"
          icon={Plus}
          aria-haspopup="dialog"
          onClick={(event) => openEditor(null, event.currentTarget)}
        >
          {AREAS_COPY.newArea}
        </Key>
      </header>

      {view.active.length > 0 ? (
        <AreaListContext value={listProps}>
          <SortableAreas {...listProps} />
        </AreaListContext>
      ) : (
        <div className="bo-card max-w-160 items-start">
          <Icon icon={LayoutGrid} size="xl" className="text-text-secondary" />
          <h2 className="bo-text-title">{AREAS_COPY.emptyTitle}</h2>
          <p className="bo-text-body-sm text-text-secondary">{AREAS_COPY.emptyText}</p>
        </div>
      )}

      <ArchivedAreas areas={view.archived} onUnarchive={unarchive} />

      {editor ? (
        <AreaSheet
          key={editor.key}
          open={open}
          onOpenChange={setOpen}
          area={editor.area}
          returnFocusRef={returnFocus}
          onSaved={(area, mode) => saved(editor.key, area, mode)}
          onClosed={() => closed(editor.key)}
          onArchive={(area) => archiveFromSheet(editor.key, area)}
        />
      ) : null}

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <ToastViewport
        toaster={toaster}
        label={AREAS_COPY.noticesLabel}
        actionHint={AREAS_COPY.undoHint}
      />
    </div>
  );
}
