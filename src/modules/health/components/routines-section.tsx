"use client";

import { Plus } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useLayoutEffect, useOptimistic, useRef, useState } from "react";
import { Key, SectionLabel } from "@/design-system";
import { hasNotice } from "@/lib/toast/queue";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import { applyOrder, moveId } from "@/modules/core/life-area-order";
import { HEALTH_COPY } from "../health-copy";
import { routinePath } from "../routes";
import { createRoutine, reorderRoutines } from "../routines-actions";
import { ROUTINES_COPY as COPY } from "../routines-copy";
import type { RoutineSummary } from "../routines-input";
import {
  OrderListContext,
  PlainOrderRows,
  type OrderItem,
  type OrderListProps,
} from "./order-rows";
import { failureReason, useHealthSave } from "./use-health-save";

// dnd-kit only loads in the browser, after the page: until then (and on the server) the plain
// list with the same rows and working Subir/Bajar keys stands in.
const SortableRows = dynamic(() => import("./sortable-rows"), {
  ssr: false,
  loading: () => <PlainOrderRows />,
});

const reorder = (routines: RoutineSummary[], ids: readonly string[]) =>
  applyOrder(routines, ids).map((routine, index) =>
    routine.position === index ? routine : { ...routine, position: index },
  );

/**
 * «Rutinas» on /health (SPEC-health "Pantallas"): the live routines in their manual order (a row
 * with the name and its number of exercises, a link to its page), reordered by dragging or with
 * Subir/Bajar (with «Deshacer»). «Nueva rutina» creates «Rutina A» (or the next free letter) and
 * opens it. Empty: «Arma tu primera rutina».
 */
export function RoutinesSection({ routines }: { routines: RoutineSummary[] }) {
  const router = useRouter();
  const { save, send, toaster, saving } = useHealthSave();
  const reducedMotion = usePrefersReducedMotion();
  const headingId = useId();
  const [shown, applyChange] = useOptimistic(routines, reorder);
  const [creating, setCreating] = useState(false);

  // The list as last rendered, for an undo that runs from an older notice.
  const latest = useRef(routines);
  useLayoutEffect(() => {
    latest.current = routines;
  });

  // Consecutive moves share one notice; its «Deshacer» restores the order before the first.
  const reorderBurst = useRef<{ noticeId: string; before: string[]; moves: number } | null>(null);
  const noticeSerial = useRef(0);

  async function create() {
    if (creating) return;
    setCreating(true);
    const result = await send(() => createRoutine({}));
    if (!result.ok) {
      setCreating(false);
      toaster.push({
        title: HEALTH_COPY.notSavedTitle,
        text: `${COPY.notSaved.create} ${failureReason(result)}`,
        tone: "error",
      });
      return;
    }
    router.push(routinePath(result.data.id));
  }

  function move(id: string, to: number) {
    const ids = shown.map((routine) => routine.id);
    const from = ids.indexOf(id);
    if (from === -1 || from === to) return;
    const order = moveId(ids, from, to);
    const routine = shown[from];

    const current = reorderBurst.current;
    const burst =
      current && hasNotice(toaster.state, current.noticeId)
        ? current
        : { noticeId: `routine-order-${++noticeSerial.current}`, before: ids, moves: 0 };
    reorderBurst.current = burst;
    const turn = ++burst.moves;
    toaster.replace({
      id: burst.noticeId,
      title: COPY.orderTitle,
      text: COPY.moved(routine.name, COPY.position(to, order.length)),
      action: { label: HEALTH_COPY.undo, run: () => restoreOrder(burst.before) },
    });
    save({
      apply: () => applyChange(order),
      key: null,
      call: () => reorderRoutines({ ids: order }),
      failure: COPY.notSaved.reorder,
      onFailure: () => {
        // A later move is on its way (or saved) and decides: no notice for this one either.
        if (turn !== burst.moves) return false;
        toaster.dismiss(burst.noticeId);
        if (reorderBurst.current === burst) reorderBurst.current = null;
      },
    });
  }

  function restoreOrder(before: string[]) {
    reorderBurst.current = null;
    // The order from before the moves, over today's routines: one created since goes last, one
    // deleted since is left out, so the list sent is still exactly the live set.
    const ids = applyOrder(latest.current, before).map((routine) => routine.id);
    save({
      apply: () => applyChange(ids),
      key: null,
      call: () => reorderRoutines({ ids }),
      failure: HEALTH_COPY.notUndone,
      onSuccess: () => toaster.push({ title: HEALTH_COPY.undoneTitle, text: COPY.orderRestored }),
    });
  }

  if (shown.length === 0) {
    return (
      <section className="flex max-w-160 flex-col items-start gap-4" data-routines-empty="">
        <h2 className="bo-text-title">{HEALTH_COPY.emptyTitle}</h2>
        <p className="bo-text-body text-text-secondary">{HEALTH_COPY.emptyText}</p>
        <Key
          variant="signal"
          icon={Plus}
          aria-disabled={creating || undefined}
          data-routine-new=""
          onClick={() => void create()}
        >
          {COPY.newRoutine}
        </Key>
      </section>
    );
  }

  const listProps: OrderListProps<RoutineSummary> = {
    items: shown,
    label: COPY.listLabel,
    dragRole: COPY.dragRole,
    reducedMotion,
    onMove: move,
    renderContent: (routine) => (
      <Link
        href={routinePath(routine.id)}
        data-order-focus={`main:${routine.id}`}
        className="flex min-h-11 min-w-0 flex-1 flex-col justify-center gap-0.5 rounded-md px-2 py-2 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        <span className="bo-text-body line-clamp-2 font-medium break-words">{routine.name}</span>
        <span className="bo-text-body-sm text-text-secondary">
          {COPY.exerciseCount(routine.exerciseCount)}
        </span>
      </Link>
    ),
  };
  // next/dynamic and the context can't carry the row's type (the renders only get these rows).
  const list = listProps as unknown as OrderListProps<OrderItem>;

  return (
    <section
      aria-labelledby={headingId}
      className="flex max-w-160 flex-col gap-3"
      data-routines=""
      data-saving={saving || creating || undefined}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionLabel
          id={headingId}
          as="h2"
          title={COPY.section}
          count={String(shown.length)}
          aria-label={COPY.sectionName(shown.length)}
          className="flex-1"
        />
        <Key
          icon={Plus}
          aria-disabled={creating || undefined}
          data-routine-new=""
          onClick={() => void create()}
        >
          {COPY.newRoutine}
        </Key>
      </div>
      <OrderListContext value={list}>
        <SortableRows {...list} />
      </OrderListContext>
    </section>
  );
}
