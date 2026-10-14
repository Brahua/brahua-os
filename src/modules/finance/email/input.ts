// Validation and client types of the email suggestions (SPEC-finance-email). Client-safe: the Server
// Actions are the authority and the screens run the same schemas first.
import { z } from "zod";
import { hasInvisibleCharacters, normalizeName } from "@/lib/text";
import { createExpenseInputSchema } from "../expense-input";
import type { Currency } from "../finance-constants";
import { CARD_LAST4, OWN_NAME_MAX_LENGTH, OWN_NAMES_MAX_ITEMS } from "./constants";
import type { EmailKind, EmailSource, SuggestionStatus } from "./constants";
import { EMAIL_ERRORS } from "./email-copy";

/** What the screens get of a suggestion (never the whole row, never the email). */
export type SuggestionItem = {
  id: string;
  source: EmailSource;
  /** Null while `unreadable`. */
  kind: EmailKind | null;
  status: Extract<SuggestionStatus, "pending" | "unreadable">;
  amountCents: number | null;
  currency: Currency | null;
  /** Merchant or recipient, as read. */
  merchant: string | null;
  /** The Lima day of the purchase. */
  occurredOn: string | null;
  cardLast4: string | null;
  subject: string;
  senderVerified: boolean;
  /** The method whose «últimos 4 dígitos» match the card (only when exactly one does). */
  method: { id: string; name: string } | null;
  /** A visible expense with the same amount, currency and day already exists. */
  duplicate: boolean;
};

/** What the «Correos del banco» section of Ajustes needs. */
export type EmailSettings = {
  ownNames: string[];
  methods: { id: string; name: string; last4: string | null }[];
};

const id = z.uuid({ error: "No encontré esa sugerencia." });

export const suggestionIdInputSchema = z.object({ id });

/** Register: with no overrides it takes what was read; the sheet sends what the owner changed. */
export const registerSuggestionInputSchema = z.object({
  id,
  overrides: createExpenseInputSchema
    .pick({ amount: true, description: true, categoryId: true, paymentMethodId: true })
    .partial()
    .optional(),
});

export const undoRegisterInputSchema = z.object({ id, expenseId: z.uuid() });

export const setMethodLast4InputSchema = z.object({
  id: z.uuid({ error: EMAIL_ERRORS.methodGone }),
  last4: z
    .string({ error: EMAIL_ERRORS.last4 })
    .nullable()
    .transform((value) => (value === null ? "" : value.trim()))
    .refine((value) => value === "" || CARD_LAST4.test(value), EMAIL_ERRORS.last4)
    .transform((value) => (value === "" ? null : value)),
});

const ownName = z
  .string({ error: EMAIL_ERRORS.nameTooLong })
  .transform(normalizeName)
  .pipe(
    z
      .string()
      .min(1)
      .max(OWN_NAME_MAX_LENGTH, EMAIL_ERRORS.nameTooLong)
      .refine((value) => !hasInvisibleCharacters(value), EMAIL_ERRORS.nameInvisible),
  );

/** «Mis nombres»: blank lines dropped, repeats (any case) collapsed, at most ten. */
export const setOwnNamesInputSchema = z.object({
  names: z
    .array(z.string({ error: EMAIL_ERRORS.nameTooLong }), { error: EMAIL_ERRORS.nameTooLong })
    .max(50, EMAIL_ERRORS.tooManyNames)
    .transform((values) => values.map((value) => normalizeName(value)).filter((v) => v !== ""))
    .pipe(z.array(ownName))
    .transform((values) => {
      const seen = new Set<string>();
      return values.filter((value) => {
        const key = value.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    })
    .refine((values) => values.length <= OWN_NAMES_MAX_ITEMS, EMAIL_ERRORS.tooManyNames),
});

export type RegisterSuggestionInput = z.output<typeof registerSuggestionInputSchema>;
