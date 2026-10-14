// BBVA «Constancia de operación transferencia PLIN» (also «… con QR»):
//   Plineaste S/ 50.00 a <name> |   …   | Fecha y hora: | 3 de octubre, 2026 17:19 |
// The recipient may be the owner's own Yape: «Mis nombres» decides that in the ingest.
import type { Reading } from "../types";
import { moneyAfter, storedName } from "./shared";
import { parseSpanishDay } from "./text";

const RECIPIENT = /Plineaste\s*(?:S\/|US\$|\$)\s*[\d.,]+\s+a\s+([^|\n]+?)\s*(?:\||\n|$)/i;
const WHEN = /Fecha y hora:\s*\|?\s*([^|\n]+)/i;

export function parseBbvaPlin(text: string): Reading | null {
  const money = moneyAfter(text, "Plineaste");
  const merchant = storedName(RECIPIENT.exec(text)?.[1]);
  const occurredOn = parseSpanishDay(WHEN.exec(text)?.[1] ?? "");
  if (!money || !merchant || !occurredOn) return null;
  return { kind: "transfer", ...money, merchant, occurredOn, cardLast4: null };
}
