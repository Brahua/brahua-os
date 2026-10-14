// Yape «Pago exitoso» (notificaciones@yape.pe):
//   ¡Tu pago en L1 MAX
//    fue exitoso!   Monto total S/ 49.90   Fecha y hora: 12 octubre 2026 - 07:36 p. m.
import type { Reading } from "../types";
import { moneyAfter, storedName } from "./shared";
import { dayAfter } from "./text";

const MERCHANT = /Tu pago en\s+([\s\S]+?)\s+fue exitoso/i;
const WHEN = /Fecha y hora/i;

export function parseYapePayment(text: string): Reading | null {
  const money = moneyAfter(text, "Monto total");
  const merchant = storedName(MERCHANT.exec(text)?.[1]);
  const occurredOn = dayAfter(text, WHEN);
  if (!money || !merchant || !occurredOn) return null;
  return { kind: "yape", ...money, merchant, occurredOn, cardLast4: null };
}
