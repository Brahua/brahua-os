// money.ts of `finance` (SPEC-finance "Monto", "Tipo de cambio"): parsing with comma or point,
// limits, es-PE formatting, rates and the half-up conversion to PEN. Table-driven.
import { describe, expect, test } from "vitest";
import {
  centsToInput,
  formatMoney,
  formatRate,
  isValidCents,
  isValidRateE4,
  parseAmount,
  parseRate,
  rateFromDb,
  rateToDb,
  rateToInput,
  sumInPen,
  toPenCents,
} from "@/modules/finance/money";

/** Intl may put a no-break space after the symbol: compare with plain spaces. */
const plain = (text: string) => text.replace(/\s/g, " ");

describe("parseAmount", () => {
  test.each([
    ["12.50", 1250],
    ["12,50", 1250],
    ["12", 1200],
    ["12.5", 1250],
    ["12,5", 1250],
    ["0.01", 1],
    [",5", 50],
    [".05", 5],
    ["  7,00  ", 700],
    ["007", 700],
    ["12.", 1200],
    ["1000000", 100_000_000],
    ["999999.99", 99_999_999],
  ])("%j → %i cents", (text, cents) => {
    expect(parseAmount(text)).toEqual({ ok: true, value: cents });
  });

  test.each([
    ["", "required"],
    ["   ", "required"],
    [".", "invalid"],
    ["abc", "invalid"],
    ["-5", "invalid"],
    ["+5", "invalid"],
    ["1,250.00", "invalid"],
    ["1 250", "invalid"],
    ["1e3", "invalid"],
    ["S/ 12", "invalid"],
    ["12.505", "decimals"],
    ["12,999", "decimals"],
    ["0", "tooSmall"],
    ["0,00", "tooSmall"],
    ["1000000.01", "tooLarge"],
    ["99999999999999999999", "tooLarge"],
  ])("%j is refused (%s)", (text, error) => {
    expect(parseAmount(text)).toEqual({ ok: false, error });
  });

  test("valid cents: whole numbers within the limits", () => {
    expect([1, 100_000_000].every(isValidCents)).toBe(true);
    expect([0, -1, 100_000_001, 1.5, Number.NaN].some(isValidCents)).toBe(false);
  });
});

describe("formatting", () => {
  test.each([
    [1250, "PEN", "S/ 12.50"],
    [125_000, "PEN", "S/ 1,250.00"],
    [1, "PEN", "S/ 0.01"],
    [100_000_000, "PEN", "S/ 1,000,000.00"],
    [9500, "USD", "USD 95.00"],
  ] as const)("%i %s → %s (es-PE)", (cents, currency, text) => {
    expect(plain(formatMoney(cents, currency))).toBe(text);
  });

  test.each([
    [1250, "12.50"],
    [1200, "12"],
    [1205, "12.05"],
    [1, "0.01"],
  ])("the edit field shows %i as %s", (cents, text) => {
    expect(centsToInput(cents)).toBe(text);
    expect(parseAmount(text)).toEqual({ ok: true, value: cents });
  });
});

describe("rates", () => {
  test.each([
    ["3.75", 37_500],
    ["3,7512", 37_512],
    ["1", 10_000],
    ["10", 100_000],
    ["10.0000", 100_000],
  ])("%j → %i ten-thousandths", (text, rate) => {
    expect(parseRate(text)).toEqual({ ok: true, value: rate });
  });

  test.each([
    ["", "required"],
    ["x", "invalid"],
    ["3.75123", "decimals"],
    ["0.9999", "outOfRange"],
    ["10.0001", "outOfRange"],
    ["99999999999", "outOfRange"],
  ])("%j is refused (%s)", (text, error) => {
    expect(parseRate(text)).toEqual({ ok: false, error });
  });

  test.each([
    ["3.7500", 37_500],
    ["3.7512", 37_512],
    ["10.0000", 100_000],
    ["4", 40_000],
    ["3.75", 37_500],
  ])("database %j ↔ %i", (stored, rate) => {
    expect(rateFromDb(stored)).toBe(rate);
  });

  test("written back with 4 decimals, shown short", () => {
    expect(rateToDb(37_512)).toBe("3.7512");
    expect(rateToDb(37_500)).toBe("3.7500");
    expect(rateToDb(100_000)).toBe("10.0000");
    expect(rateToInput(37_500)).toBe("3.75");
    expect(rateToInput(40_000)).toBe("4");
    expect(rateToInput(37_512)).toBe("3.7512");
    expect(formatRate(37_500)).toBe("3.75");
    expect(formatRate(37_512)).toBe("3.7512");
    expect(rateFromDb(null)).toBeNull();
    expect(() => rateFromDb("abc")).toThrow();
    expect(isValidRateE4(37_500)).toBe(true);
    expect(isValidRateE4(9_999)).toBe(false);
  });
});

describe("conversion to PEN", () => {
  test.each([
    // [cents, currency, rate, pen cents]
    [1250, "PEN", null, 1250],
    [1250, "PEN", 37_500, 1250],
    [9500, "USD", 37_500, 35_625],
    [1, "USD", 37_500, 4], // 3.75 → 4 (half up)
    [1, "USD", 37_499, 4], // 3.7499 → 4
    [1, "USD", 35_000, 4], // 3.5 → 4 (exactly half: up)
    [1, "USD", 34_999, 3], // 3.4999 → 3
    [3, "USD", 35_000, 11], // 10.5 → 11
    [100_000_000, "USD", 100_000, 1_000_000_000], // the largest amount at the largest rate
    [9500, "USD", null, null],
  ] as const)("%i %s at %s → %s", (cents, currency, rate, pen) => {
    expect(toPenCents(cents, currency, rate)).toBe(pen);
  });

  test("a total converts each expense with its own rate; USD without a rate stays apart", () => {
    expect(
      sumInPen([
        { amountCents: 1250, currency: "PEN", exchangeRateE4: null },
        { amountCents: 9500, currency: "USD", exchangeRateE4: 37_500 },
        { amountCents: 1000, currency: "USD", exchangeRateE4: 38_000 },
        { amountCents: 500, currency: "USD", exchangeRateE4: null },
      ]),
    ).toEqual({ penCents: 1250 + 35_625 + 3800, unconvertedUsdCents: 500 });
    expect(sumInPen([])).toEqual({ penCents: 0, unconvertedUsdCents: 0 });
  });
});
