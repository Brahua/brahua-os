// The quick capture's extension point (SPEC-tasks): the composition root hands the shell the
// provider of `tasks` through context, and `core` never imports `tasks`.
import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";
import { createElement, use } from "react";
import { describe, expect, test, vi } from "vitest";
import { QuickCaptureContext } from "@/lib/quick-capture";

vi.mock("next/dynamic", () => ({ default: () => () => null }));

describe("the app's composition root", () => {
  test("without the root the shell has no provider (the key says Próximamente)", () => {
    let seen: unknown = "unset";
    function Probe() {
      seen = use(QuickCaptureContext);
      return null;
    }
    render(createElement(Probe));
    expect(seen).toBeNull();
  });

  test("CaptureRoot gives the shell the tasks provider", async () => {
    const { CaptureRoot } = await import("@/lib/capture-providers");
    let seen: { id: string; preload?: () => void } | null = null;
    function Probe() {
      seen = use(QuickCaptureContext);
      return null;
    }
    render(createElement(CaptureRoot, null, createElement(Probe)));
    expect(seen).toMatchObject({ id: "tasks" });
    expect(typeof seen!.preload).toBe("function");
  });

  test("the root imports the provider by name (a side-effect-only import is dropped by the bundler)", () => {
    const source = readFileSync("src/lib/capture-providers.tsx", "utf8");
    expect(source).toMatch(
      /import \{ tasksCaptureProvider \} from "@\/modules\/tasks\/capture-provider";/,
    );
    expect(source).not.toMatch(/^import "@\/modules\//m);
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
