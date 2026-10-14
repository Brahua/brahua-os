"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { startTransition, useEffect, useId, useMemo, useRef, useState } from "react";
import { Key } from "@/design-system";
import { fail, type ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/cn";
import { formatDateKey } from "@/lib/time";
import { useRequiredScreenServices } from "@/modules/core/components/screen-services";
import { taskPath } from "@/modules/tasks/routes";
import {
  completeCleaning,
  reopenCleaning,
  removeCleaning,
  restoreCleaning,
  addCleaning,
} from "../actions";
import type { CleaningDone } from "../actions";
import { CLEANING_COPY as COPY } from "../cleaning-copy";
import { groupByDay, groupByZone, whenText, type CleaningItem } from "../cleaning-view";
import { householdPath, type CleaningGroup } from "../routes";
import { AddCleaningSheet } from "./add-cleaning-sheet";

type CleaningScreenProps = {
  /** The pending cleanings, as the server read them. */
  items: readonly CleaningItem[];
  /** The Lima day the page was read for (YYYY-MM-DD). */
  today: string;
  group: CleaningGroup;
};

const without = (set: ReadonlySet<string>, id: string) => {
  const next = new Set(set);
  next.delete(id);
  return next;
};

/** The server's message for a failed result: a field's own when it gives one, else the general. */
function reasonOf(result: { ok: false; error: string; fieldErrors?: Record<string, string[]> }) {
  const own = Object.values(result.fieldErrors ?? {}).find((messages) => messages.length)?.[0];
  return own ?? result.error;
}

/**
 * The cleaning view (SPEC-household "Pantallas"): the pending cleanings by zone or by day, «Hecho»
 * and «Quitar» on each, and «Añadir limpieza».
 *
 * - «Hecho» and «Quitar» are optimistic: the row leaves at once and the save runs in the screen's
 *   queue; a refusal brings it back with «Sin guardar». A second press on a row already saving
 *   does nothing (a guard plus `aria-disabled`: a focused key is never `disabled`).
 * - «Deshacer» carries the id of the task it acted on (never the series): reopening it removes the
 *   next occurrence only if nobody touched it (`tasks` decides).
 * - Focus: a key that leaves with its row hands focus to the next row's «Hecho», or the one
 *   before, or «Añadir limpieza».
 */
export function CleaningScreen({ items, today, group }: CleaningScreenProps) {
  const { toaster, enqueue, announce, isCurrentDay } = useRequiredScreenServices();
  const { push } = toaster;
  const root = useRef<HTMLDivElement>(null);
  const addKey = useRef<HTMLButtonElement>(null);
  const inflight = useRef(new Set<string>());
  const pendingFocus = useRef<string | null>(null);
  /** Cleanings that left on this screen (hidden until the page reads again, or an undo). */
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());
  const [adding, setAdding] = useState(false);
  /** Ids come from the position, never from the zone: a zone is free text ("sala/comedor"). */
  const headingBase = useId();

  const rows = useMemo(() => items.filter((item) => !gone.has(item.id)), [items, gone]);

  // After a row left: focus goes where the key that was pressed has no row to be in.
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    const element = root.current?.querySelector<HTMLElement>(`[data-household-focus="${target}"]`);
    (element ?? addKey.current)?.focus();
  }, [gone]);

  function release(id: string) {
    inflight.current.delete(id);
    setSaving((current) => without(current, id));
  }

  function notSaved(text: string, reason: string) {
    push({ title: COPY.notSavedTitle, text: `${text} ${reason}`.trim(), tone: "error" });
  }

  function leave(item: CleaningItem) {
    const at = rows.findIndex((row) => row.id === item.id);
    const neighbor = rows[at + 1] ?? rows[at - 1];
    pendingFocus.current = neighbor ? `row:${neighbor.id}` : "add";
    setGone((current) => new Set(current).add(item.id));
  }

  /** Runs `action` in the queue: a refusal puts the row back and says why. */
  function run<T>(
    item: CleaningItem,
    action: () => Promise<ActionResult<T>>,
    failed: string,
    onOk: (data: T) => void,
  ) {
    if (isCurrentDay && !isCurrentDay()) return;
    if (inflight.current.has(item.id)) return;
    inflight.current.add(item.id);
    setSaving((current) => new Set(current).add(item.id));
    leave(item);
    startTransition(async () => {
      const queued = await enqueue(null, action);
      release(item.id);
      const result: ActionResult<T> =
        queued.kind === "done" ? queued.value : fail(COPY.checkConnection);
      if (!result.ok) {
        // The row is back: focus returns to it (it went to the neighbor when the row left).
        pendingFocus.current = `row:${item.id}`;
        setGone((current) => without(current, item.id));
        notSaved(failed, reasonOf(result));
        return;
      }
      onOk(result.data);
    });
  }

  function markDone(item: CleaningItem) {
    run(
      item,
      () => completeCleaning({ id: item.id }),
      COPY.notDone,
      (data: CleaningDone) => {
        push({
          title: COPY.doneTitle,
          text: data.nextDueDate
            ? COPY.doneNext(data.title, formatDateKey(data.nextDueDate, "short"))
            : COPY.doneNoNext(data.title),
          action: { label: COPY.undo, run: () => undoDone(item) },
        });
      },
    );
  }

  function undoDone(item: CleaningItem) {
    startTransition(async () => {
      const queued = await enqueue(null, () => reopenCleaning({ id: item.id }));
      const result = queued.kind === "done" ? queued.value : fail(COPY.checkConnection);
      if (!result.ok) {
        notSaved(COPY.notUndone, reasonOf(result));
        return;
      }
      setGone((current) => without(current, item.id));
      announce(COPY.undone(item.title));
    });
  }

  function remove(item: CleaningItem) {
    run(
      item,
      () => removeCleaning({ id: item.id }),
      COPY.notRemoved,
      () => {
        push({
          title: COPY.removedTitle,
          text: COPY.removed(item.title),
          action: { label: COPY.undo, run: () => undoRemove(item) },
        });
      },
    );
  }

  function undoRemove(item: CleaningItem) {
    startTransition(async () => {
      const queued = await enqueue(null, () => restoreCleaning({ id: item.id }));
      const result = queued.kind === "done" ? queued.value : fail(COPY.checkConnection);
      if (!result.ok) {
        notSaved(COPY.notUndone, reasonOf(result));
        return;
      }
      setGone((current) => without(current, item.id));
      announce(COPY.restored(item.title));
    });
  }

  const renderRow = (item: CleaningItem) => (
    <CleaningRow
      key={item.id}
      item={item}
      today={today}
      busy={saving.has(item.id)}
      onDone={() => markDone(item)}
      onRemove={() => remove(item)}
    />
  );

  return (
    <div ref={root} className="flex flex-col gap-6" data-household-view="limpieza">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label={COPY.groupLabel}>
          <ul className="flex gap-2">
            {(["zona", "dia"] as const).map((value) => (
              <li key={value}>
                <Link
                  href={householdPath("limpieza", value)}
                  aria-current={group === value ? "true" : undefined}
                  className={cn(
                    "bo-text-body-sm flex min-h-11 items-center rounded-md border px-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
                    group === value ? "border-signal" : "border-divider text-text-secondary",
                  )}
                >
                  {COPY.groups[value]}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <Key
          ref={addKey}
          variant="signal"
          data-household-focus="add"
          onClick={() => setAdding(true)}
        >
          <Plus aria-hidden className="size-4" />
          {COPY.add}
        </Key>
      </div>

      {rows.length === 0 ? (
        <div className="flex max-w-160 flex-col gap-1" data-household-empty="">
          <p className="bo-text-title">{COPY.emptyTitle}</p>
          <p className="bo-text-body-sm text-text-secondary">{COPY.emptyText}</p>
        </div>
      ) : group === "zona" ? (
        groupByZone(rows, today).map((zone, index) => (
          <section
            key={zone.zone ?? "none"}
            aria-labelledby={`${headingBase}-zone-${index}`}
            className="flex max-w-160 flex-col gap-2"
            data-household-zone={zone.zone ?? ""}
          >
            <h2 id={`${headingBase}-zone-${index}`} className="bo-text-title">
              {zone.label}
              <span className="bo-text-label ml-2 text-text-secondary">
                {COPY.dueThisWeek(zone.dueThisWeek)}
              </span>
            </h2>
            <ul className="flex flex-col gap-2">{zone.items.map(renderRow)}</ul>
          </section>
        ))
      ) : (
        groupByDay(rows, today).map((day, index) => (
          <section
            key={`${day.kind}-${index}`}
            aria-label={day.label}
            className="flex max-w-160 flex-col gap-2"
            data-household-day={day.kind}
          >
            <h2 className="bo-text-title">{day.label}</h2>
            <ul className="flex flex-col gap-2">{day.items.map(renderRow)}</ul>
          </section>
        ))
      )}

      <AddCleaningSheet
        open={adding}
        onOpenChange={setAdding}
        returnFocusRef={addKey}
        save={(input) => addWithQueue(input)}
        onAdded={(item) => announce(COPY.added(item.title))}
      />
    </div>
  );

  /** The sheet's save goes through the screen's queue like every other write. */
  async function addWithQueue(input: unknown): Promise<ActionResult<CleaningItem>> {
    const queued = await enqueue(null, () => addCleaning(input));
    return queued.kind === "done" ? queued.value : fail(COPY.checkConnection);
  }
}

type CleaningRowProps = {
  item: CleaningItem;
  today: string;
  busy: boolean;
  onDone: () => void;
  onRemove: () => void;
};

/** One cleaning: its title, how often and when, «Hecho» and «Quitar» (44 px keys). */
function CleaningRow({ item, today, busy, onDone, onRemove }: CleaningRowProps) {
  const when = whenText(item.dueDate, today);
  const meta = [item.frequency, when].filter(Boolean).join(" · ");
  return (
    <li className="bo-card bo-household-row" data-household-row={item.id}>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Link
          href={taskPath(item.id)}
          aria-label={COPY.openTask(item.title)}
          className="bo-text-body min-w-0 rounded-sm font-medium break-words focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          {item.title}
        </Link>
        {meta ? <p className="bo-text-label text-text-secondary">{meta}</p> : null}
      </div>
      <div className="flex items-center gap-1">
        <Key
          variant="default"
          aria-label={COPY.doneName(item.title)}
          aria-disabled={busy || undefined}
          data-household-focus={`row:${item.id}`}
          onClick={() => {
            if (!busy) onDone();
          }}
        >
          {COPY.done}
        </Key>
        <Key
          variant="ghost"
          aria-label={COPY.removeName(item.title)}
          aria-disabled={busy || undefined}
          onClick={() => {
            if (!busy) onRemove();
          }}
        >
          {COPY.remove}
        </Key>
      </div>
    </li>
  );
}
