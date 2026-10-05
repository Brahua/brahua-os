// Money helpers of `finance` (SPEC-finance "Monto", "Tipo de cambio"). Pure and client-safe.
//
// Amounts are whole cents (never floats): "12,50" and "12.50" both parse to 1 250. The USD → PEN
// rate is a whole number of ten-thousandths (`rateE4`, 3.7512 → 37 512), as the database stores
// it (numeric(8, 4)), and converting multiplies integers and rounds half up explicitly.
import {
  AMOUNT_MAX_CENTS,
  AMOUNT_MIN_CENTS,
  RATE_DECIMALS,
  RATE_MAX_E4,
  RATE_MIN_E4,
  RATE_SCALE,
  type Currency,
} from "./finance-constants";

export type AmountError = "required" | "invalid" | "decimals" | "tooSmall" | "tooLarge";
export type Parsed<E> = { ok: true; value: number } | { ok: false; error: E };

/** Digits with at most one decimal separator (comma or point). Nothing else: no signs, no groups. */
const DECIMAL = /^(\d*)(?:[.,](\d*))?$/;

/** The whole part has more digits than any accepted value (avoids building huge numbers). */
const MAX_WHOLE_DIGITS = 9;

/**
 * Splits a decimal typed by the owner into its whole part and its decimals, or why not. Spaces
 * around it are ignored; inside it they are not accepted ("1 250" is ambiguous).
 */
function splitDecimal(
  text: string,
  maxDecimals: number,
): { whole: number; fraction: string } | "required" | "invalid" | "decimals" | "tooLarge" {
  const trimmed = text.trim();
  if (trimmed === "") return "required";
  const match = DECIMAL.exec(trimmed);
  if (!match) return "invalid";
  const [, wholeText, fraction = ""] = match;
  if (wholeText === "" && fraction === "") return "invalid";
  if (fraction.length > maxDecimals) return "decimals";
  const significant = wholeText.replace(/^0+/, "");
  if (significant.length > MAX_WHOLE_DIGITS) return "tooLarge";
  return { whole: Number(significant || "0"), fraction: fraction.padEnd(maxDecimals, "0") };
}

/**
 * An amount typed by the owner ("12,50", "12.50", "12", ",5") in cents: at most 2 decimals,
 * > 0 and ≤ 1 000 000.
 */
export function parseAmount(text: string): Parsed<AmountError> {
  const parts = splitDecimal(text, 2);
  if (typeof parts === "string") return { ok: false, error: parts };
  const cents = parts.whole * 100 + Number(parts.fraction);
  if (cents < AMOUNT_MIN_CENTS) return { ok: false, error: "tooSmall" };
  if (cents > AMOUNT_MAX_CENTS) return { ok: false, error: "tooLarge" };
  return { ok: true, value: cents };
}

/** Whether `cents` is a storable amount (a whole number within the limits). */
export function isValidCents(cents: number): boolean {
  return Number.isSafeInteger(cents) && cents >= AMOUNT_MIN_CENTS && cents <= AMOUNT_MAX_CENTS;
}

/** Cents as the amount field shows them for editing: "12.50", or "12" for a whole amount. */
export function centsToInput(cents: number): string {
  const whole = Math.floor(cents / 100);
  const fraction = cents % 100;
  return fraction === 0 ? String(whole) : `${whole}.${String(fraction).padStart(2, "0")}`;
}

