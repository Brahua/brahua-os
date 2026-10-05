// The quick capture's extension point (SPEC-tasks, SPEC-finance): the composition root hands the
// shell the providers of `tasks` and `finance` (in that order) through context, and `core` never
// imports a module.
import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";
import { createElement, use } from "react";
import { describe, expect, test, vi } from "vitest";
import {
  pickCaptureProvider,
  QuickCaptureContext,
  readCaptureChoice,
  rememberCaptureChoice,
  type CaptureProvider,
} from "@/lib/quick-capture";

vi.mock("next/dynamic", () => ({ default: () => () => null }));

describe("the app's composition root", () => {
  test("without the root the shell has no provider (the key says Próximamente)", () => {
    let seen: unknown = "unset";
    function Probe() {
      seen = use(QuickCaptureContext);
      return null;
    }
    render(createElement(Probe));
    expect(seen).toEqual([]);
  });

  test("CaptureRoot gives the shell Tarea, then Gasto", async () => {
    const { CaptureRoot } = await import("@/lib/capture-providers");
    let seen: readonly CaptureProvider[] = [];
    function Probe() {
      seen = use(QuickCaptureContext);
      return null;
    }
    render(createElement(CaptureRoot, null, createElement(Probe)));
    expect(seen.map(({ id, label }) => [id, label])).toEqual([
      ["tasks", "Tarea"],
      ["finance", "Gasto"],
    ]);
    for (const provider of seen) expect(typeof provider.preload).toBe("function");
  });

  test("the root imports the providers by name (a side-effect-only import is dropped by the bundler)", () => {
    const source = readFileSync("src/lib/capture-providers.tsx", "utf8");
    expect(source).toMatch(
      /import \{ tasksCaptureProvider \} from "@\/modules\/tasks\/capture-provider";/,
    );
    expect(source).toMatch(
      /import \{ financeCaptureProvider \} from "@\/modules\/finance\/capture-provider";/,
    );
    expect(source).not.toMatch(/^import "@\/modules\//m);
  });

  test("the device's choice: read and written safely, unknown ids fall back to the first", () => {
    const sheet = () => null;
    const tasks: CaptureProvider = { id: "tasks", label: "Tarea", Sheet: sheet };
    const finance: CaptureProvider = { id: "finance", label: "Gasto", Sheet: sheet };
    expect(pickCaptureProvider([], "tasks")).toBeNull();
    expect(pickCaptureProvider([tasks, finance], null)).toBe(tasks);
    expect(pickCaptureProvider([tasks, finance], "finance")).toBe(finance);
    expect(pickCaptureProvider([tasks, finance], "gone")).toBe(tasks);

    rememberCaptureChoice("finance");
    expect(readCaptureChoice()).toBe("finance");
    localStorage.clear();
    expect(readCaptureChoice()).toBeNull();
    const blocked = () => {
      throw new Error("blocked");
    };
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(blocked);
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(blocked);
    expect(readCaptureChoice()).toBeNull();
    expect(() => rememberCaptureChoice("finance")).not.toThrow();
    get.mockRestore();
    set.mockRestore();
  });

  test("core never imports a module: the shell only knows the extension point", () => {
    for (const file of [
      "src/modules/core/components/app-nav.tsx",
      "src/modules/core/components/app-shell.tsx",
      "src/modules/core/components/bottom-nav.tsx",
      "src/modules/core/components/sidebar.tsx",
      "src/modules/core/components/capture-key.tsx",
      "src/modules/core/components/capture-switcher.tsx",
      "src/lib/quick-capture.ts",
    ]) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/modules\/(tasks|finance)/);
    }
  });
});
