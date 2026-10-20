// Yape «Por tu seguridad, te notificaremos por cada yapeo que realices» (notificaciones@yape.pe): a yapeo
// sent to a person. Gmail's plain body keeps the bold markers and flattens the table to one line:
//   *Monto de yapeo**  S/ 33.00  Yapero Jhorman Bra* … Fecha y Hora de la operación 19 octubre 2026 - 01:56 p. m.
//   Celular del Beneficiario XXXXXXXXX550 Nombre del Beneficiario Ricardo Cer* Nº de operación 17659996
// Yape masks the surnames («Ricardo Cer*»), so the beneficiary is stored as the email shows it.
import type { Reading } from "../types";
import { moneyAfter, storedName } from "./shared";
import { dayAfter } from "./text";

const BENEFICIARY =
  /Nombre del Beneficiario[\s|*:]*(\p{L}[^\n\t|]*?)\s*(?:N[ºo°.]*\s*de operaci[oó]n|\n|\t|\||$)/iu;
const WHEN = /Fecha y Hora de la operaci[oó]n/i;

export function parseYapeYapeo(text: string): Reading | null {
  const money = moneyAfter(text, "Monto de yapeo[*\\s]*");
  const merchant = storedName(BENEFICIARY.exec(text)?.[1]);
  const occurredOn = dayAfter(text, WHEN);
  if (!money || !merchant || !occurredOn) return null;
  return { kind: "transfer", ...money, merchant, occurredOn, cardLast4: null };
}
