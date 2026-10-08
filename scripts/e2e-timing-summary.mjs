#!/usr/bin/env node
// Turns Playwright's JSON report (playwright-results.json) into a markdown timing summary for
// $GITHUB_STEP_SUMMARY (stdout when the variable is unset). Plain Node, no dependencies.
//
//   node scripts/e2e-timing-summary.mjs [path/to/playwright-results.json]
//
// A test's time is the sum of all its attempts (retries included): it is what the runner spent.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const TOP_TESTS = 20;
const TOP_FILES = 10;

/** Walks the (nested) suites and returns one row per test, with every attempt summed. */
export function collectTests(report) {
  const rows = [];
  const visit = (suite, titles) => {
    const here = suite.title ? [...titles, suite.title] : titles;
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const results = test.results ?? [];
        rows.push({
          file: spec.file ?? suite.file ?? "?",
          title: [...here.slice(1), spec.title].join(" › "),
          project: test.projectName ?? "?",
          status: test.status ?? "unknown",
          attempts: results.length,
          ms: results.reduce((sum, r) => sum + (r.duration ?? 0), 0),
          startMs: results.length > 0 ? Date.parse(results[0].startTime) : Number.NaN,
        });
      }
    }
    for (const child of suite.suites ?? []) visit(child, here);
  };
  for (const suite of report.suites ?? []) visit(suite, []);
  return rows;
}

const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;
const minutes = (ms) => `${(ms / 60000).toFixed(1)} min`;
const cell = (text) => String(text).replaceAll("|", "\\|").replaceAll("\n", " ");

export function buildSummary(report) {
  const tests = collectTests(report);
  const stats = report.stats ?? {};
  const wall = stats.duration ?? 0;
  const lines = ["## E2E: resumen de tiempos", ""];

  const starts = tests.filter((t) => t.status !== "skipped").map((t) => t.startMs);
  const first = Math.min(...starts.filter(Number.isFinite));
  const runStart = Date.parse(stats.startTime);
  const startup = Number.isFinite(first) && Number.isFinite(runStart) ? first - runStart : null;

  lines.push(
    `- Duración total (reloj): **${minutes(wall)}** (${seconds(wall)})`,
    `- Tests: ${tests.length} (esperados ${stats.expected ?? "?"}, inesperados ${stats.unexpected ?? "?"}, flaky ${stats.flaky ?? "?"}, saltados ${stats.skipped ?? "?"})`,
  );
  if (startup !== null) {
    lines.push(
      `- Arranque hasta el primer test: **${seconds(Math.max(0, startup))}** (aprox. el \`webServer\`: \`pnpm build\` + \`pnpm start\`, más el fake de Telegram y el setup global)`,
    );
  }

  const retried = tests.filter((t) => t.attempts > 1);
  lines.push(
    `- Tests con reintento: ${retried.length} (flaky: ${tests.filter((t) => t.status === "flaky").length}, siguen fallando: ${retried.filter((t) => t.status === "unexpected").length})`,
    "",
    "### Por proyecto",
    "",
    "| Proyecto | Tests | Suma de duraciones |",
    "| --- | ---: | ---: |",
  );
  const byProject = new Map();
  for (const t of tests) {
    const p = byProject.get(t.project) ?? { n: 0, ms: 0 };
    p.n += 1;
    p.ms += t.ms;
    byProject.set(t.project, p);
  }
  for (const [name, p] of [...byProject].sort((a, b) => b[1].ms - a[1].ms)) {
    lines.push(`| ${cell(name)} | ${p.n} | ${seconds(p.ms)} |`);
  }
  lines.push(
    "",
    "_La suma cuenta el trabajo de todos los workers a la vez: no es el reloj._",
    "",
    `### Los ${TOP_TESTS} tests más lentos`,
    "",
    "| Duración | Proyecto | Test | Intentos |",
    "| ---: | --- | --- | ---: |",
  );
  for (const t of [...tests].sort((a, b) => b.ms - a.ms).slice(0, TOP_TESTS)) {
    lines.push(
      `| ${seconds(t.ms)} | ${cell(t.project)} | ${cell(`${t.file}: ${t.title}`)} | ${t.attempts} |`,
    );
  }

  const byFile = new Map();
  for (const t of tests) {
    const f = byFile.get(t.file) ?? { n: 0, ms: 0 };
    f.n += 1;
    f.ms += t.ms;
    byFile.set(t.file, f);
  }
  lines.push(
    "",
    `### Los ${TOP_FILES} specs con más tiempo`,
    "",
    "| Suma | Tests | Spec |",
    "| ---: | ---: | --- |",
  );
  for (const [file, f] of [...byFile].sort((a, b) => b[1].ms - a[1].ms).slice(0, TOP_FILES)) {
    lines.push(`| ${seconds(f.ms)} | ${f.n} | ${cell(file)} |`);
  }
  if (retried.length > 0) {
    lines.push("", "### Reintentos", "", "| Estado | Proyecto | Test |", "| --- | --- | --- |");
    for (const t of retried) {
      lines.push(`| ${t.status} | ${cell(t.project)} | ${cell(`${t.file}: ${t.title}`)} |`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function main() {
  const input = process.argv[2] ?? "playwright-results.json";
  if (!existsSync(input)) {
    console.error(`No such report: ${input}`);
    process.exit(1);
  }
  let markdown;
  try {
    markdown = buildSummary(JSON.parse(readFileSync(input, "utf8")));
  } catch (error) {
    console.error(
      `Could not summarise ${input}: ${error instanceof Error ? error.message : error}`,
    );
    process.exit(1);
  }
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  else process.stdout.write(markdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
