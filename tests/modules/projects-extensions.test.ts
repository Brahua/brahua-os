// T5 of `tasks`: the extension points of the project screens that `projects` offers (sections of
// a project's page, next actions for the list's cards), with fake providers, and the composition
// root that registers the real ones.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import { ok } from "@/lib/action-result";
import {
  projectNextActions,
  registerNextActionSource,
  registerProjectSection,
  renderProjectSections,
} from "@/modules/projects/contracts";
import {
  createNextActionRegistry,
  createProjectSectionRegistry,
  type NextAction,
  type NextActionSource,
  type ProjectSection,
  type ProjectSectionContext,
} from "@/modules/projects/project-extensions";

const CONTEXT: ProjectSectionContext = {
  project: { id: "p1", name: "Cocina", status: "active" },
  milestones: [{ id: "m1", title: "Planos" }],
};

function fakeSection(id: string, text: string) {
  const calls: ProjectSectionContext[] = [];
  const section: ProjectSection = {
    id,
    async render(context) {
      calls.push(context);
      return `${text}:${context.project.name}`;
    },
  };
  return { section, calls };
}

const complete = vi.fn(async () => ok(null));
const undoComplete = vi.fn(async () => ok({ restored: true, warning: null }));

/** A next-action source that answers from a fixed table and records what it was asked. */
function fakeNextActions(id: string, actions: Record<string, NextAction>) {
  const calls: string[][] = [];
  const source: NextActionSource = {
    id,
    async nextActionsFor(projectIds) {
      calls.push([...projectIds]);
      // Answers for ids it wasn't asked about too: the registry must ignore them.
      return new Map(Object.entries(actions));
    },
    complete,
    undoComplete,
  };
  return { source, calls };
}

describe("project sections", () => {
  test("renders every section with the project's context, in registration order", async () => {
    const registry = createProjectSectionRegistry();
    const tasks = fakeSection("tasks", "Tareas");
    const notes = fakeSection("other", "Otra");
    registry.register(tasks.section);
    registry.register(notes.section);
    expect(await registry.render(CONTEXT)).toEqual([
      { id: "tasks", node: "Tareas:Cocina" },
      { id: "other", node: "Otra:Cocina" },
    ]);
    expect(tasks.calls).toEqual([CONTEXT]);
  });

  test("registering an id again replaces it; removing never drops a newer one", async () => {
    const registry = createProjectSectionRegistry();
    const first = fakeSection("tasks", "Uno");
    const second = fakeSection("tasks", "Dos");
    const removeFirst = registry.register(first.section);
    registry.register(second.section);
    expect(registry.size()).toBe(1);
    removeFirst();
    expect(await registry.render(CONTEXT)).toEqual([{ id: "tasks", node: "Dos:Cocina" }]);
    expect(first.calls).toEqual([]);
  });

  test("without sections nothing renders", async () => {
    expect(await createProjectSectionRegistry().render(CONTEXT)).toEqual([]);
  });

  test("the app's registry", async () => {
    const { section } = fakeSection("fake-section", "Falsa");
    const remove = registerProjectSection(section);
    try {
      expect(await renderProjectSections(CONTEXT)).toContainEqual({
        id: "fake-section",
        node: "Falsa:Cocina",
      });
    } finally {
      remove();
    }
    expect(await renderProjectSections(CONTEXT)).not.toContainEqual(
      expect.objectContaining({ id: "fake-section" }),
    );
  });
});

