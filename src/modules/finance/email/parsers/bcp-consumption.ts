// BCP «Realizaste un consumo con tu Tarjeta de Crédito/Débito BCP» (notificaciones@notificacionesbcp.com.pe).
//   «Realizaste un consumo de $ 6.46 con tu Tarjeta de Crédito BCP en PARAMOUNT+. …»
//   | Fecha y hora | 14 de octubre de 2026 - 12:10 AM |
//   | Número de Tarjeta de Crédito | ************6392 |
//   | Empresa | PARAMOUNT+ |
// A debit payment through Plin arrives as a purchase whose company is `PLIN-<NAME>`: it is a payment
// to a person, so the prefix is dropped and the kind is `transfer`.
import type { Reading } from "../types";
import { moneyAfter, storedName } from "./shared";
import { parseSpanishDay } from "./text";

const COMPANY = /\|\s*Empresa\s*\|\s*([^|\n]+?)\s*\|/i;
const WHEN = /\|\s*Fecha y hora\s*\|\s*([^|\n]+?)\s*\|/i;
const CARD = /Número de Tarjeta de (?:Crédito|Débito)\s*\|\s*\*+\s*(\d{4})/i;
const PLIN_PREFIX = /^PLIN-\s*/i;

export function parseBcpConsumption(text: string): Reading | null {
  const money = moneyAfter(text, "consumo de");
  const company = COMPANY.exec(text)?.[1];
  const occurredOn = parseSpanishDay(WHEN.exec(text)?.[1] ?? "");
  if (!money || !company || !occurredOn) return null;
  const isPlin = PLIN_PREFIX.test(company.trim());
  const merchant = storedName(company.trim().replace(PLIN_PREFIX, ""));
  if (!merchant) return null;
  return {
    kind: isPlin ? "transfer" : "card",
    ...money,
    merchant,
    occurredOn,
    cardLast4: CARD.exec(text)?.[1] ?? null,
  };
}
