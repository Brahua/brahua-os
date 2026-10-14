// E3 of `finance-email`: the schemas the actions and the screens share.
import { describe, expect, test } from "vitest";
import {
  registerSuggestionInputSchema,
  setMethodLast4InputSchema,
  setOwnNamesInputSchema,
} from "@/modules/finance/email/input";

const ID = "44444444-4444-4444-8444-000000000001";

describe("setOwnNamesInputSchema", () => {
  const parse = (names: unknown) => setOwnNamesInputSchema.safeParse({ names });

  test("trims, collapses spaces, drops blank lines and repeats (any case)", () => {
    const result = parse(["  Ana   Demo ", "", "ana demo", "Luis M Torres  "]);
    expect(result.success && result.data.names).toEqual(["Ana Demo", "Luis M Torres"]);
  });

  test("nothing at all clears them", () => {
    expect(parse([""]).success && parse([""]).data?.names).toEqual([]);
  });

  test.each([
    ["more than ten", Array.from({ length: 11 }, (_, i) => `Nombre ${i}`)],
    ["a name over 80 characters", ["x".repeat(81)]],
    ["an invisible character", ["Ana‮Demo"]],
    ["not text", [42]],
  ])("refuses %s", (_label, names) => {
    expect(parse(names).success).toBe(false);
  });

  test("ten distinct names are fine", () => {
    expect(parse(Array.from({ length: 10 }, (_, i) => `Nombre ${i}`)).success).toBe(true);
  });
});

describe("setMethodLast4InputSchema", () => {
  const parse = (last4: unknown) => setMethodLast4InputSchema.safeParse({ id: ID, last4 });

  test.each([
    ["1234", "1234"],
    [" 0042 ", "0042"],
    ["", null],
    [null, null],
  ])("%j → %j", (raw, stored) => {
    const result = parse(raw);
    expect(result.success && result.data.last4).toBe(stored);
  });

  test.each(["123", "12345", "12a4", "abcd", 1234])("refuses %j", (raw) => {
    expect(parse(raw).success).toBe(false);
  });
});

describe("registerSuggestionInputSchema", () => {
  test("no overrides is fine; the amount the sheet types is read as cents", () => {
    expect(registerSuggestionInputSchema.safeParse({ id: ID }).success).toBe(true);
    const result = registerSuggestionInputSchema.safeParse({
      id: ID,
      overrides: {
        amount: "43,20",
        description: "  Cena  ",
        categoryId: "",
        paymentMethodId: null,
      },
    });
    expect(result.success && result.data.overrides).toMatchObject({
      amount: 4320,
      description: "Cena",
      categoryId: null,
      paymentMethodId: null,
    });
  });

  test("a bad id or amount is refused", () => {
    expect(registerSuggestionInputSchema.safeParse({ id: "nope" }).success).toBe(false);
    expect(
      registerSuggestionInputSchema.safeParse({ id: ID, overrides: { amount: "abc" } }).success,
    ).toBe(false);
  });
});
