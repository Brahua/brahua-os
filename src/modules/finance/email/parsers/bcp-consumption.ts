// BCP «Realizaste un consumo con tu Tarjeta de Crédito/Débito BCP» (notificaciones@notificacionesbcp.com.pe).
// The email is HTML only: a sentence on top and a table of «label | value» rows.
//   «Realizaste un consumo de $ 6.46 con tu Tarjeta de Crédito BCP en PARAMOUNT+. Por tu seguridad…»
//   Fecha y hora · 14 de octubre de 2026 - 12:10 AM
//   Número de Tarjeta de Crédito · ************6392
//   Empresa · PARAMOUNT+
// How the table comes out of Gmail's plain body (pipes, tabs, one cell per line or all on one line)
// is not ours to count on, so the amount, the card kind and the merchant are read from the SENTENCE
// and only the day and the card digits from the table, with whatever separates label and value. A
// debit payment through Plin arrives as a purchase whose company is `PLIN-<NAME>`: it is a payment
// to a person, so the prefix is dropped and the kind is `transfer`.
import type { Reading } from "../types";
import { moneyAfter, storedName } from "./shared";
import { dayAfter } from "./text";

const SENTENCE_MERCHANT =
  /Tarjeta de (?:Crédito|Débito) BCP\s+en\s+([\s\S]+?)\.\s*Por tu seguridad/i;
// A fallback for the table row, if the sentence ever changes: the value ends at the next separator
// or at the next label.
const TABLE_MERCHANT = /Empresa[\s|]+([^|\n\t]+?)\s*(?:\||\n|\t|\s+Número de operación|$)/i;
const WHEN = /Fecha y hora/i;
const CARD = /\*{4,}\s*(\d{4})\b/;
const PLIN_PREFIX = /^PLIN-\s*/i;

export function parseBcpConsumption(text: string): Reading | null {
  const money = moneyAfter(text, "consumo de");
  const company = SENTENCE_MERCHANT.exec(text)?.[1] ?? TABLE_MERCHANT.exec(text)?.[1];
  const occurredOn = dayAfter(text, WHEN);
  if (!money || !company || !occurredOn) return null;
  const trimmed = company.trim();
  const isPlin = PLIN_PREFIX.test(trimmed);
  const merchant = storedName(trimmed.replace(PLIN_PREFIX, ""));
  if (!merchant) return null;
  return {
    kind: isPlin ? "transfer" : "card",
    ...money,
    merchant,
    occurredOn,
    cardLast4: CARD.exec(text)?.[1] ?? null,
  };
}
