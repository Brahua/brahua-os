// A queue for background saves (Server Action calls behind an optimistic UI). Client-only.
import { useCallback, useRef } from "react";

/** How a queued call ended. */
export type Queued<T> =
  /** Never ran: a newer call with the same key arrived before its turn. */
  | { kind: "skipped" }
  | {
      kind: "done";
      value: T;
      /** A newer call with the same key was queued meanwhile (it decides what stays). */
      superseded: boolean;
    }
  | { kind: "threw"; error: unknown; superseded: boolean };

export type Enqueue = <T>(key: string | null, call: () => Promise<T>) => Promise<Queued<T>>;

/**
 * Runs calls one after another, in the order they were made, so the last value sent is the one
 * that stays whatever the network does.
 *
 * With a `key`, calls collapse: one whose turn comes after a newer call with the same key was
 * queued is skipped (only the newest of a burst is sent after the one in flight). `null` never
 * skips (e.g. reorders, where each step matters for its undo).
 *
 * Call it from a transition (the optimistic update stays until the returned promise settles).
 */
export function useSaveQueue(): Enqueue {
  const tail = useRef<Promise<unknown>>(Promise.resolve());
  const newest = useRef(new Map<string, number>());
  const serial = useRef(0);

  return useCallback(<T>(key: string | null, call: () => Promise<T>) => {
    const mine = ++serial.current;
    if (key !== null) newest.current.set(key, mine);
    const isNewest = () => key === null || newest.current.get(key) === mine;
    const run = tail.current.then(async (): Promise<Queued<T>> => {
      if (!isNewest()) return { kind: "skipped" };
      try {
        const value = await call();
        return { kind: "done", value, superseded: !isNewest() };
      } catch (error) {
        return { kind: "threw", error, superseded: !isNewest() };
      }
    });
    tail.current = run;
    return run;
  }, []);
}
