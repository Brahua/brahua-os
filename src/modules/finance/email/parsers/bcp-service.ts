// BCP «ENVIO AUTOMATICO - CONSTANCIA DE PAGO DE SERVICIO - BANCA MOVIL BCP»: a bill paid from an account.
// Gmail's plain body keeps the bold markers and flattens the table to one line:
//   Fecha y hora: *Jueves, 15 Octubre 2026 - 01:26 P. M.* Empresa: *TELEFONIA DEMO* Servicio: *02 PAGO POR TELEFONO*
//   … Monto total: *S/ 59.90* Tipo de cambio: ** …
// «Monto total» is the amount: the «Importe» rows repeat each document of the payment. There is no card,
// and the company is the merchant, so a recurring payment named after it can recognize the email.
import type { Reading } from "../types";
import { moneyAfter, storedName } from "./shared";
import { dayAfter } from "./text";

const WHEN = /Fecha y hora/i;
// The value ends at the bold marker, at a separator or, with no marker at all, at the next label.
const COMPANY = /Empresa[\s|:*]+([^\s|:*][^\n\t|*]*?)\s*(?:\*|\n|\t|\||\s+Servicio\s*:|$)/iu;

export function parseBcpService(text: string): Reading | null {
  const money = moneyAfter(text, String.raw`Monto total[\s|:*]*`);
  const occurredOn = dayAfter(text, WHEN);
  const merchant = storedName(COMPANY.exec(text)?.[1]);
  if (!money || !occurredOn || !merchant) return null;
  return { kind: "transfer", ...money, merchant, occurredOn, cardLast4: null };
}
