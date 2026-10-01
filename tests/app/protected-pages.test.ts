import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";

// SPEC-core: the (app) layout is not enough on its own (a layout does not stop its page from
// rendering), so every page under (app) must call requireOwner() itself. Test-only pages
// (`page.e2e.tsx`, E2E builds only) too.
const APP_DIR = path.resolve(__dirname, "../../src/app/(app)");

const pages = readdirSync(APP_DIR, { recursive: true, encoding: "utf8" })
  .filter((file) => /(^|\/)page\.(e2e\.)?tsx$/.test(file))
  .sort();

test("finds the protected pages", () => {
  expect(pages).toEqual(
    expect.arrayContaining(["page.tsx", "design/page.tsx", "e2e/error/page.e2e.tsx"]),
  );
});

test.each(pages)("(app)/%s calls requireOwner()", (file) => {
  const source = readFileSync(path.join(APP_DIR, file), "utf8");
  expect(source).toMatch(/await requireOwner\(\)/);
});
