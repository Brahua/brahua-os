// BBVA «Has realizado un consumo con tu tarjeta BBVA» (procesos@bbva.com.pe). The plain text reads:
//   Comercio: RAPPI SAC | Monto: 43.20 | Moneda: PEN | Fecha: 11/10/2026 | Hora: 14:52:43
//   «… tarjeta terminada en *3659»
// The amount has no symbol: the currency comes from «Moneda:». Date and time are already Lima's.
import type { Reading } from "../types";
import { parseAmountToCents } from "./amounts";
import { cleanText, isPlausibleDay } from "./text";
import { SUGGESTION_MERCHANT_MAX_LENGTH } from "../constants";

// «Comercio: X», then a pipe, a line, a tab or the next label (everything may arrive on one line).
const MERCHANT = /Comercio:\s*([^|\n\t]+?)\s*(?:\||\n|\t|\s+Monto:|$)/i;
const AMOUNT = /Monto:\s*([\d.,]+)/i;
const CURRENCY = /Moneda:\s*(PEN|USD)\b/i;
const DATE = /Fecha:\s*(\d{2})\/(\d{2})\/(\d{4})/i;
const CARD = /terminada en\s*\*?(\d{4})/i;

export function parseBbvaConsumption(text: string): Reading | null {
  const merchant = MERCHANT.exec(text)?.[1]?.trim();
  const amountCents = parseAmountToCents(AMOUNT.exec(text)?.[1] ?? "");
  const currency = CURRENCY.exec(text)?.[1]?.toUpperCase();
  const date = DATE.exec(text);
  if (!merchant || !cleanText(merchant) || amountCents === null || !currency || !date) return null;
  const [, day, month, year] = date;
  const occurredOn = `${year}-${month}-${day}`;
  // A calendar check (31/02 must not pass): the date round-trips through UTC.
  if (new Date(`${occurredOn}T00:00:00Z`).toISOString().slice(0, 10) !== occurredOn) return null;
  if (!isPlausibleDay(occurredOn)) return null;
  return {
    kind: "card",
    amountCents,
    currency: currency === "USD" ? "USD" : "PEN",
    merchant: cleanText(merchant).slice(0, SUGGESTION_MERCHANT_MAX_LENGTH),
    occurredOn,
    cardLast4: CARD.exec(text)?.[1] ?? null,
  };
}