const MONEY_FORMATS: Record<Currency, Intl.NumberFormat> = {
  PEN: new Intl.NumberFormat("es-PE", {
    style: "currency",
    currency: "PEN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }),
  USD: new Intl.NumberFormat("es-PE", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }),
};

/**
 * An amount for people, with `Intl.NumberFormat("es-PE")`: "S/ 1,250.00", "USD 95.00" (what the
 * locale data says; the digits are exact because cents / 100 has at most 2 decimals).
 */
export function formatMoney(cents: number, currency: Currency): string {
  return MONEY_FORMATS[currency].format(cents / 100);
}

export type RateError = "required" | "invalid" | "decimals" | "outOfRange";

/** A rate typed by the owner ("3.75", "3,7512"): 4 decimals at most, between 1 and 10. */
export function parseRate(text: string): Parsed<RateError> {
  const parts = splitDecimal(text, RATE_DECIMALS);
  if (parts === "tooLarge") return { ok: false, error: "outOfRange" };
  if (typeof parts === "string") return { ok: false, error: parts };
  const rateE4 = parts.whole * RATE_SCALE + Number(parts.fraction);
  if (rateE4 < RATE_MIN_E4 || rateE4 > RATE_MAX_E4) return { ok: false, error: "outOfRange" };
  return { ok: true, value: rateE4 };
}

/** Whether `rateE4` is a storable rate (a whole number of ten-thousandths, 1–10). */
export function isValidRateE4(rateE4: number): boolean {
  return Number.isSafeInteger(rateE4) && rateE4 >= RATE_MIN_E4 && rateE4 <= RATE_MAX_E4;
}

const DB_RATE = /^(\d+)(?:\.(\d{1,4}))?$/;

/** A numeric(8, 4) as Postgres returns it ("3.7500") in ten-thousandths; null stays null. */
export function rateFromDb(value: string | null): number | null {
  if (value === null) return null;
  const match = DB_RATE.exec(value);
  if (!match) throw new Error("Unexpected exchange rate format");
  return Number(match[1]) * RATE_SCALE + Number((match[2] ?? "").padEnd(RATE_DECIMALS, "0"));
}

/** Ten-thousandths as the database stores them: 37 512 → "3.7512". */
export function rateToDb(rateE4: number): string {
  const whole = Math.floor(rateE4 / RATE_SCALE);
  const fraction = String(rateE4 % RATE_SCALE).padStart(RATE_DECIMALS, "0");
  return `${whole}.${fraction}`;
}

/** A rate as the field shows it for editing: "3.75", "3.7512", "4". */
export function rateToInput(rateE4: number): string {
  return rateToDb(rateE4).replace(/\.?0+$/, "");
}

const RATE_FORMAT = new Intl.NumberFormat("es-PE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: RATE_DECIMALS,
});

/** A rate for people: "3.75", "3.7512". */
export function formatRate(rateE4: number): string {
  return RATE_FORMAT.format(rateE4 / RATE_SCALE);
}

/** `numerator / divisor` rounded half up, for non-negative whole numbers. */
function divideHalfUp(numerator: number, divisor: number): number {
  return Math.floor((numerator + divisor / 2) / divisor);
}

/**
 * An amount in PEN cents: PEN as it is; USD with the rate stored on the expense, rounded half up
 * to the cent (USD 0.01 at 3.7550 is S/ 0.04: 3.755 rounds up). USD without a rate: null (it is
 * summed apart, "sin convertir").
 */
export function toPenCents(
  cents: number,
  currency: Currency,
  rateE4: number | null,
): number | null {
  if (currency === "PEN") return cents;
  if (rateE4 === null) return null;
  return divideHalfUp(cents * rateE4, RATE_SCALE);
}

export type MoneyLike = { amountCents: number; currency: Currency; exchangeRateE4: number | null };

/**
 * The total of some expenses in PEN cents, each converted with its own stored rate, plus the
 * USD cents that have no rate (shown apart: "+ USD 95.00 sin convertir").
 */
export function sumInPen(items: readonly MoneyLike[]): {
  penCents: number;
  unconvertedUsdCents: number;
} {
  let penCents = 0;
  let unconvertedUsdCents = 0;
  for (const item of items) {
    const converted = toPenCents(item.amountCents, item.currency, item.exchangeRateE4);
    if (converted === null) unconvertedUsdCents += item.amountCents;
    else penCents += converted;
  }
  return { penCents, unconvertedUsdCents };
}
