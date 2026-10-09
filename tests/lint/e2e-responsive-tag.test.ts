// The `mobile` Playwright project runs only the tests tagged `@responsive` (playwright.config.ts,
// `grep`); `desktop` runs everything. A test that depends on the phone viewport and forgets the tag
// silently stops being tested on the phone, so this source check (like `@today-tasks`) flags the
// two cases that can be detected mechanically:
//   1. a phone-only test: it skips itself on desktop (`test.skip(isDesktop(testInfo), …)`);
//   2. a test that compares a screenshot: the references have a `-mobile` twin that only a
//      mobile run uses (and `check-screenshot-orphans` would flag it as an orphan).
// Layout-dependent tests that do neither (navigation, sheets vs side panels) are a judgement call,
// documented in docs/HANDOFF.md ("E2E: qué corre en `mobile`").
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, test } from "vitest";

const E2E_DIR = path.join(process.cwd(), "e2e");
const TAG = "@responsive";
// Specs whose screenshots are desktop only: the design system sections skip the phone, and the
// reminders spec is `testIgnore`d in the mobile project (it shares one settings row).
const DESKTOP_ONLY_SCREENSHOTS = ["design-system.spec.ts", "reminders.spec.ts"];
const NOT_A_TEST = /(^|\.)(describe|step|beforeEach|afterEach|beforeAll|afterAll|poll)$/;

type FoundTest = { title: string; body: string };

/** Every `<anything>("title", async (...) => {...})` call in the source that is a test. */
function findTests(source: string): FoundTest[] {
  const file = ts.createSourceFile("spec.ts", source, ts.ScriptTarget.Latest, true);
  const found: FoundTest[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.arguments.length >= 2) {
      const first = node.arguments[0];
      const last = node.arguments[node.arguments.length - 1];
      const isTitle =
        ts.isStringLiteral(first) ||
        ts.isNoSubstitutionTemplateLiteral(first) ||
        ts.isTemplateExpression(first);
      const callee = node.expression.getText(file);
      if (
        isTitle &&
        (ts.isArrowFunction(last) || ts.isFunctionExpression(last)) &&
        !NOT_A_TEST.test(callee) &&
        !/^(expect|page|locator|window|document)\b/.test(callee)
      ) {
        found.push({ title: first.getText(file).slice(1, -1), body: last.getText(file) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/**
 * The titles of the tests in `source` that are phone-only or compare a screenshot but lack
 * `@responsive`.
 */
export function untaggedResponsive(source: string, file = "spec.ts"): string[] {
  const screenshots = !DESKTOP_ONLY_SCREENSHOTS.includes(file);
  return findTests(source).flatMap(({ title, body }) => {
    const phoneOnly = /test\.skip\(\s*isDesktop\(\s*testInfo\s*\)/.test(body);
    const compares = screenshots && /\bexpectScreenshot\(/.test(body);
    return (phoneOnly || compares) && !title.includes(TAG) ? [title] : [];
  });
}

describe("untaggedResponsive (the check itself)", () => {
  test("flags a phone-only test and a screenshot test without the tag", () => {
    const source = `test("phone: capture", async ({ page }, testInfo) => {
  test.skip(isDesktop(testInfo), "The orange key of the bottom bar");
});
test("phone: tagged @responsive", async ({ page }, testInfo) => {
  test.skip(isDesktop(testInfo), "x");
});
test(\`\${theme} theme: reference\`, async ({ page }) => {
  await expectScreenshot(page.locator("main"), "x.png");
});
test("desktop only", async ({ page }, testInfo) => {
  test.skip(!isDesktop(testInfo), "Shortcuts act from 1024 px");
});
test.describe("a group", () => {
  test("plain", async ({ page }) => {});
});
wrapped("through a wrapper", async ({ page }) => {
  await expectScreenshot(page.locator("main"), "y.png");
});`;
    expect(untaggedResponsive(source)).toEqual([
      "phone: capture",
      "${theme} theme: reference",
      "through a wrapper",
    ]);
  });

  test("desktop-only specs may compare screenshots without the tag", () => {
    const source = `test("sections", async ({ page }) => {
  await expectScreenshot(page.locator("main"), "x.png");
});`;
    expect(untaggedResponsive(source, "design-system.spec.ts")).toEqual([]);
    expect(untaggedResponsive(source, "reminders.spec.ts")).toEqual([]);
    expect(untaggedResponsive(source, "home.spec.ts")).toEqual(["sections"]);
  });
});

const specs = () =>
  readdirSync(E2E_DIR)
    .filter((file) => file.endsWith(".spec.ts"))
    .map((file) => ({ file, source: readFileSync(path.join(E2E_DIR, file), "utf8") }));

test("every phone-only or screenshot E2E test carries @responsive (the mobile project runs only those)", () => {
  const offenders = specs().flatMap(({ file, source }) =>
    untaggedResponsive(source, file).map((title) => `${file}: ${title}`),
  );
  expect(offenders).toEqual([]);
});

test("positive control: without their tags, the real specs are flagged", () => {
  const flagged = specs()
    .filter(
      ({ file, source }) => untaggedResponsive(source.replaceAll(` ${TAG}`, ""), file).length > 0,
    )
    .map(({ file }) => file);
  expect(flagged).toEqual(
    expect.arrayContaining([
      "areas.spec.ts",
      "home.spec.ts",
      "login.spec.ts",
      "today.spec.ts",
      "tasks.spec.ts",
    ]),
  );
  expect(flagged).not.toContain("design-system.spec.ts");
});

test("the mobile project only runs @responsive tests (playwright.config.ts)", () => {
  const config = readFileSync(path.join(process.cwd(), "playwright.config.ts"), "utf8");
  const mobile = config.match(/name: "mobile"[\s\S]*?\n {4}\},/)?.[0] ?? "";
  expect(mobile).toMatch(/grep: \/@responsive\//);
});
