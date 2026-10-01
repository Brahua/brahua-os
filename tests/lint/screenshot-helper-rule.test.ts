import { ESLint } from "eslint";
import path from "node:path";
import { expect, test, vi } from "vitest";

const eslint = new ESLint({ cwd: process.cwd() });
// ESLint loads the whole config on the first lint (seconds under a busy parallel run).
vi.setConfig({ testTimeout: 30_000 });

async function lint(code: string, file: string) {
  const [result] = await eslint.lintText(code, { filePath: path.join(process.cwd(), file) });
  return result.messages.filter((m) => m.ruleId === "no-restricted-syntax").map((m) => m.message);
}

const DIRECT_CALL = `import { expect, test } from "@playwright/test";
test("x", async ({ page }) => {
  await expect(page.locator("main")).toHaveScreenshot("main.png");
});
`;

test("specs cannot call toHaveScreenshot directly", async () => {
  const messages = await lint(DIRECT_CALL, "e2e/some.spec.ts");
  expect(messages).toHaveLength(1);
  expect(messages[0]).toContain("expectScreenshot()");
});

test("the screenshot helper itself may call it", async () => {
  expect(await lint(DIRECT_CALL, "e2e/support/screenshots.ts")).toEqual([]);
});
