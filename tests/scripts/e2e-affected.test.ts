// Which CI work a pull request needs (scripts/e2e-affected.mjs). Two layers:
//   1. a synthetic repository, to pin the rules down (every kind of change);
//   2. the real repository, to keep SPEC_MODULES complete and honest as specs are added.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  affectedModules,
  classifyFile,
  isDocFile,
  loadRepo,
  ROUTE_MODULES,
  routesOpenedBy,
  selectWork,
} from "../../scripts/e2e-affected.mjs";

// --- 1. synthetic repository ---------------------------------------------------------------

const specSource = (route: string) =>
  `import { x } from "./support/helper";\nawait page.goto("/${route}");`;

const synthetic = {
  specs: ["areas.spec.ts", "habits.spec.ts", "projects.spec.ts", "tasks.spec.ts", "today.spec.ts"],
  modules: ["core", "habits", "projects", "tasks", "today"],
  // tasks imports projects; today imports tasks and habits (like the real graph)
  moduleDeps: {
    core: [],
    habits: [],
    projects: [],
    tasks: ["projects"],
    today: ["habits", "tasks"],
  },
  sources: {
    "e2e/areas.spec.ts": specSource("areas"),
    "e2e/habits.spec.ts": specSource("habits"),
    "e2e/projects.spec.ts": specSource("projects"),
    "e2e/tasks.spec.ts": specSource("tasks"),
    "e2e/today.spec.ts": 'await page.goto("/");',
    "e2e/support/helper.ts": 'import { y } from "./leaf";',
    "e2e/support/leaf.ts": "",
    "e2e/support/only-habits.ts": "",
    "e2e/support/theme.css": "",
    "e2e/support/uses-css.ts": 'addStyleTag({ path: "theme.css" })',
    "e2e/global-setup.ts": 'import { s } from "./support/seeded";',
    "e2e/support/seeded.ts": "",
    "e2e/auth.setup.ts": "",
    "playwright.config.ts": 'import { o } from "./e2e/support/owner";',
    "e2e/support/owner.ts": "",
  } as Record<string, string>,
  exists: (file: string) => !file.includes("deleted"),
  table: {
    "areas.spec.ts": ["core"],
    "habits.spec.ts": ["habits"],
    "projects.spec.ts": ["projects"],
    "tasks.spec.ts": ["tasks"],
    "today.spec.ts": ["today"],
  } as Record<string, string[]>,
};
// habits.spec also imports the habits-only helper
synthetic.sources["e2e/habits.spec.ts"] += '\nimport { h } from "./support/only-habits";';
synthetic.sources["e2e/today.spec.ts"] += '\nimport { u } from "./support/uses-css";';

