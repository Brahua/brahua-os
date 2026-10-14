// The contract between the parsers (E2) and everything that stores or shows a suggestion (E1, E3).
// A parser is a pure function of one email; it never throws: `unreadable` is an answer.
import type { Currency } from "../finance-constants";
import type { EmailKind, EmailSource } from "./constants";

/** One email as the Apps Script sends it (already validated by `ingestBodySchema`). */
export type EmailMessage = {
  /** The Gmail message id: the idempotency key. */
  id: string;
  from: string;
  subject: string;
  /** When Gmail received it (ISO 8601); the fallback date of a reading without one. */
  receivedAt: Date;
  /** Plain text, already cut. Never stored and never logged. */
  text: string;
  /** Whether Gmail's SPF/DKIM said `pass` (the script reads `Authentication-Results`). */
  senderVerified: boolean;
};

/** What a parser extracted from an expense email. Amounts are whole cents, never floats. */
export type Reading = {
  kind: EmailKind;
  amountCents: number;
  currency: Currency;
  /** Merchant or recipient, as written (≤ 80). */
  merchant: string;
  /** The day in Lima (`YYYY-MM-DD`). */
  occurredOn: string;
  /** Last four digits of the card the email names, when it does. */
  cardLast4: string | null;
};

export type ParseOutcome =
  | { type: "reading"; source: EmailSource; reading: Reading }
  /** Known sender and subject, but not an expense (an own-account move, a card payment…). */
  | { type: "ignored" }
  | { type: "unreadable"; source: EmailSource }
  /** Not a sender/subject this feature reads at all. */
  | { type: "unknown" };
