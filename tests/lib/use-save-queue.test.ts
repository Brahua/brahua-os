import { renderHook } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { useSaveQueue } from "@/lib/use-save-queue";

/** A call that resolves (or rejects) when the test says so. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("useSaveQueue", () => {
  test("runs calls one after another, in order", async () => {
    const { result } = renderHook(() => useSaveQueue());
    const enqueue = result.current;
    const order: string[] = [];
    const first = deferred<string>();
    const a = enqueue(null, () => {
      order.push("a");
      return first.promise;
    });
    const b = enqueue(null, async () => {
      order.push("b");
      return "b";
    });
    await Promise.resolve();
    expect(order).toEqual(["a"]);
    first.resolve("a");
    expect(await a).toEqual({ kind: "done", value: "a", superseded: false });
    expect(await b).toEqual({ kind: "done", value: "b", superseded: false });
    expect(order).toEqual(["a", "b"]);
  });

  test("same key: the one in flight runs, the waiting ones but the newest are skipped", async () => {
    const { result } = renderHook(() => useSaveQueue());
    const enqueue = result.current;
    const sent: number[] = [];
    const first = deferred<number>();
    const one = enqueue("status", () => {
      sent.push(1);
      return first.promise;
    });
    // Its turn came (it is in flight) before the others arrive.
    await tick();
    const two = enqueue("status", async () => {
      sent.push(2);
      return 2;
    });
    const other = enqueue("priority", async () => 9);
    const three = enqueue("status", async () => {
      sent.push(3);
      return 3;
    });
    first.resolve(1);
    expect(await one).toEqual({ kind: "done", value: 1, superseded: true });
    expect(await two).toEqual({ kind: "skipped" });
    // Another key is never skipped by this one.
    expect(await other).toEqual({ kind: "done", value: 9, superseded: false });
    expect(await three).toEqual({ kind: "done", value: 3, superseded: false });
    expect(sent).toEqual([1, 3]);
  });

  test("a throw is reported (with superseded) and doesn't stop the queue", async () => {
    const { result } = renderHook(() => useSaveQueue());
    const enqueue = result.current;
    const call = deferred<string>();
    const failing = enqueue("dates", () => call.promise);
    await tick();
    const next = enqueue("dates", async () => "ok");
    call.reject(new Error("offline"));
    expect(await failing).toMatchObject({ kind: "threw", superseded: true });
    expect(await next).toEqual({ kind: "done", value: "ok", superseded: false });
  });

  test("null keys never skip", async () => {
    const { result } = renderHook(() => useSaveQueue());
    const enqueue = result.current;
    const results = await Promise.all([1, 2, 3].map((n) => enqueue(null, async () => n)));
    expect(results.map((item) => item.kind)).toEqual(["done", "done", "done"]);
  });
});
