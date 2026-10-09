// public/sw.js (R5): the service worker is push only. Playwright cannot drive a real push, so the
// worker runs here in a sandbox with a fake `self` and the events are dispatched by hand.
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, test, vi } from "vitest";

const SOURCE = readFileSync(path.join(process.cwd(), "public/sw.js"), "utf8");

type Listener = (event: Record<string, unknown>) => void;

function load(windows: { focus: () => Promise<unknown> }[] = []) {
  const listeners = new Map<string, Listener>();
  const showNotification = vi.fn(async () => {});
  const openWindow = vi.fn(async () => ({}));
  const self = {
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    skipWaiting: vi.fn(),
    registration: { showNotification },
    clients: {
      claim: vi.fn(async () => {}),
      matchAll: vi.fn(async () => windows),
      openWindow,
    },
  };
  vm.runInNewContext(SOURCE, { self });
  /** Dispatches an event and waits for what it handed to waitUntil. */
  async function dispatch(type: string, event: Record<string, unknown> = {}) {
    const waits: Promise<unknown>[] = [];
    listeners.get(type)!({
      ...event,
      waitUntil: (promise: Promise<unknown>) => waits.push(promise),
    });
    await Promise.all(waits);
  }
  return { listeners, self, showNotification, openWindow, dispatch };
}

describe("public/sw.js", () => {
  test("listens to push and notificationclick, and never to fetch", () => {
    const { listeners } = load();
    expect([...listeners.keys()].sort()).toEqual([
      "activate",
      "install",
      "notificationclick",
      "push",
    ]);
    expect(listeners.has("fetch")).toBe(false);
    // Nothing that could cache a page either.
    expect(SOURCE).not.toMatch(/caches\b/);
  });

  test("a new version takes over at once (there is no cache to migrate)", async () => {
    const { dispatch, self } = load();
    await dispatch("install");
    expect(self.skipWaiting).toHaveBeenCalled();
    await dispatch("activate");
    expect(self.clients.claim).toHaveBeenCalled();
  });

  test("a push shows the title, the body and the tag (so it replaces instead of stacking)", async () => {
    const { dispatch, showNotification } = load();
    const data = {
      json: () => ({ title: "brahua-os", body: "Hoy: Leer", tag: "briefing:2026-10-08" }),
    };
    await dispatch("push", { data });
    expect(showNotification).toHaveBeenCalledTimes(1);
    expect(showNotification).toHaveBeenCalledWith(
      "brahua-os",
      expect.objectContaining({ body: "Hoy: Leer", tag: "briefing:2026-10-08", lang: "es" }),
    );
  });

  test("a push that cannot be read still shows a notification (iOS revokes sites that do not)", async () => {
    for (const data of [
      null,
      {
        json: () => {
          throw new SyntaxError("not json");
        },
      },
      { json: () => null },
      { json: () => "just a string" },
      { json: () => ({ title: 42, body: { nested: true }, tag: [] }) },
    ]) {
      const { dispatch, showNotification } = load();
      await dispatch("push", { data });
      expect(showNotification).toHaveBeenCalledTimes(1);
      expect(showNotification).toHaveBeenCalledWith(
        "brahua-os",
        expect.objectContaining({ body: "", tag: undefined }),
      );
    }
  });

  test("a payload is cut to what a notification can show", async () => {
    const { dispatch, showNotification } = load();
    const long = "x".repeat(5000);
    await dispatch("push", { data: { json: () => ({ title: long, body: long, tag: long }) } });
    const [title, options] = showNotification.mock.calls[0] as unknown as [
      string,
      { body: string; tag: string },
    ];
    expect(title).toHaveLength(80);
    expect(options.body).toHaveLength(400);
    expect(options.tag).toHaveLength(200);
  });

  test("clicking closes the notification and brings the open app forward", async () => {
    const focus = vi.fn(async () => ({}));
    const { dispatch, openWindow } = load([{ focus }]);
    const close = vi.fn();
    await dispatch("notificationclick", { notification: { close } });
    expect(close).toHaveBeenCalled();
    expect(focus).toHaveBeenCalledTimes(1);
    expect(openWindow).not.toHaveBeenCalled();
  });

  test("clicking with the app closed opens it at /", async () => {
    const { dispatch, openWindow } = load([]);
    await dispatch("notificationclick", { notification: { close: vi.fn() } });
    expect(openWindow).toHaveBeenCalledTimes(1);
    expect(openWindow).toHaveBeenCalledWith("/");
  });
});
