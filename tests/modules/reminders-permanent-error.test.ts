// Which database failures the webhook may stop retrying (a "poison" update) and which it must not.
import { describe, expect, test } from "vitest";
import { isPermanentDbError } from "@/modules/reminders/permanent-error";

const wrapped = (code: string) =>
  Object.assign(new Error("Failed query"), { cause: Object.assign(new Error("pg"), { code }) });

describe("isPermanentDbError", () => {
  test.each(["22021", "22003", "23505", "23502", "23514"])("%s is permanent", (code) => {
    expect(isPermanentDbError(wrapped(code))).toBe(true);
  });

  test.each(["40001", "40P01", "08006", "57P01", "53300", "XX000"])("%s is transient", (code) => {
    expect(isPermanentDbError(wrapped(code))).toBe(false);
  });

  test("errors without a code, and non-errors, are transient", () => {
    expect(isPermanentDbError(new Error("boom"))).toBe(false);
    expect(isPermanentDbError(null)).toBe(false);
    expect(isPermanentDbError("22021")).toBe(false);
  });

  test("a code at the top level counts, and a cyclic cause does not loop", () => {
    expect(isPermanentDbError(Object.assign(new Error("x"), { code: "22P05" }))).toBe(true);
    const cyclic: { cause?: unknown } = {};
    cyclic.cause = cyclic;
    expect(isPermanentDbError(cyclic)).toBe(false);
  });
});
