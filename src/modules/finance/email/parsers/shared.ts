// What the BCP, BBVA and Yape readers have in common: a symbol-led amount and a «name» that is
// cleaned and cut to what a suggestion stores.
import type { Currency } from "../../finance-constants";
import { SUGGESTION_MERCHANT_MAX_LENGTH } from "../constants";
import { parseAmountToCents } from "./amounts";
import { cleanText, stripBoldMarkers } from "./text";

/** «S/ 20.00», «$ 6.46», «US$ 5», «S/49.90»: the symbol decides the currency. */
const MONEY_SOURCE = String.raw`(S\/|US\$|\$)\s*([\d.,]+)`;

export type Money = { currency: Currency; amountCents: number };

/** The first amount that follows `lead` (a regex source), e.g. `consumo de`. */
export function moneyAfter(text: string, lead: string): Money | null {
  const match = new RegExp(`${lead}\\s*\\*?\\s*${MONEY_SOURCE}`, "i").exec(text);
  if (!match) return null;
  // «S/ 20.00.» at the end of a sentence: drop a trailing dot before reading.
  const amountCents = parseAmountToCents(match[2].replace(/[.,]$/, ""));
  if (amountCents === null) return null;
  return { currency: match[1] === "S/" ? "PEN" : "USD", amountCents };
}

/** A name or merchant as stored: no control characters, one line, ≤ 80. Null when nothing is left. */
export function storedName(raw: string | undefined): string | null {
  const cleaned = stripBoldMarkers(cleanText(raw ?? ""));
  return cleaned === "" ? null : cleaned.slice(0, SUGGESTION_MERCHANT_MAX_LENGTH);
}
