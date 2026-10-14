// The inbox of email suggestions (server only): list, register, dismiss and their undo. Like the
// rest of `finance` these take the database and trust their input; the actions check the owner and
// validate first.
//
// Locks (catalog.ts, "Locks"): one suggestion's lock is `(5000, hashtext('finance:email:<id>'))`, the
// FIRST lock of the transaction, so two taps, two tabs or a register racing its undo are
// serialized and the second sees what the first did. Registering creates the expense inside the
// same transaction (a savepoint of it), so a suggestion is `registered` exactly when its expense
// exists.
import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { hasInvisibleCharacters, normalizeName } from "@/lib/text";
import type { Tx } from "../catalog";
import { financeEmailSuggestions, financePaymentMethods } from "../db/schema";
import type { CreateExpenseInput, ExpenseItem } from "../expense-input";
import {
  insertExpense,
  softDeleteExpense,
  selectExpenseById,
  type ExpenseFailure,
} from "../expenses";
import { FINANCE_ADVISORY_SPACE } from "../lock-keys";
import { EXPENSE_DESCRIPTION_MAX_LENGTH } from "../finance-constants";
import type { RegisterSuggestionInput, SuggestionItem } from "./input";

const INBOX_LIMIT = 50;

async function lockSuggestion(tx: Tx, id: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(${sql.raw(String(FINANCE_ADVISORY_SPACE))}, hashtext(${`finance:email:${id}`}))`,
  );
}

/** The inbox: pending and unreadable suggestions, newest first. */
export async function selectSuggestions(db: Database): Promise<SuggestionItem[]> {
  const s = financeEmailSuggestions;
  const rows = await db
    .select({
      id: s.id,
      source: s.source,
      kind: s.kind,
      status: s.status,
      amountCents: s.amountCents,
      currency: s.currency,
      merchant: s.merchant,
      occurredOn: s.occurredOn,
      cardLast4: s.cardLast4,
      subject: s.subject,
      senderVerified: s.senderVerified,
      // Qualified by hand: Drizzle prints the columns of a single table without it, so inside the
      // subquery `${s.amountCents}` would read the expenses' own column (always equal).
      duplicate: sql<boolean>`exists (
        select 1 from "finance_expenses" as "e"
        where "e"."deleted_at" is null
          and "e"."amount_cents" = "finance_email_suggestions"."amount_cents"
          and "e"."currency" = "finance_email_suggestions"."currency"
          and "e"."spent_on" = "finance_email_suggestions"."occurred_on"
      )`,
    })
    .from(s)
    .where(inArray(s.status, ["pending", "unreadable"]))
    .orderBy(desc(s.createdAt), desc(s.id))
    .limit(INBOX_LIMIT);

  const methods = await db
    .select({
      id: financePaymentMethods.id,
      name: financePaymentMethods.name,
      last4: financePaymentMethods.last4,
    })
    .from(financePaymentMethods)
    .where(isNull(financePaymentMethods.archivedAt));
  return rows.map((row) => ({
    ...row,
    status: row.status as SuggestionItem["status"],
    method: methodHint(methods, row.cardLast4),
  }));
}

/** The one visible method with these last four digits (two with the same digits are ambiguous). */
function methodHint(
  methods: readonly { id: string; name: string; last4: string | null }[],
  cardLast4: string | null,
): { id: string; name: string } | null {
  if (!cardLast4) return null;
  const matches = methods.filter((method) => method.last4 === cardLast4);
  return matches.length === 1 ? { id: matches[0].id, name: matches[0].name } : null;
}

export type RegisterOutcome =
  | { kind: "registered"; suggestionId: string; expense: ExpenseItem }
  /** Already registered (a second tap): the expense it made, nothing new created. */
  | { kind: "already"; suggestionId: string; expense: ExpenseItem }
  | { kind: "failed"; reason: "notFound" | "notPending" | "needsReview" | ExpenseFailure };

/**
 * Registers a suggestion as an expense. Without overrides it takes what was read: the amount, the
 * merchant as description, its currency and day, the method its card digits point at (else the
 * last one used). The owner's overrides (the sheet) win.
 */
export async function registerSuggestion(
  db: Database,
  input: RegisterSuggestionInput,
  today: string,
): Promise<RegisterOutcome> {
  return db.transaction(async (tx) => {
    await lockSuggestion(tx, input.id);
    const [row] = await tx
      .select()
      .from(financeEmailSuggestions)
      .where(eq(financeEmailSuggestions.id, input.id))
      .for("update");
    if (!row) return { kind: "failed", reason: "notFound" };
    if (row.status === "registered" && row.expenseId) {
      const expense = await selectExpenseById(tx, row.expenseId);
      if (expense) return { kind: "already", suggestionId: row.id, expense };
      // Its expense was deleted since: it can be registered again.
    } else if (row.status !== "pending") {
      return { kind: "failed", reason: "notPending" };
    }
    if (row.amountCents === null || row.currency === null || row.occurredOn === null) {
      return { kind: "failed", reason: "notPending" };
    }

    // A sender Gmail could not verify is looked at first (the sheet): the server holds the rule too,
    // so a bare register of it is refused, not only hidden in the UI.
    if (!row.senderVerified && input.overrides === undefined) {
      return { kind: "failed", reason: "needsReview" };
    }

    const overrides = input.overrides ?? {};
    const methods = await tx
      .select({
        id: financePaymentMethods.id,
        name: financePaymentMethods.name,
        last4: financePaymentMethods.last4,
      })
      .from(financePaymentMethods)
      .where(isNull(financePaymentMethods.archivedAt));
    const hint = methodHint(methods, row.cardLast4);

    const merchant = row.merchant
      ? normalizeName(row.merchant).slice(0, EXPENSE_DESCRIPTION_MAX_LENGTH)
      : "";
    const readDescription = merchant !== "" && !hasInvisibleCharacters(merchant) ? merchant : null;
    const expenseInput: CreateExpenseInput = {
      amount: overrides.amount ?? row.amountCents,
      description: overrides.description !== undefined ? overrides.description : readDescription,
      currency: row.currency,
      // The day the bank wrote, never after today in Lima.
      spentOn: row.occurredOn > today ? today : row.occurredOn,
      categoryId: overrides.categoryId ?? null,
      ...(overrides.paymentMethodId !== undefined
        ? { paymentMethodId: overrides.paymentMethodId }
        : hint
          ? { paymentMethodId: hint.id }
          : {}),
    };
    const created = await insertExpense(tx as unknown as Database, expenseInput, today);
    if (typeof created === "string") return { kind: "failed", reason: created };
    await tx
      .update(financeEmailSuggestions)
      .set({ status: "registered", expenseId: created.id, decidedAt: sql`now()` })
      .where(eq(financeEmailSuggestions.id, row.id));
    return { kind: "registered", suggestionId: row.id, expense: created };
  });
}

export type DecideOutcome = "done" | "notFound" | "changed";

/** «Descartar»: pending or unreadable → dismissed. Twice is fine. */
export async function dismissSuggestion(db: Database, id: string): Promise<DecideOutcome> {
  return db.transaction(async (tx) => {
    await lockSuggestion(tx, id);
    const [row] = await tx
      .select({ status: financeEmailSuggestions.status })
      .from(financeEmailSuggestions)
      .where(eq(financeEmailSuggestions.id, id))
      .for("update");
    if (!row) return "notFound";
    if (row.status === "dismissed") return "done";
    if (row.status === "registered") return "changed";
    await tx
      .update(financeEmailSuggestions)
      .set({ status: "dismissed", decidedAt: sql`now()` })
      .where(eq(financeEmailSuggestions.id, id));
    return "done";
  });
}

/** «Deshacer» of a dismiss: back to the inbox (unreadable stays unreadable). Only if still dismissed. */
export async function undoDismiss(db: Database, id: string): Promise<DecideOutcome> {
  return db.transaction(async (tx) => {
    await lockSuggestion(tx, id);
    const [row] = await tx
      .select({
        status: financeEmailSuggestions.status,
        amountCents: financeEmailSuggestions.amountCents,
      })
      .from(financeEmailSuggestions)
      .where(eq(financeEmailSuggestions.id, id))
      .for("update");
    if (!row) return "notFound";
    if (row.status === "pending" || row.status === "unreadable") return "done";
    if (row.status !== "dismissed") return "changed";
    await tx
      .update(financeEmailSuggestions)
      .set({ status: row.amountCents === null ? "unreadable" : "pending", decidedAt: null })
      .where(eq(financeEmailSuggestions.id, id));
    return "done";
  });
}

/**
 * «Deshacer» of a register: carries the suggestion AND the expense it created. It only acts when the
 * suggestion is still registered with that very expense; otherwise "cambió mientras tanto". The
 * expense is deleted (soft, like any delete) and the suggestion goes back to the inbox.
 */
export async function undoRegister(
  db: Database,
  input: { id: string; expenseId: string },
): Promise<DecideOutcome> {
  return db.transaction(async (tx) => {
    await lockSuggestion(tx, input.id);
    const [row] = await tx
      .select({
        status: financeEmailSuggestions.status,
        expenseId: financeEmailSuggestions.expenseId,
      })
      .from(financeEmailSuggestions)
      .where(eq(financeEmailSuggestions.id, input.id))
      .for("update");
    if (!row) return "notFound";
    if (row.status === "pending") return "done";
    if (row.status !== "registered" || row.expenseId !== input.expenseId) return "changed";
    await softDeleteExpense(tx as unknown as Database, input.expenseId);
    await tx
      .update(financeEmailSuggestions)
      .set({ status: "pending", expenseId: null, decidedAt: null })
      .where(and(eq(financeEmailSuggestions.id, input.id)));
    return "done";
  });
}
