import { describe, expect, test } from "vitest";
import {
  EMPTY_TOASTS,
  hasNotice,
  MAX_QUEUED,
  toastReducer,
  type Notice,
  type ToastEvent,
  type ToastState,
} from "@/lib/toast/queue";

function notice(id: string, text = id): Notice {
  return { id, title: "T", text, duration: 1000 };
}

const run = (events: ToastEvent[], state: ToastState = EMPTY_TOASTS) =>
  events.reduce(toastReducer, state);

describe("toastReducer", () => {
  test("the first notice shows; later ones wait their turn in order", () => {
    const state = run([
      { type: "push", notice: notice("a") },
      { type: "push", notice: notice("b") },
      { type: "push", notice: notice("c") },
    ]);
    expect(state.visible?.id).toBe("a");
    expect(state.queue.map((item) => item.id)).toEqual(["b", "c"]);
  });

  test("dismissing the visible one shows the next, with a new key", () => {
    const before = run([
      { type: "push", notice: notice("a") },
      { type: "push", notice: notice("b") },
    ]);
    const after = toastReducer(before, { type: "dismiss", id: "a" });
    expect(after.visible?.id).toBe("b");
    expect(after.visible?.key).not.toBe(before.visible?.key);
    expect(after.queue).toEqual([]);
    expect(toastReducer(after, { type: "dismiss", id: "b" }).visible).toBeNull();
  });

  test("dismissing a waiting notice removes it; an unknown id changes nothing", () => {
    const state = run([
      { type: "push", notice: notice("a") },
      { type: "push", notice: notice("b") },
    ]);
    expect(toastReducer(state, { type: "dismiss", id: "b" }).queue).toEqual([]);
    expect(toastReducer(state, { type: "dismiss", id: "zzz" })).toBe(state);
  });

  test("replace updates the visible notice in place and restarts its timer (new key)", () => {
    const state = run([
      { type: "push", notice: notice("a", "one") },
      { type: "push", notice: notice("b") },
    ]);
    const next = toastReducer(state, { type: "replace", notice: notice("a", "two") });
    expect(next.visible).toMatchObject({ id: "a", text: "two" });
    expect(next.visible?.key).not.toBe(state.visible?.key);
    expect(next.queue.map((item) => item.id)).toEqual(["b"]);
  });

  test("replace updates a waiting notice where it is, or pushes it if gone", () => {
    const state = run([
      { type: "push", notice: notice("a") },
      { type: "push", notice: notice("b", "old") },
    ]);
    const updated = toastReducer(state, { type: "replace", notice: notice("b", "new") });
    expect(updated.queue).toEqual([notice("b", "new")]);
    expect(updated.visible).toBe(state.visible);

    const pushed = toastReducer(EMPTY_TOASTS, { type: "replace", notice: notice("c") });
    expect(pushed.visible?.id).toBe("c");
  });

  test(`keeps at most ${MAX_QUEUED} waiting, dropping the oldest`, () => {
    const state = run(
      ["a", "b", "c", "d", "e"].map((id) => ({ type: "push", notice: notice(id) }) as const),
    );
    expect(state.visible?.id).toBe("a");
    expect(state.queue.map((item) => item.id)).toEqual(["c", "d", "e"]);
  });

  test("hasNotice finds visible and waiting notices", () => {
    const state = run([
      { type: "push", notice: notice("a") },
      { type: "push", notice: notice("b") },
    ]);
    expect(hasNotice(state, "a")).toBe(true);
    expect(hasNotice(state, "b")).toBe(true);
    expect(hasNotice(state, "c")).toBe(false);
  });
});

describe("notices without a time limit (undo, WCAG 2.2.1)", () => {
  const undo = (id: string): Notice => ({
    id,
    title: "T",
    text: id,
    action: { label: "Deshacer", run: () => {} },
    duration: Number.POSITIVE_INFINITY,
  });

  test("the next notice replaces it (it would hold the queue forever otherwise)", () => {
    const state = run([
      { type: "push", notice: undo("a") },
      { type: "push", notice: notice("b") },
    ]);
    expect(state.visible?.id).toBe("b");
    expect(state.queue).toEqual([]);
  });

  test("an error shows at once and the undo comes back after it", () => {
    const state = run([
      { type: "push", notice: undo("a") },
      { type: "push", notice: { ...notice("e"), tone: "error" } },
    ]);
    expect(state.visible?.id).toBe("e");
    expect(state.queue.map((item) => item.id)).toEqual(["a"]);
    const after = toastReducer(state, { type: "dismiss", id: "e" });
    expect(after.visible?.id).toBe("a");
  });
});
