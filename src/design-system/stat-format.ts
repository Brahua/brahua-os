export const STAT_LOCALE = "es-PE";

export type StatKind = "number" | "percent" | "currency";
export type StatCurrency = "PEN" | "USD";

/** Intl options without `notation`: animated numbers never use scientific notation. */
export type StatFormatOptions = Omit<Intl.NumberFormatOptions, "notation">;

/**
 * Intl options for each stat kind.
 * - `percent` expects a fraction (0.58 → "58%").
 * - `currency` follows es-PE: PEN as "S/ 2,340", USD as "USD 12.5".
 */
export function statFormat(kind: StatKind, currency: StatCurrency = "PEN"): StatFormatOptions {
  switch (kind) {
    case "percent":
      return { style: "percent", maximumFractionDigits: 0 };
    case "currency":
      return { style: "currency", currency, maximumFractionDigits: 2, minimumFractionDigits: 0 };
    case "number":
      return { maximumFractionDigits: 1 };
  }
}

export function formatStat(value: number, kind: StatKind, currency?: StatCurrency): string {
  return new Intl.NumberFormat(STAT_LOCALE, statFormat(kind, currency)).format(value);
}
