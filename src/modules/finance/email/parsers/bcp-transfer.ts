// BCP «Constancia de Transferencia a Terceros BCP». The plain text keeps the bold markers:
//   Realizaste una transferencia de *S/ 400.00* desde tu *Clasica.* …
//   Operación realizada *Transferencia a terceros BCP* Fecha y hora *11 de Octubre de 2026 - 09:53 AM*
//   Enviado a *Huaman Loayza Jessica P.* …
// The recipient is a person: whether it is the owner's own account is decided with «Mis nombres»
// (the ingest, which can read settings), never here.
import type { Reading } from "../types";
import { moneyAfter, storedName } from "./shared";
import { parseSpanishDay } from "./text";

const WHEN = /Fecha y hora\s*\*\s*([^*\n]+?)\s*\*/i;
const RECIPIENT = /Enviado a\s*\*\s*([^*\n]+?)\s*\*/i;

export function parseBcpTransfer(text: string): Reading | null {
  const money = moneyAfter(text, "transferencia de");
  const occurredOn = parseSpanishDay(WHEN.exec(text)?.[1] ?? "");
  const merchant = storedName(RECIPIENT.exec(text)?.[1]);
  if (!money || !occurredOn || !merchant) return null;
  return { kind: "transfer", ...money, merchant, occurredOn, cardLast4: null };
}
