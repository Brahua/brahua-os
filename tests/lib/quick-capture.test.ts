// The quick capture's extension point (SPEC-tasks): a registry with one owner, and the app's
// composition root registering `tasks` without `core` importing it.
import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";
import { createCaptureRegistry, type CaptureProvider } from "@/lib/quick-capture";

const provider = (id: string): CaptureProvider => ({ id, Sheet: () => null });

describe("createCaptureRegistry", () => {
  test("starts empty: the shell shows the key as not available", () => {
    expect(createCaptureRegistry().current()).toBeNull();
  });

  test("register makes it current; its unregister removes it", () => {
    const registry = createCaptureRegistry();
    const tasks = provider("tasks");
    const unregister = registry.register(tasks);
    expect(registry.current()).toBe(tasks);
    unregister();
    expect(registry.current()).toBeNull();
  });

  test("the same id again replaces it (a hot reload), and the old unregister leaves the new one", () => {
    const registry = createCaptureRegistry();
    const first = provider("tasks");
    const second = provider("tasks");
    const unregisterFirst = registry.register(first);
    registry.register(second);
    expect(registry.current()).toBe(second);
    unregisterFirst();
    expect(registry.current()).toBe(second);
  });

  test("a second owner is refused: only one module owns the capture key", () => {
    const registry = createCaptureRegistry();
    registry.register(provider("tasks"));
    expect(() => registry.register(provider("notes"))).toThrow(/already belongs to "tasks"/);
    expect(registry.current()?.id).toBe("tasks");
  });
});

describe("the app's composition root", () => {
  test("registers the tasks provider when loaded", async () => {
    vi.resetModules();
    vi.doMock("next/dynamic", () => ({ default: () => () => null }));
    const { currentCaptureProvider } = await import("@/lib/quick-capture");
    expect(currentCaptureProvider()).toBeNull();
    await import("@/lib/capture-providers");
    expect(currentCaptureProvider()?.id).toBe("tasks");
    vi.doUnmock("next/dynamic");
  });

  test("core never imports tasks: the shell only knows the extension point", () => {
    for (const file of [
      "src/modules/core/components/app-nav.tsx",
      "src/modules/core/components/app-shell.tsx",
      "src/modules/core/components/bottom-nav.tsx",
      "src/modules/core/components/sidebar.tsx",
      "src/modules/core/components/capture-key.tsx",
      "src/lib/quick-capture.ts",
    ]) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/modules\/tasks/);
    }
  });
});
