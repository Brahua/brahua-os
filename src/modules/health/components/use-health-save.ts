"use client";

import { useTransition } from "react";
import { fail, type ActionResult } from "@/lib/action-result";
import { useRequiredScreenServices } from "@/modules/core/components/screen-services";
import { HEALTH_COPY as COPY } from "../health-copy";

/** The server's message for a failed result: a field's own when it gives one, else the general. */
export function failureReason(result: {
  ok: false;
  error: string;
  fieldErrors?: Record<string, string[]>;
}): string {
  const own = Object.values(result.fieldErrors ?? {}).find((messages) => messages.length)?.[0];
  return own ?? result.error;
}

export type SaveOptions<T> = {
  /** Applies the optimistic change (a `useOptimistic` setter), inside the save's transition. */
  apply?: () => void;
  /** Queue key: calls with the same key collapse (null: every call is sent). */
  key: string | null;
  call: () => Promise<ActionResult<T>>;
  /** First part of the rollback notice; the reason follows. */
  failure: string;
  onSuccess?: (data: T) => void;
  /** Runs on failure; returning false skips the notice (a later save already decides). */
  onFailure?: () => boolean | void;
};

/**
 * The screen's save for `health` (the same as `learning`'s): applies a change at once (when it has
 * one) and sends it through the screen's queue; a refusal or a network failure rolls it back with
 * a «Sin guardar» notice that says why. `saving` is true while one is on its way (`data-saving`
 * for E2E).
 */
export function useHealthSave() {
  const services = useRequiredScreenServices();
  const { enqueue, toaster } = services;
  const [saving, startTransition] = useTransition();

  function save<T>({ apply, key, call, failure, onSuccess, onFailure }: SaveOptions<T>) {
    startTransition(async () => {
      apply?.();
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
        queued.kind === "threw" || queued.value.ok
          ? COPY.checkConnection
          : failureReason(queued.value);
      toaster.push({ title: COPY.notSavedTitle, text: `${failure} ${reason}`, tone: "error" });
    });
  }

  /**
   * Sends a call through the queue and answers with its result (a form awaits it to keep its
   * fields on a refusal). A throw becomes a failed result.
   */
  async function send<T>(call: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
    const queued = await enqueue(null, call);
    if (queued.kind === "done") return queued.value;
    return fail<T>(COPY.checkConnection);
  }

  return { ...services, save, send, saving };
}