describe("selectWork on a synthetic repository", () => {
  const work = (...files: string[]) => selectWork(files, synthetic);

  test.each([
    [["docs/HANDOFF.md"]],
    [["CLAUDE.md", "tasks/todo.md", "SPEC-core.md", "CAPABILITY-MAP.md"]],
    [["docs/benchmark-rimu.html"]],
    [[".claude/agents/code-reviewer.md", ".agents/skills/neon/SKILL.md"]],
  ])("docs only %j: no integration, no E2E", (files) => {
    expect(work(...files)).toMatchObject({ integration: "skip", e2e: "none", specs: [] });
  });

  test("a markdown file inside code is code, not docs", () => {
    expect(isDocFile("src/modules/tasks/notes.md")).toBe(false);
    expect(isDocFile("e2e/notes.md")).toBe(false);
    expect(isDocFile("README.md")).toBe(true);
    expect(work("docs/x.md", "package.json").e2e).toBe("full");
  });

  test("a module change runs the specs of the module and of what imports it", () => {
    expect(work("src/modules/projects/project-input.ts")).toMatchObject({
      integration: "run",
      e2e: "subset",
      specs: ["projects.spec.ts", "tasks.spec.ts", "today.spec.ts"],
    });
    expect(work("src/modules/habits/habit-copy.ts").specs).toEqual([
      "habits.spec.ts",
      "today.spec.ts",
    ]);
    expect(work("src/modules/today/today-copy.ts").specs).toEqual(["today.spec.ts"]);
  });

  test("a module's page runs the specs of the module and of the ones that open the route", () => {
    expect(work("src/app/(app)/habits/page.tsx").specs).toEqual(["habits.spec.ts"]);
    // today.spec opens "/" only: not selected by the habits page
    expect(work("src/app/(app)/areas/page.tsx").specs).toEqual(["areas.spec.ts"]);
  });

  test("the home page runs today and everything it composes", () => {
    expect(work("src/app/(app)/page.tsx").specs).toEqual([
      "habits.spec.ts",
      "tasks.spec.ts",
      "today.spec.ts",
    ]);
  });

  test("a spec change runs that spec, a support file runs its importers", () => {
    expect(work("e2e/tasks.spec.ts")).toMatchObject({ e2e: "subset", specs: ["tasks.spec.ts"] });
    // leaf is imported by helper, which every synthetic spec imports... except today
    expect(work("e2e/support/leaf.ts").specs).toEqual([
      "areas.spec.ts",
      "habits.spec.ts",
      "projects.spec.ts",
      "tasks.spec.ts",
    ]);
    expect(work("e2e/support/only-habits.ts").specs).toEqual(["habits.spec.ts"]);
    expect(work("e2e/support/theme.css").specs).toEqual(["today.spec.ts"]);
  });

  test("screenshots belong to their spec", () => {
    expect(work("e2e/__screenshots__/tasks.spec.ts/inbox-desktop.png").specs).toEqual([
      "tasks.spec.ts",
    ]);
    expect(work("e2e/__screenshots__/gone.spec.ts/x.png").e2e).toBe("full");
  });

  test.each([
    "src/lib/time.ts",
    "src/design-system/key.tsx",
    "src/modules/core/owner.ts",
    "src/modules/tasks/module.ts",
    "src/modules/tasks/db/schema.ts",
    "src/app/layout.tsx",
    "src/app/(app)/layout.tsx",
    "src/app/(app)/_components/nav.tsx",
    "src/app/api/auth/[...all]/route.ts",
    "src/app/globals.css",
    "src/modules/unknown/x.ts",
    "playwright.config.ts",
    "next.config.ts",
    "package.json",
    "pnpm-lock.yaml",
    ".github/workflows/ci.yml",
    "drizzle/0001_x.sql",
    "scripts/vercel-build.sh",
    "public/sw.js",
    "tests/integration/helpers.ts",
    "tests/support/fake-telegram.ts",
    "e2e/global-setup.ts",
    "e2e/auth.setup.ts",
    "e2e/support/owner.ts", // imported by playwright.config.ts
    "e2e/support/seeded.ts", // imported by global-setup
    "e2e/support/deleted.ts",
    "e2e/support/brand-new-helper.ts",
    "totally/unknown/file.txt",
  ])("shared or unknown code runs everything: %s", (file) => {
    expect(work(file)).toMatchObject({ integration: "run", e2e: "full", specs: [] });
  });

  test("one shared file among narrow ones wins", () => {
    expect(work("src/modules/habits/habit-copy.ts", "src/lib/time.ts").e2e).toBe("full");
    expect(work("src/modules/habits/habit-copy.ts", "docs/HANDOFF.md").e2e).toBe("subset");
  });

  test("unit tests and lint config skip E2E but keep integration", () => {
    expect(work("tests/app/tasks-list.test.tsx")).toMatchObject({
      integration: "run",
      e2e: "none",
    });
    expect(work("eslint.config.mjs", ".prettierrc.json")).toMatchObject({
      integration: "run",
      e2e: "none",
    });
  });

  test("changes that reach every spec become the full suite", () => {
    const files = [
      "src/modules/projects/project-input.ts",
      "src/modules/habits/habit-copy.ts",
      "src/app/(app)/areas/page.tsx",
    ];
    expect(work(...files)).toMatchObject({ e2e: "full", specs: [] });
  });

  test("a spec missing from the table always runs", () => {
    const repo = {
      ...synthetic,
      specs: [...synthetic.specs, "new.spec.ts"],
      sources: { ...synthetic.sources, "e2e/new.spec.ts": "" },
    };
    expect(selectWork(["src/modules/today/today-copy.ts"], repo).specs).toEqual([
      "new.spec.ts",
      "today.spec.ts",
    ]);
  });

  test("no changed files means the full suite", () => {
    expect(selectWork([], synthetic)).toMatchObject({ integration: "run", e2e: "full" });
  });

  test("affectedModules follows imports transitively", () => {
    expect([...affectedModules(["projects"], synthetic.moduleDeps)].sort()).toEqual([
      "projects",
      "tasks",
      "today",
    ]);
    expect([...affectedModules(["today"], synthetic.moduleDeps)]).toEqual(["today"]);
  });

  test("routesOpenedBy finds routes in quotes, with query strings and sub-paths", () => {
    const opened = routesOpenedBy(
      'goto("/tasks?vista=hoy"); goto(`/habits/${id}`); "/projects"; "/api/telegram/webhook"; "/tasksx"',
    );
    expect([...opened].sort()).toEqual(["api/telegram", "habits", "projects", "tasks"]);
  });
});

// --- 2. the real repository ----------------------------------------------------------------

