// BCP money sent from an account to someone (HTML only). Two emails with the same table:
//   «Constancia de Transferencia a Terceros BCP»
//     Realizaste una transferencia de S/ 400.00 desde tu Clasica. …
//     Operación realizada · Transferencia a terceros BCP · Fecha y hora · 11 de Octubre de 2026 - 09:53 AM
//     Enviado a · Huaman Loayza Jessica P. · **** 3001
//   «Constancia de Yapeo a Celular» (yapear from the BCP app)
//     Realizaste un yapeo a celular de S/ 120.00 desde tu Cuenta de ahorro Soles. …
//     Operación realizada · Yapear a celular · Fecha y hora · 25 de octubre de 2026 - 04:11 PM
//     Enviado a · Clinica D G S. *** **1 111 · Destino · Yape
// Gmail's plain body may keep the bold markers (`*…*`), pipes, tabs or lines: the amount comes from the
// sentence and the recipient is whatever follows «Enviado a» up to a line break, a tab, a pipe or the
// masked account or phone (`****`, `***`). Whether it is the owner's own account is decided with «Mis
// nombres» (the ingest, which can read settings), never here.
import type { Reading } from "../types";
import { moneyAfter, storedName } from "./shared";
import { dayAfter } from "./text";

const WHEN = /Fecha y hora/i;
// The value starts with a letter: the email repeats «Enviado a» further down with only the masked
// account (`**** 3001`) and that one is not a name.
const RECIPIENT = /Enviado a[\s|*:]+(\p{L}[^\n\t|*]*?)\s*(?:\n|\t|\||\*|$)/iu;

function readSent(text: string, lead: string): Reading | null {
  const money = moneyAfter(text, lead);
  const occurredOn = dayAfter(text, WHEN);
  const merchant = storedName(RECIPIENT.exec(text)?.[1]);
  if (!money || !occurredOn || !merchant) return null;
  return { kind: "transfer", ...money, merchant, occurredOn, cardLast4: null };
}

export function parseBcpTransfer(text: string): Reading | null {
  return readSent(text, "transferencia de");
}

export function parseBcpYapeo(text: string): Reading | null {
  return readSent(text, "yapeo a celular de");
}
