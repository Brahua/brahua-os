#!/usr/bin/env node
// Decides, for a pull request, which CI work is needed: it maps the changed files to
//   integration: run | skip        (the Postgres job)
//   e2e:         none | subset | full (the Playwright job)
//   specs:       the E2E specs to run when e2e is `subset`
// Plain Node, no dependencies (the `changes` job of ci.yml runs it without installing anything).
//
//   node scripts/e2e-affected.mjs --base HEAD^1        # changed = git diff base..HEAD
//   node scripts/e2e-affected.mjs --files a.ts b.md    # changed = the given paths
//
// Rule of thumb: when in doubt, run everything. Only these shapes narrow the work:
//   - docs only (markdown, docs/, tasks/, agent config)  -> integration skip, e2e none
//   - unit tests, lint/format config                      -> e2e none
//   - one module's own code, a module's page under src/app/(app)/<route>, e2e specs and the
//     support files only some specs import                -> the specs below
// Anything else (src/lib, src/design-system, core, db schemas, module manifests, config,
// dependencies, workflows, playwright, public, drizzle, scripts, unknown paths) is `full`.
// Docs: docs/HANDOFF.md, "CI: qué corre en cada PR".
import { appendFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * The modules (`src/modules/<id>`) each E2E spec exercises: its own, plus the ones whose data it
 * seeds or whose screens it opens. A spec runs when any of them is affected. `core` means "the
 * shell" (auth, areas, settings, PWA, design system): core code is shared by everything, so a
 * change there is `full` anyway; those specs only run on their own changes or in a full run.
 * `tests/scripts/e2e-affected.test.ts` makes this table complete and checks it against what each
 * spec imports and which routes it opens: a new spec or route must be added here.
 */
export const SPEC_MODULES = {
  "areas-order.spec.ts": ["core"],
  "areas.spec.ts": ["core"],
  "capture-nl-finance.spec.ts": ["finance", "tasks", "projects"],
  "capture-nl-tasks.spec.ts": ["tasks", "finance", "projects"],
  "design-system.spec.ts": ["core"],
  "error-pages.spec.ts": ["core"],
  "finance-email.spec.ts": ["finance"],
  "finance-installments.spec.ts": ["finance", "today"],
  "finance-payments.spec.ts": ["finance", "today"],
  "finance-summary.spec.ts": ["finance"],
  "finance.spec.ts": ["finance", "projects", "habits"],
  "goals.spec.ts": ["goals"],
  "habits-dayparts.spec.ts": ["habits", "today", "tasks"],
  "habits-history.spec.ts": ["habits"],
  "habits-measure.spec.ts": ["habits"],
  "habits-organize.spec.ts": ["habits"],
  "habits-skip.spec.ts": ["habits", "tasks"],
  "habits-streaks.spec.ts": ["habits"],
  "habits.spec.ts": ["habits", "today"],
  "household.spec.ts": ["household", "tasks"],
  "home.spec.ts": ["today", "tasks", "habits", "finance", "projects"],
  "login.spec.ts": ["core"],
  "passkey.spec.ts": ["core"],
  "project-dependencies.spec.ts": ["projects"],
  "project-detail.spec.ts": ["projects"],
  "project-milestones.spec.ts": ["projects"],
  "project-notes-links.spec.ts": ["projects"],
  "project-tasks.spec.ts": ["projects", "tasks"],
  "projects.spec.ts": ["projects"],
  "pwa.spec.ts": ["core", "projects"],
  "reminders.spec.ts": ["reminders", "habits", "finance", "tasks"],
  "settings.spec.ts": ["core"],
  "task-tags.spec.ts": ["tasks"],
  "task-time.spec.ts": ["tasks", "habits"],
  "task-views.spec.ts": ["tasks"],
  "tasks-recurrence.spec.ts": ["tasks"],
  "tasks.spec.ts": ["tasks", "projects", "core"],
  "theme.spec.ts": ["core"],
  "today-day-complete.spec.ts": ["today", "habits", "tasks"],
  "today-evening-close.spec.ts": ["today", "habits", "tasks"],
  "today-greeting.spec.ts": ["today", "habits", "tasks"],
  "today-installments.spec.ts": ["today", "finance", "habits", "tasks"],
  "today-payments.spec.ts": ["today", "finance", "habits", "tasks"],
  "today-postpone.spec.ts": ["today", "habits", "tasks"],
  "today-projects.spec.ts": ["today", "projects", "tasks"],
  "today-tasks.spec.ts": ["today", "habits", "tasks", "finance"],
  "today.spec.ts": ["today", "habits", "tasks", "finance", "projects"],
  "weekly-review.spec.ts": ["weekly-review", "habits", "tasks", "goals", "projects"],
};

/** Route segments that belong to a module (an E2E spec that opens one exercises that module). */
export const ROUTE_MODULES = {
  tasks: "tasks",
  projects: "projects",
  habits: "habits",
  goals: "goals",
  review: "weekly-review",
  finance: "finance",
  "settings/reminders": "reminders",
  "api/telegram": "reminders",
  "api/reminders": "reminders",
  areas: "core",
  settings: "core",
  design: "core",
  login: "core",
  "api/auth": "core",
};

/** Pages of `src/app/(app)` that have no module of their own: the specs that open the route run. */
const LEAF_ROUTES = ["areas", "design", "settings"];

const DOC_ROOTS = /^(docs|tasks|\.claude|\.agents)\//;
// Markdown anywhere except where it could be app content or a test fixture.
const CODE_ROOTS = /^(src|e2e|tests|scripts|drizzle|public)\//;
// Changes that cannot alter what the browser sees (they still run in `checks`).
const E2E_IRRELEVANT = [
  /^tests\/(?!integration\/|support\/)/,
  /^eslint\.config\.mjs$/,
  /^\.prettierrc\.json$/,
  /^\.prettierignore$/,
  /^\.env\.example$/,
  /^\.vercelignore$/,
  /^skills-lock\.json$/,
  /^vitest(\.integration)?\.config\.mts$/,
];

/** True for a file that is only documentation (or agent configuration). */
export function isDocFile(file) {
  if (DOC_ROOTS.test(file) || file === "skills-lock.json") return true;
  return /\.md$/i.test(file) && !CODE_ROOTS.test(file);
}

const specPath = (name) => `e2e/${name}`;
const SPEC_NAME = /^[a-z0-9][a-z0-9-]*\.spec\.ts$/;

/**
 * Reads what the selection needs from a checkout: the specs, the modules' import graph, the
 * specs' sources and the E2E import graph. Everything is a plain value so tests can build a small
 * repository by hand.
 */
export function loadRepo(root = process.cwd()) {
  const read = (p) => readFileSync(path.join(root, p), "utf8");
  const walk = (dir) =>
    readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? walk(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`],
    );
  const e2eFiles = walk("e2e").filter((f) => !f.startsWith("e2e/__screenshots__/"));
  const specs = e2eFiles
    .filter((f) => /^e2e\/[^/]+\.spec\.ts$/.test(f))
    .map((f) => f.slice("e2e/".length))
    .sort();
  const modules = readdirSync(path.join(root, "src/modules"), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  const moduleDeps = {};
  for (const m of modules) {
    const deps = new Set();
    for (const f of walk(`src/modules/${m}`).filter((x) => /\.(ts|tsx)$/.test(x))) {
      for (const x of read(f).matchAll(/["']@\/modules\/([a-z0-9-]+)/g)) {
        if (x[1] !== m) deps.add(x[1]);
      }
    }
    moduleDeps[m] = [...deps].sort();
  }
  const sources = Object.fromEntries(
    [...e2eFiles, "playwright.config.ts"].map((f) => [f, read(f)]),
  );
  return {
    specs,
    modules,
    moduleDeps,
    sources,
    table: SPEC_MODULES,
    exists: (p) => existsSync(path.join(root, p)),
  };
}

/** `dir/file` imports found in a source (relative specifiers and quoted file names). */
function e2eEdges(file, sources) {
  const out = new Set();
  const text = sources[file];
  const dir = path.posix.dirname(file);
  for (const m of text.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
    const base = path.posix.normalize(`${dir}/${m[1]}`);
    for (const cand of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
      if (cand in sources) out.add(cand);
    }
  }
  // Non-TS support files (stylesheets) are referenced by their file name.
  for (const other of Object.keys(sources)) {
    if (other !== file && !/\.tsx?$/.test(other) && text.includes(path.posix.basename(other))) {
      out.add(other);
    }
  }
  return out;
}

/** Every E2E-side file that (transitively) imports `file`, `file` included. */
function importersOf(file, sources) {
  const reverse = new Map();
  for (const f of Object.keys(sources)) {
    for (const dep of e2eEdges(f, sources)) {
      if (!reverse.has(dep)) reverse.set(dep, new Set());
      reverse.get(dep).add(f);
    }
  }
  const seen = new Set([file]);
  const queue = [file];
  while (queue.length > 0) {
    for (const next of reverse.get(queue.shift()) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

/** The module itself plus every module that (transitively) imports it. */
export function affectedModules(changed, moduleDeps) {
  const set = new Set(changed);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [m, deps] of Object.entries(moduleDeps)) {
      if (!set.has(m) && deps.some((d) => set.has(d))) {
        set.add(m);
        grew = true;
      }
    }
  }
  return set;
}

/** Route strings a spec opens, from its source: `"/tasks…"`, `"/api/telegram…"`. */
export function routesOpenedBy(source) {
  const found = new Set();
  for (const route of Object.keys(ROUTE_MODULES)) {
    const re = new RegExp(`["'\`]/${route.replaceAll("/", "\\/")}(?=["'\`/?#]|$)`);
    if (re.test(source)) found.add(route);
  }
  return found;
}

const FULL = (reason) => ({ kind: "full", reason });

/**
 * What one changed file asks for: `ignore`, `full`, or `specs` (a module, some routes or some
 * files whose specs must run).
 */
export function classifyFile(file, repo) {
  if (isDocFile(file)) return { kind: "docs" };
  if (E2E_IRRELEVANT.some((re) => re.test(file))) return { kind: "ignore" };

  let m = file.match(/^e2e\/__screenshots__\/([^/]+\.spec\.ts)\//);
  if (m)
    return repo.specs.includes(m[1])
      ? { kind: "specs", specs: [m[1]] }
      : FULL("screenshots of a removed spec");

  if (file.startsWith("e2e/")) {
    if (!repo.exists(file)) return FULL(`${file} was deleted or renamed`);
    if (!(file in repo.sources)) return FULL(`${file} is new E2E support: run everything once`);
    const importers = importersOf(file, repo.sources);
    // global-setup, the auth setup, the Playwright config and the fake Telegram server run for
    // every spec.
    const shared = [...importers].filter((f) => !/^e2e\/[^/]+\.spec\.ts$/.test(f) && f !== file);
    const runsAlways = (f) =>
      f === "playwright.config.ts" ||
      f === "e2e/global-setup.ts" ||
      f === "e2e/auth.setup.ts" ||
      f === "e2e/support/fake-telegram-server.ts";
    if (runsAlways(file) || shared.some(runsAlways)) return FULL(`${file} is used by every run`);
    const specs = [...importers]
      .map((f) => f.match(/^e2e\/([^/]+\.spec\.ts)$/)?.[1])
      .filter(Boolean);
    return { kind: "specs", specs };
  }

  m = file.match(/^src\/modules\/([a-z0-9-]+)\/(.+)$/);
  if (m) {
    const [, id, rest] = m;
    if (!repo.modules.includes(id)) return FULL(`${file}: unknown module`);
    if (id === "core") return FULL("core is shared by every module");
    if (rest === "module.ts") return FULL(`${id}'s manifest feeds the navigation of every page`);
    if (/^db\//.test(rest)) return FULL(`${id}'s database schema is shared by every module`);
    return { kind: "modules", modules: [id], withDependents: true };
  }

  m = file.match(/^src\/app\/\(app\)\/(.+)$/);
  if (m) {
    const rest = m[1];
    if (rest === "page.tsx") {
      return {
        kind: "modules",
        modules: ["today", ...repo.moduleDeps.today],
        withDependents: false,
      };
    }
    if (rest.startsWith("settings/reminders/")) return { kind: "modules", modules: ["reminders"] };
    const route = rest.split("/")[0];
    if (["tasks", "projects", "habits", "finance", "goals"].includes(route)) {
      return { kind: "modules", modules: [route], routes: [route] };
    }
    // /review belongs to `weekly-review` (its route and module ids differ).
    if (route === "review") {
      return { kind: "modules", modules: ["weekly-review"], routes: ["review"] };
    }
    if (LEAF_ROUTES.includes(route)) return { kind: "routes", routes: [route] };
    return FULL(`${file}: the layout and shared pieces of (app)`);
  }
  if (/^src\/app\/api\/(telegram|reminders)\//.test(file)) {
    return { kind: "modules", modules: ["reminders"], routes: ["api/telegram", "api/reminders"] };
  }
  return FULL(`${file}: shared or unknown code`);
}

/**
 * The decision for a list of changed files. `specs` are bare names (`tasks.spec.ts`).
 * `reasons` explain every `full` and the specs picked, for the job summary.
 */
export function selectWork(changed, repo) {
  const files = [...new Set(changed)].filter(Boolean);
  const reasons = [];
  if (files.length > 0 && files.every(isDocFile)) {
    return { integration: "skip", e2e: "none", specs: [], reasons: ["Solo documentación."] };
  }
  if (files.length === 0) {
    return {
      integration: "run",
      e2e: "full",
      specs: [],
      reasons: ["Sin archivos: suite completa."],
    };
  }
  const picked = new Set();
  const modules = new Set();
  const routes = new Set();
  const withDependents = new Set();
  let full = false;
  for (const file of files) {
    const c = classifyFile(file, repo);
    if (c.kind === "full") {
      full = true;
      reasons.push(c.reason);
    } else if (c.kind === "specs") {
      c.specs.forEach((s) => picked.add(s));
    } else if (c.kind === "modules") {
      c.modules.forEach((x) => (c.withDependents ? withDependents : modules).add(x));
      (c.routes ?? []).forEach((r) => routes.add(r));
    } else if (c.kind === "routes") {
      c.routes.forEach((r) => routes.add(r));
    }
  }
  if (full) return { integration: "run", e2e: "full", specs: [], reasons };

  const hit = new Set([...modules, ...affectedModules(withDependents, repo.moduleDeps)]);
  for (const spec of repo.specs) {
    const owned = repo.table[spec];
    const opened = routesOpenedBy(repo.sources[specPath(spec)] ?? "");
    if (owned === undefined) {
      picked.add(spec); // not in the table: always run it (the unit test asks for an entry)
      continue;
    }
    if (owned.some((x) => hit.has(x)) || [...opened].some((r) => routes.has(r))) picked.add(spec);
  }
  const specs = [...picked].filter((s) => repo.specs.includes(s)).sort();
  if (specs.length === 0) {
    return {
      integration: "run",
      e2e: "none",
      specs: [],
      reasons: ["Ningún cambio afecta al navegador."],
    };
  }
  if (specs.length === repo.specs.length) {
    return {
      integration: "run",
      e2e: "full",
      specs: [],
      reasons: ["Los cambios alcanzan todas las specs."],
    };
  }
  reasons.push(`Módulos afectados: ${[...hit].sort().join(", ") || "ninguno"}.`);
  return { integration: "run", e2e: "subset", specs, reasons };
}

function changedFromGit(base) {
  const out = execFileSync("git", ["diff", "--name-only", "--no-renames", base, "HEAD"], {
    encoding: "utf8",
  });
  return out.split("\n").filter(Boolean);
}

function render(work, changed, total) {
  const lines = [
    "## CI: qué corre en este PR",
    "",
    `- Archivos cambiados: ${changed.length}`,
    `- Integración: **${work.integration === "run" ? "corre" : "se salta"}**`,
    `- E2E: **${{ none: "se salta", full: "suite completa", subset: `${work.specs.length} de ${total} specs` }[work.e2e]}**`,
    ...work.reasons.map((r) => `- ${r}`),
  ];
  if (work.e2e === "subset") lines.push("", ...work.specs.map((s) => `  - \`e2e/${s}\``));
  return `${lines.join("\n")}\n`;
}

function main(argv) {
  const baseAt = argv.indexOf("--base");
  const filesAt = argv.indexOf("--files");
  const changed =
    filesAt >= 0
      ? argv.slice(filesAt + 1)
      : changedFromGit(baseAt >= 0 ? argv[baseAt + 1] : "HEAD^1");
  const repo = loadRepo();
  const work = selectWork(changed, repo);
  // Spec names come from the repository's own file names; a name that does not look like one
  // (PR-controlled paths never reach this output) falls back to the full suite.
  if (work.specs.some((s) => !SPEC_NAME.test(s))) {
    work.e2e = "full";
    work.specs = [];
  }
  const summary = render(work, changed, repo.specs.length);
  const outputs = [
    `integration=${work.integration}`,
    `e2e=${work.e2e}`,
    `specs=${work.specs.map(specPath).join(" ")}`,
  ];
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `${outputs.join("\n")}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  else process.stdout.write(`${outputs.join("\n")}\n\n${summary}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