describe("SPEC_MODULES against the real repository", () => {
  const repo = loadRepo();
  const table = repo.table as Record<string, string[]>;
  const SUPPORT_HINTS: Record<string, string> = {
    finance: "finance",
    habits: "habits",
    goals: "goals",
    tasks: "tasks",
    "task-views": "tasks",
    "task-tags": "tasks",
    recurrence: "tasks",
    "project-tasks": "tasks",
    "today-tasks": "tasks",
    reminders: "reminders",
    "project-notes-links": "projects",
    areas: "core",
  };

  test("every spec has an entry and no entry is stale", () => {
    expect(Object.keys(table).sort()).toEqual(repo.specs);
  });

  test("every module of the table exists", () => {
    const known = new Set(repo.modules);
    const unknown = Object.entries(table).flatMap(([spec, mods]) =>
      mods.filter((m) => !known.has(m)).map((m) => `${spec}: ${m}`),
    );
    expect(unknown).toEqual([]);
  });

  test("a spec lists the modules it imports, the routes it opens and the helpers it seeds with", () => {
    const missing: string[] = [];
    for (const spec of repo.specs) {
      const text = repo.sources[`e2e/${spec}`];
      const listed = new Set(table[spec]);
      const needed = new Set<string>();
      for (const m of text.matchAll(/(?:@\/|\.\.\/src\/)modules\/([a-z0-9-]+)/g)) needed.add(m[1]);
      for (const route of routesOpenedBy(text))
        needed.add(ROUTE_MODULES[route as keyof typeof ROUTE_MODULES]);
      for (const m of text.matchAll(/from "\.\/support\/([a-z0-9-]+)"/g))
        if (SUPPORT_HINTS[m[1]]) needed.add(SUPPORT_HINTS[m[1]]);
      // `core` is not selective (a core change is `full`; leaf routes match by route), so skip it.
      for (const m of needed)
        if (m !== "core" && !listed.has(m)) missing.push(`${spec} should list "${m}"`);
    }
    expect(missing).toEqual([]);
  });

  test("a spec lists its own module (its name starts with it)", () => {
    const own: Record<string, string> = {
      finance: "finance",
      habits: "habits",
      goals: "goals",
      project: "projects",
      task: "tasks",
      today: "today",
      reminders: "reminders",
      "weekly-review": "weekly-review",
    };
    const wrong = repo.specs.flatMap((spec: string) => {
      const prefix = Object.keys(own).find((p) => spec.startsWith(p));
      return prefix && !table[spec].includes(own[prefix]) ? [spec] : [];
    });
    expect(wrong).toEqual([]);
  });

  // Case table on real files: changed file -> what runs.
  const cases: Array<[string, { e2e: string; has?: string[]; hasNot?: string[] }]> = [
    ["docs/HANDOFF.md", { e2e: "none" }],
    [
      "src/modules/habits/habits-copy.ts",
      {
        e2e: "subset",
        // weekly-review reads habits through its contract: it is a dependent.
        has: ["habits.spec.ts", "habits-streaks.spec.ts", "today.spec.ts", "weekly-review.spec.ts"],
        hasNot: ["projects.spec.ts", "finance-summary.spec.ts", "login.spec.ts"],
      },
    ],
    [
      "src/modules/finance/finance-copy.ts",
      {
        e2e: "subset",
        has: ["finance.spec.ts", "today-payments.spec.ts", "reminders.spec.ts"],
        hasNot: ["habits-streaks.spec.ts", "project-detail.spec.ts"],
      },
    ],
    [
      "src/modules/projects/project-constants.ts",
      {
        e2e: "subset",
        has: [
          "projects.spec.ts",
          "project-tasks.spec.ts",
          "tasks.spec.ts",
          "today-projects.spec.ts",
        ],
        hasNot: ["finance-summary.spec.ts", "habits-history.spec.ts"],
      },
    ],
    [
      "src/modules/reminders/telegram.ts",
      {
        e2e: "subset",
        has: ["reminders.spec.ts", "finance.spec.ts", "habits.spec.ts", "tasks.spec.ts"],
        hasNot: ["login.spec.ts", "project-detail.spec.ts"],
      },
    ],
    [
      "src/modules/today/today-copy.ts",
      {
        e2e: "subset",
        has: ["today.spec.ts", "home.spec.ts"],
        hasNot: ["tasks.spec.ts", "finance-summary.spec.ts"],
      },
    ],
    [
      // The /review route has its own module id (`weekly-review`): the page runs its spec only.
      "src/app/(app)/review/page.tsx",
      {
        e2e: "subset",
        has: ["weekly-review.spec.ts"],
        hasNot: ["goals.spec.ts", "tasks.spec.ts", "habits.spec.ts", "today.spec.ts"],
      },
    ],
    [
      "src/app/(app)/finance/page.tsx",
      {
        e2e: "subset",
        has: ["finance.spec.ts", "finance-summary.spec.ts"],
        hasNot: ["habits-history.spec.ts", "tasks.spec.ts"],
      },
    ],
    [
      "src/app/(app)/areas/page.tsx",
      {
        e2e: "subset",
        has: ["areas.spec.ts", "areas-order.spec.ts", "tasks.spec.ts"],
        hasNot: ["finance.spec.ts"],
      },
    ],
    [
      "src/app/(app)/settings/reminders/page.tsx",
      { e2e: "subset", has: ["reminders.spec.ts"], hasNot: ["tasks.spec.ts", "settings.spec.ts"] },
    ],
    [
      "src/app/api/telegram/webhook/route.ts",
      { e2e: "subset", has: ["reminders.spec.ts"], hasNot: ["login.spec.ts"] },
    ],
    // finance.ts is imported (through today-tasks) by global-setup: it runs for every spec
    ["e2e/support/finance.ts", { e2e: "full" }],
    [
      "e2e/support/task-tags.ts",
      { e2e: "subset", has: ["task-tags.spec.ts"], hasNot: ["tasks.spec.ts"] },
    ],
    ["e2e/support/hide-app-nav.css", { e2e: "subset" }],
    [
      "e2e/habits-skip.spec.ts",
      { e2e: "subset", has: ["habits-skip.spec.ts"], hasNot: ["habits.spec.ts"] },
    ],
    [
      "e2e/__screenshots__/project-detail.spec.ts/detail-dark-desktop.png",
      { e2e: "subset", has: ["project-detail.spec.ts"], hasNot: ["projects.spec.ts"] },
    ],
    ["tests/app/today-board.test.tsx", { e2e: "none" }],
    ["src/lib/time.ts", { e2e: "full" }],
    ["src/design-system/key.tsx", { e2e: "full" }],
    ["src/modules/core/life-areas.ts", { e2e: "full" }],
    ["src/modules/tasks/module.ts", { e2e: "full" }],
    ["src/modules/finance/db/schema.ts", { e2e: "full" }],
    ["src/app/(app)/layout.tsx", { e2e: "full" }],
    ["playwright.config.ts", { e2e: "full" }],
    ["e2e/global-setup.ts", { e2e: "full" }],
    ["e2e/support/owner.ts", { e2e: "full" }],
    ["e2e/support/screenshots.ts", { e2e: "subset", hasNot: ["tasks-recurrence.spec.ts"] }],
    ["package.json", { e2e: "full" }],
    [".github/workflows/ci.yml", { e2e: "full" }],
    ["drizzle/meta/_journal.json", { e2e: "full" }],
  ];
  test.each(cases)("%s", (file, expected) => {
    const work = selectWork([file], repo);
    expect(work.e2e).toBe(expected.e2e);
    for (const spec of expected.has ?? []) expect(work.specs).toContain(spec);
    for (const spec of expected.hasNot ?? []) expect(work.specs).not.toContain(spec);
    if (expected.e2e !== "subset") expect(work.specs).toEqual([]);
  });

  test("classifyFile never leaves a source file undecided", () => {
    const kinds = new Set(["docs", "ignore", "full", "specs", "modules", "routes"]);
    for (const file of [
      "src/modules/tasks/x.ts",
      "src/app/(app)/tasks/x.tsx",
      "e2e/support/png.ts",
      "README.md",
      "zzz",
    ]) {
      expect(kinds.has(classifyFile(file, repo).kind)).toBe(true);
    }
  });
});

