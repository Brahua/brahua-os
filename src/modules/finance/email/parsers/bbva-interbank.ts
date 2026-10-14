// BBVA «Constancia Transf. Interbancaria»:
//   Importe transferido S/ 1000.00 … Titular de la cuenta  <name> … Fecha y hora de la operación
//   04 octubre, 2026 09:51 … Nombre del beneficiario  <name> … «Esta cuenta es propia, …»
// A transfer to an account of the same holder is moving the owner's money between banks, not a
// spending: it is ignored. Otherwise it is a suggestion for the beneficiary.
import type { Reading } from "../types";
import { moneyAfter, storedName } from "./shared";
import { parseSpanishDay } from "./text";

const HOLDER = /Titular de la cuenta\s+([^\n]+)/i;
const BENEFICIARY = /Nombre del beneficiario\s+([^\n]+)/i;
const WHEN = /Fecha y hora de la operación\s+([^\n]+)/i;
const OWN_ACCOUNT = /Esta cuenta es propia/i;

const same = (a: string, b: string) =>
  a.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim() ===
  b.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

export function parseBbvaInterbank(text: string): Reading | "ignored" | null {
  const money = moneyAfter(text, "Importe transferido");
  const occurredOn = parseSpanishDay(WHEN.exec(text)?.[1] ?? "");
  const merchant = storedName(BENEFICIARY.exec(text)?.[1]);
  if (!money || !occurredOn || !merchant) return null;
  const holder = HOLDER.exec(text)?.[1];
  if (OWN_ACCOUNT.test(text) || (holder && same(holder, merchant))) return "ignored";
  return { kind: "transfer", ...money, merchant, occurredOn, cardLast4: null };
}
