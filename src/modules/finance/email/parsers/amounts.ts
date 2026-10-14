// Amounts of the notification emails, as whole cents. Formats seen in the owner's emails:
// «20.00», «6.46», «49.90», «10378.20»; a thousands separator is accepted only with decimals («1,000.50»). Anything
// ambiguous («1.000» or «1,000» alone) is refused: a wrong amount is worse than an unreadable email.
import { AMOUNT_MAX_CENTS, AMOUNT_MIN_CENTS } from "../../finance-constants";

const PLAIN = /^\d{1,9}(?:\.\d{1,2})?$/;
const WITH_THOUSANDS = /^\d{1,3}(?:,\d{3})+\.\d{1,2}$/;

/** «43.20» → 4320; null when it is not an unambiguous amount in range. */
export function parseAmountToCents(raw: string): number | null {
  const value = raw.trim();
  let normalized: string | null = null;
  if (PLAIN.test(value)) normalized = value;
  else if (WITH_THOUSANDS.test(value)) normalized = value.replace(/,/g, "");
  if (normalized === null) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents >= AMOUNT_MIN_CENTS && cents <= AMOUNT_MAX_CENTS
    ? cents
    : null;
}