describe("next actions", () => {
  test("one call with every id (deduplicated); only the ids asked for; with the source's calls", async () => {
    const registry = createNextActionRegistry();
    const { source, calls } = fakeNextActions("tasks", {
      p1: { id: "t1", title: "medir" },
      p9: { id: "t9", title: "no pedida" },
    });
    registry.register(source);
    const result = await registry.nextActionsFor(["p1", "p2", "p1"]);
    expect(calls).toEqual([["p1", "p2"]]);
    expect([...result.keys()]).toEqual(["p1"]);
    expect(result.get("p1")).toEqual({ id: "t1", title: "medir", complete, undoComplete });
  });

  test("no source or no ids: no work", async () => {
    const empty = createNextActionRegistry();
    expect(await empty.nextActionsFor(["p1"])).toEqual(new Map());
    const registry = createNextActionRegistry();
    const { source, calls } = fakeNextActions("tasks", { p1: { id: "t1", title: "x" } });
    registry.register(source);
    expect(await registry.nextActionsFor([])).toEqual(new Map());
    expect(calls).toEqual([]);
  });

  test("two sources for a project: the first registered wins; sources run in parallel", async () => {
    const registry = createNextActionRegistry();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const started: string[] = [];
    const slow: NextActionSource = {
      ...fakeNextActions("a", {}).source,
      async nextActionsFor() {
        started.push("a");
        await gate;
        return new Map([["p1", { id: "ta", title: "de a" }]]);
      },
    };
    const fast: NextActionSource = {
      ...fakeNextActions("b", {}).source,
      async nextActionsFor() {
        started.push("b");
        return new Map([
          ["p1", { id: "tb", title: "de b" }],
          ["p2", { id: "tb2", title: "solo b" }],
        ]);
      },
    };
    registry.register(slow);
    registry.register(fast);
    const pending = registry.nextActionsFor(["p1", "p2"]);
    await Promise.resolve();
    expect(started).toEqual(["a", "b"]);
    release();
    const result = await pending;
    expect(result.get("p1")?.id).toBe("ta");
    expect(result.get("p2")?.id).toBe("tb2");
  });

  test("a failing source fails the read (no half-truth on the cards)", async () => {
    const registry = createNextActionRegistry();
    registry.register({
      ...fakeNextActions("tasks", {}).source,
      nextActionsFor: async () => {
        throw new Error("db down");
      },
    });
    await expect(registry.nextActionsFor(["p1"])).rejects.toThrow("db down");
  });

  test("replacing and removing by id", async () => {
    const registry = createNextActionRegistry();
    const first = fakeNextActions("tasks", { p1: { id: "t1", title: "uno" } });
    const second = fakeNextActions("tasks", { p1: { id: "t2", title: "dos" } });
    const removeFirst = registry.register(first.source);
    const removeSecond = registry.register(second.source);
    removeFirst();
    expect((await registry.nextActionsFor(["p1"])).get("p1")?.id).toBe("t2");
    removeSecond();
    expect(registry.size()).toBe(0);
  });

  test("the app's registry", async () => {
    const { source } = fakeNextActions("fake-next", { p1: { id: "t1", title: "x" } });
    const remove = registerNextActionSource(source);
    try {
      expect((await projectNextActions(["p1"])).get("p1")?.title).toBe("x");
    } finally {
      remove();
    }
  });
});

describe("composition root", () => {
  const read = (file: string) => readFileSync(path.resolve(__dirname, "../..", file), "utf8");

  test("registers the providers of tasks by name, never through a side-effect-only import", () => {
    const source = read("src/lib/project-extensions.ts");
    expect(source).not.toMatch(/^import "@\/modules\//m);
    expect(source).toMatch(
      /import \{ tasksProjectSection \} from "@\/modules\/tasks\/project-section";/,
    );
    expect(source).toMatch(
      /import \{ tasksNextActionSource \} from "@\/modules\/tasks\/next-action-source";/,
    );
    const progress = read("src/lib/progress-sources.ts");
    expect(progress).toMatch(
      /import \{ tasksProgressSource \} from "@\/modules\/tasks\/progress-source";/,
    );
  });

  test.each([
    ["src/app/(app)/projects/[id]/page.tsx", "renderProjectSections("],
    ["src/app/(app)/projects/page.tsx", "projectNextActions("],
  ])("%s calls ensureProjectExtensions() before %s", (file, call) => {
    const source = read(file);
    const ensure = source.indexOf("ensureProjectExtensions();");
    expect(ensure).toBeGreaterThan(-1);
    expect(ensure).toBeLessThan(source.indexOf(call, ensure));
  });

  test("projects never imports tasks", () => {
    const files = [
      "src/modules/projects/contracts.ts",
      "src/modules/projects/project-extensions.ts",
      "src/modules/projects/components/project-card.tsx",
      "src/modules/projects/components/next-action-key.tsx",
      "src/app/(app)/projects/page.tsx",
      "src/app/(app)/projects/[id]/page.tsx",
    ];
    for (const file of files) expect(read(file)).not.toMatch(/@\/modules\/tasks/);
  });
});
