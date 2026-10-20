// Picks the parser of an email by its exact sender AND a known subject (SPEC-finance-email "Remitentes"):
// anything else is `unknown` and never leaves the Gmail of the owner nor reaches the database.
// The formats are the ones seen in the owner's real emails (BCP, BBVA, Yape).
import type { EmailSource } from "../constants";
import type { EmailMessage, ParseOutcome, Reading } from "../types";
import { parseBbvaConsumption } from "./bbva-consumption";
import { parseBbvaInterbank } from "./bbva-interbank";
import { parseBbvaPlin } from "./bbva-plin";
import { parseBcpConsumption } from "./bcp-consumption";
import { parseBcpTransfer } from "./bcp-transfer";
import { parseYapePayment } from "./yape-payment";
import { parseYapeYapeo } from "./yape-yapeo";

type Format = {
  source: EmailSource;
  from: RegExp;
  subject: RegExp;
  /** `"ignore"`: not an expense (own-account moves, card payments, points…). A reader may also answer `"ignored"`. */
  parse: ((text: string) => Reading | "ignored" | null) | "ignore";
};

const BCP = /^notificaciones@notificacionesbcp\.com\.pe$/i;
const BBVA = /^procesos@bbva\.com\.pe$/i;
const YAPE = /^notificaciones@yape\.pe$/i;

const FORMATS: readonly Format[] = [
  {
    source: "bbva",
    from: BBVA,
    subject: /^Has realizado un consumo con tu tarjeta BBVA$/i,
    parse: parseBbvaConsumption,
  },
  {
    source: "bcp",
    from: BCP,
    subject: /^Realizaste un consumo con tu Tarjeta de (?:Cr[eé]dito|D[eé]bito) BCP\b/i,
    parse: parseBcpConsumption,
  },
  {
    source: "bcp",
    from: BCP,
    subject: /^Constancia de Transferencia a Terceros BCP\b/i,
    parse: parseBcpTransfer,
  },
  { source: "yape", from: YAPE, subject: /^Pago exitoso$/i, parse: parseYapePayment },
  {
    source: "yape",
    from: YAPE,
    subject: /^Por tu seguridad, te notificaremos por cada yapeo que realices$/i,
    parse: parseYapeYapeo,
  },
  {
    source: "bbva",
    from: BBVA,
    subject: /^Constancia de operaci[oó]n transferencia PLIN(?: con QR)?$/i,
    parse: parseBbvaPlin,
  },
  {
    source: "bbva",
    from: BBVA,
    subject: /^BBVA - Constancia Transf\. Interbancaria$/i,
    parse: parseBbvaInterbank,
  },
  // Money that is not a new expense: the card payment (each purchase already arrived) and own accounts.
  {
    source: "bbva",
    from: BBVA,
    subject:
      /^BBVA - (?:Constancia Pago de Tarjetas propias|Constancia Transf\. a ctas\. propias|Paga tus consumos con puntos)$/i,
    parse: "ignore",
  },
  {
    source: "bcp",
    from: BCP,
    subject: /^Constancia de Pago de Tarjeta de Cr[eé]dito Propia\b/i,
    parse: "ignore",
  },
];

/**
 * The address of a `From` header: the LAST «<…>» at the very end (a display name such as
 * `"<procesos@bbva.com.pe>" <x@evil.test>` must not pass for the bank), or the whole value when it
 * is a bare address. Anything with spaces or more than one `@` is not an address ("" matches nothing).
 */
export function senderAddress(from: string): string {
  const value = from.trim();
  const angle = /<([^<>]+)>$/.exec(value);
  const address = (angle ? angle[1] : value).trim();
  return /^[^\s@<>"]+@[^\s@<>"]+$/.test(address) ? address : "";
}

export function parseEmail(message: EmailMessage): ParseOutcome {
  const address = senderAddress(message.from);
  const format = FORMATS.find((f) => f.from.test(address) && f.subject.test(message.subject));
  if (!format) return { type: "unknown" };
  if (format.parse === "ignore") return { type: "ignored" };
  try {
    const reading = format.parse(message.text);
    if (reading === "ignored") return { type: "ignored" };
    return reading
      ? { type: "reading", source: format.source, reading }
      : { type: "unreadable", source: format.source };
  } catch {
    // A parser never throws by contract; if one does, the email is unreadable, not a 500.
    return { type: "unreadable", source: format.source };
  }
}