// --- 3. the command line -------------------------------------------------------------------

describe("the command line", () => {
  const run = (args: string[], env: Record<string, string> = {}) =>
    spawnSync(process.execPath, [path.resolve("scripts/e2e-affected.mjs"), ...args], {
      encoding: "utf8",
      env: { ...process.env, GITHUB_OUTPUT: "", GITHUB_STEP_SUMMARY: "", ...env },
    });

  test("prints the outputs and a Spanish summary", () => {
    const result = run(["--files", "docs/HANDOFF.md"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("integration=skip\ne2e=none\nspecs=\n");
    expect(result.stdout).toContain("Solo documentación");
  });

  test("writes the outputs to $GITHUB_OUTPUT with e2e/ paths", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "e2e-affected-"));
    try {
      const out = path.join(dir, "out");
      writeFileSync(out, "");
      const result = run(["--files", "src/modules/habits/habits-copy.ts"], { GITHUB_OUTPUT: out });
      expect(result.status).toBe(0);
      const text = readFileSync(out, "utf8");
      expect(text).toContain("integration=run\ne2e=subset\nspecs=e2e/");
      expect(text).toContain("e2e/habits.spec.ts");
      expect(text).not.toContain("e2e/login.spec.ts");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a failing git diff fails the command (the workflow then runs everything)", () => {
    expect(run(["--base", "not-a-ref-at-all"]).status).not.toBe(0);
  });
});
