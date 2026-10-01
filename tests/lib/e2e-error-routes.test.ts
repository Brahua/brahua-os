import { expect, test } from "vitest";
import { e2eErrorRoutesEnabled, pageExtensionsFor } from "@/lib/e2e-error-routes";

const DEFAULT = ["tsx", "ts", "jsx", "js"];

test("the test-only routes are off unless E2E_ERROR_ROUTES is exactly 1", () => {
  expect(e2eErrorRoutesEnabled({})).toBe(false);
  expect(e2eErrorRoutesEnabled({ E2E_ERROR_ROUTES: "true" })).toBe(false);
  expect(e2eErrorRoutesEnabled({ E2E_ERROR_ROUTES: "0" })).toBe(false);
  expect(e2eErrorRoutesEnabled({ E2E_ERROR_ROUTES: "1" })).toBe(true);
});

test("never on Vercel, even with the flag", () => {
  expect(e2eErrorRoutesEnabled({ E2E_ERROR_ROUTES: "1", VERCEL: "1" })).toBe(false);
});

test("a normal build has Next's default page extensions: page.e2e.tsx is not a page", () => {
  expect(pageExtensionsFor({})).toEqual(DEFAULT);
  expect(pageExtensionsFor({ E2E_ERROR_ROUTES: "0" })).toEqual(DEFAULT);
  expect(pageExtensionsFor({ VERCEL: "1", VERCEL_ENV: "production" })).toEqual(DEFAULT);
});

test("an E2E build reads page.e2e.tsx as a page (the longer extension first)", () => {
  expect(pageExtensionsFor({ E2E_ERROR_ROUTES: "1" })).toEqual(["e2e.tsx", ...DEFAULT]);
});

test("any value of the flag fails a Vercel build", () => {
  for (const value of ["1", "0", "yes"]) {
    expect(() => pageExtensionsFor({ E2E_ERROR_ROUTES: value, VERCEL: "1" })).toThrow(
      /must not be set on Vercel/,
    );
  }
});
