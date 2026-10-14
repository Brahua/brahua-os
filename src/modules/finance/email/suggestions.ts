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
import { stripBoldMarkers } from "./parsers/text";
import type { Tx } from "../catalog";
import {
  financeEmailSuggestions,
  financeExpenses,
  financePaymentMethods,
  financeRecurringPayments,
} from "../db/schema";
import type { CreateExpenseInput, ExpenseItem } from "../expense-input";
import {
  insertExpense,
  softDeleteExpense,
  selectExpenseById,
  updateExpense,
  type ExpenseFailure,
} from "../expenses";
import { lockRecurring } from "../catalog";
import { payPeriod, selectPaymentsView, undoPaidPeriod } from "../recurring";
import { FINANCE_ADVISORY_SPACE } from "../lock-keys";
import { EXPENSE_DESCRIPTION_MAX_LENGTH } from "../finance-constants";
import { EMAIL_ALIASES_MAX_ITEMS } from "./constants";
import type { RegisterSuggestionInput, SuggestionItem, SuggestionRecurring } from "./input";
import { matchRecurring, normalizeForMatch, type MatchCandidate } from "./recurring-match";

const INBOX_LIMIT = 50;

async function lockSuggestion(tx: Tx, id: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(${sql.raw(String(FINANCE_ADVISORY_SPACE))}, hashtext(${`finance:email:${id}`}))`,
  );
}

/** The inbox: pending and unreadable suggestions, newest first. */
export async function selectSuggestions(db: Database, today: string): Promise<SuggestionItem[]> {
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
  const recurring = await recurringIndex(db, today);
  return rows.map((row) => ({
    ...row,
    // Rows read before the markers were stripped may still carry them.
    merchant: row.merchant === null ? null : stripBoldMarkers(row.merchant),
    status: row.status as SuggestionItem["status"],
    method: methodHint(methods, row.cardLast4),
    recurring:
      row.amountCents !== null && row.currency !== null && row.merchant !== null
        ? recurring.find({
            merchant: row.merchant,
            amountCents: row.amountCents,
            currency: row.currency,
          })
        : null,
  }));
}

type RecurringIndex = {
  find: (input: {
    merchant: string;
    amountCents: number;
    currency: "PEN" | "USD";
  }) => SuggestionRecurring | null;
};

/**
 * What a suggestion can be matched against (SPEC-finance-email, addendum E5): the active payments
 * with a period waiting to be paid (the oldest one) and the ones whose period of this month is
 * already paid, with the merchants they remember. Two reads, however many suggestions.
 */
async function recurringIndex(db: Database | Tx, today: string): Promise<RecurringIndex> {
  const view = await selectPaymentsView(db, today);
  type Slot = {
    name: string;
    amountCents: number | null;
    currency: "PEN" | "USD";
    state: "pending" | "paid";
    dueOn: string;
    paid: { expenseId: string; amountCents: number } | null;
  };
  const slots = new Map<string, Slot>();
  for (const { recurring, dueOn } of view.pending) {
    const known = slots.get(recurring.id);
    if (!known || dueOn < known.dueOn) {
      slots.set(recurring.id, {
        name: recurring.name,
        amountCents: recurring.amountCents,
        currency: recurring.currency,
        state: "pending",
        dueOn,
        paid: null,
      });
    }
  }
  for (const entry of view.thisMonth) {
    if (entry.status !== "paid" || slots.has(entry.recurring.id)) continue;
    slots.set(entry.recurring.id, {
      name: entry.recurring.name,
      amountCents: entry.recurring.amountCents,
      currency: entry.recurring.currency,
      state: "paid",
      dueOn: entry.dueOn,
      paid: { expenseId: entry.expense.id, amountCents: entry.expense.amountCents },
    });
  }
  const ids = [...slots.keys()];
  const aliasRows =
    ids.length === 0
      ? []
      : await db
          .select({
            id: financeRecurringPayments.id,
            aliases: financeRecurringPayments.emailAliases,
          })
          .from(financeRecurringPayments)
          .where(inArray(financeRecurringPayments.id, ids));
  const aliases = new Map(aliasRows.map((row) => [row.id, row.aliases]));
  const candidates: MatchCandidate[] = ids.map((id) => {
    const slot = slots.get(id)!;
    return {
      id,
      name: slot.name,
      amountCents: slot.amountCents,
      currency: slot.currency,
      aliases: aliases.get(id) ?? [],
    };
  });
  return {
    find(input) {
      const match = matchRecurring(input, candidates);
      const slot = match ? slots.get(match.id) : undefined;
      if (!match || !slot) return null;
      return {
        id: match.id,
        name: slot.name,
        dueOn: slot.dueOn,
        state: slot.state,
        expectedCents: slot.amountCents,
        // A paid period is compared with what it was paid with; a pending one, with what is expected.
        sameAmount: slot.paid
          ? slot.paid.amountCents === input.amountCents
          : slot.amountCents === null || slot.amountCents === input.amountCents,
        paid: slot.paid,
      };
    },
  };
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
      ? normalizeName(stripBoldMarkers(row.merchant)).slice(0, EXPENSE_DESCRIPTION_MAX_LENGTH)
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

export type PaidOutcome =
  | {
      kind: "paid";
      suggestionId: string;
      expense: ExpenseItem;
      recurringName: string;
      /** The pay was the last installment and archived the payment: the undo reopens it. */
      closedStamp: string | null;
    }
  | { kind: "failed"; reason: "notFound" | "notPending" | "needsReview" | "noMatch" | "changed" };

/**
 * «Marcar como pagado» (addendum E5): the suggestion is the payment of the recurring payment it looks
 * like. It does what «Pagado» of Pagos does (`payPeriod`: the expense of that period, once) with what
 * the email says: its amount, its day (never after today) and the method its card points at. The
 * merchant is remembered by the payment. The match is computed HERE, never taken from the client.
 *
 * Locks: advisory first (the suggestion's, then the payment's), the suggestion's row after, and the
 * match is checked again once they are held: if it moved meanwhile, «cambió mientras tanto».
 */
export async function markSuggestionPaid(
  db: Database,
  id: string,
  today: string,
): Promise<PaidOutcome> {
  const read = async (reader: Database | Tx) => {
    const [row] = await reader
      .select()
      .from(financeEmailSuggestions)
      .where(eq(financeEmailSuggestions.id, id));
    return row;
  };
  const first = await read(db);
  const claim = suggestionClaim(first);
  if (claim.kind === "failed") return claim;
  const probe = (await recurringIndex(db, today)).find(claim.input);
  if (!probe || probe.state !== "pending") return { kind: "failed", reason: "noMatch" };

  return db.transaction(async (tx) => {
    await lockSuggestion(tx, id);
    await lockRecurring(tx, probe.id);
    const [row] = await tx
      .select()
      .from(financeEmailSuggestions)
      .where(eq(financeEmailSuggestions.id, id))
      .for("update");
    const checked = suggestionClaim(row);
    if (checked.kind === "failed") return checked;
    const match = (await recurringIndex(tx, today)).find(checked.input);
    if (
      !match ||
      match.state !== "pending" ||
      match.id !== probe.id ||
      match.dueOn !== probe.dueOn
    ) {
      return { kind: "failed", reason: "changed" };
    }
    const methods = await tx
      .select({
        id: financePaymentMethods.id,
        name: financePaymentMethods.name,
        last4: financePaymentMethods.last4,
      })
      .from(financePaymentMethods)
      .where(isNull(financePaymentMethods.archivedAt));
    const hint = methodHint(methods, row.cardLast4);
    const paid = await payPeriod(
      tx as unknown as Database,
      {
        id: match.id,
        dueOn: match.dueOn,
        amount: checked.input.amountCents,
        spentOn: row.occurredOn! > today ? today : row.occurredOn!,
        ...(hint ? { paymentMethodId: hint.id } : {}),
      },
      today,
    );
    if (typeof paid === "string") return { kind: "failed", reason: "changed" };

    await tx
      .update(financeEmailSuggestions)
      .set({ status: "registered", expenseId: paid.expense.id, decidedAt: sql`now()` })
      .where(eq(financeEmailSuggestions.id, id));
    // The payment remembers this merchant: next time it is recognized by it, whatever the amount.
    const alias = normalizeForMatch(checked.input.merchant).slice(0, 80);
    if (alias !== "") {
      const [current] = await tx
        .select({ aliases: financeRecurringPayments.emailAliases })
        .from(financeRecurringPayments)
        .where(eq(financeRecurringPayments.id, match.id));
      const next = [...(current?.aliases ?? []).filter((known) => known !== alias), alias].slice(
        -EMAIL_ALIASES_MAX_ITEMS,
      );
      await tx
        .update(financeRecurringPayments)
        .set({ emailAliases: next })
        .where(eq(financeRecurringPayments.id, match.id));
    }
    return {
      kind: "paid",
      suggestionId: id,
      expense: paid.expense,
      recurringName: match.name,
      closedStamp: paid.closedStamp,
    };
  });
}

export type CorrectOutcome =
  | {
      kind: "corrected";
      suggestionId: string;
      expense: ExpenseItem;
      previousCents: number;
      recurringName: string;
    }
  | { kind: "failed"; reason: "notFound" | "notPending" | "needsReview" | "noMatch" | "changed" };

/**
 * «Corregir a X» (addendum E5, «Ya marcaste…»): the period of the recurring payment this email paid
 * was already marked as paid with another amount (a tax that varies, a rounding): the email's amount
 * is what the bank charged, so the expense of that period takes it. The suggestion is then decided
 * (dismissed): its job is done. Same locks as «Marcar como pagado», and the match is checked again
 * once they are held.
 */
export async function correctPaidAmount(
  db: Database,
  id: string,
  today: string,
): Promise<CorrectOutcome> {
  const [first] = await db
    .select()
    .from(financeEmailSuggestions)
    .where(eq(financeEmailSuggestions.id, id));
  const claim = suggestionClaim(first);
  if (claim.kind === "failed") return claim;
  const probe = (await recurringIndex(db, today)).find(claim.input);
  if (!probe || probe.state !== "paid" || !probe.paid || probe.sameAmount) {
    return { kind: "failed", reason: "noMatch" };
  }
  const probeExpenseId = probe.paid.expenseId;

  return db.transaction(async (tx) => {
    await lockSuggestion(tx, id);
    await lockRecurring(tx, probe.id);
    const [row] = await tx
      .select()
      .from(financeEmailSuggestions)
      .where(eq(financeEmailSuggestions.id, id))
      .for("update");
    const checked = suggestionClaim(row);
    if (checked.kind === "failed") return checked;
    const match = (await recurringIndex(tx, today)).find(checked.input);
    if (
      !match ||
      match.state !== "paid" ||
      match.id !== probe.id ||
      match.paid?.expenseId !== probeExpenseId ||
      match.sameAmount
    ) {
      return { kind: "failed", reason: "changed" };
    }
    const existing = await selectExpenseById(tx, probeExpenseId);
    // The expense was edited in the meantime into another currency: not this email's to correct.
    if (!existing || existing.currency !== checked.input.currency) {
      return { kind: "failed", reason: "changed" };
    }
    const updated = await updateExpense(tx as unknown as Database, {
      id: existing.id,
      amount: checked.input.amountCents,
      description: existing.description,
      currency: existing.currency,
      categoryId: existing.category?.id ?? null,
      paymentMethodId: existing.paymentMethod?.id ?? null,
      spentOn: existing.spentOn,
    });
    if (typeof updated === "string") return { kind: "failed", reason: "changed" };
    await tx
      .update(financeEmailSuggestions)
      .set({ status: "dismissed", decidedAt: sql`now()` })
      .where(eq(financeEmailSuggestions.id, id));
    return {
      kind: "corrected",
      suggestionId: id,
      expense: updated,
      previousCents: existing.amountCents,
      recurringName: match.name,
    };
  });
}

/**
 * «Deshacer» of a correction: the expense goes back to its previous amount and the suggestion to the
 * inbox. Only while the suggestion is still the one the correction dismissed and the expense still
 * says what the correction wrote: if either moved, «cambió mientras tanto».
 */
export async function undoCorrection(
  db: Database,
  input: { id: string; expenseId: string; previousCents: number },
): Promise<DecideOutcome> {
  return db.transaction(async (tx) => {
    await lockSuggestion(tx, input.id);
    const [row] = await tx
      .select()
      .from(financeEmailSuggestions)
      .where(eq(financeEmailSuggestions.id, input.id))
      .for("update");
    if (!row) return "notFound";
    if (row.status === "pending") return "done";
    if (row.status !== "dismissed" || row.amountCents === null) return "changed";
    const existing = await selectExpenseById(tx, input.expenseId);
    if (!existing || existing.amountCents !== row.amountCents) return "changed";
    const reverted = await updateExpense(tx as unknown as Database, {
      id: existing.id,
      amount: input.previousCents,
      description: existing.description,
      currency: existing.currency,
      categoryId: existing.category?.id ?? null,
      paymentMethodId: existing.paymentMethod?.id ?? null,
      spentOn: existing.spentOn,
    });
    if (typeof reverted === "string") return "changed";
    await tx
      .update(financeEmailSuggestions)
      .set({ status: "pending", decidedAt: null })
      .where(eq(financeEmailSuggestions.id, input.id));
    return "done";
  });
}

/** A pending, verified suggestion with a reading: what the match needs. */
function suggestionClaim(
  row: typeof financeEmailSuggestions.$inferSelect | undefined,
):
  | { kind: "ok"; input: { merchant: string; amountCents: number; currency: "PEN" | "USD" } }
  | { kind: "failed"; reason: "notFound" | "notPending" | "needsReview" } {
  if (!row) return { kind: "failed", reason: "notFound" };
  if (row.status !== "pending") return { kind: "failed", reason: "notPending" };
  if (
    row.amountCents === null ||
    row.currency === null ||
    row.merchant === null ||
    row.occurredOn === null
  ) {
    return { kind: "failed", reason: "notPending" };
  }
  // Like «Registrar»: a sender Gmail could not verify is looked at first (the sheet).
  if (!row.senderVerified) return { kind: "failed", reason: "needsReview" };
  return {
    kind: "ok",
    input: { merchant: row.merchant, amountCents: row.amountCents, currency: row.currency },
  };
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
  input: { id: string; expenseId: string; reopenStamp?: string | null },
): Promise<DecideOutcome> {
  // An expense that paid a recurring period is undone as that pay (the settlement goes with it and
  // a payment the pay archived is reopened). The expense is read first, without locks: the advisory
  // locks must be the first ones of the transaction.
  const [paid] = await db
    .select({
      recurringId: financeExpenses.recurringPaymentId,
      dueOn: financeExpenses.recurringDueOn,
    })
    .from(financeExpenses)
    .where(eq(financeExpenses.id, input.expenseId));
  const recurringId = paid?.recurringId ?? null;
  return db.transaction(async (tx) => {
    await lockSuggestion(tx, input.id);
    if (recurringId) await lockRecurring(tx, recurringId);
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
    if (recurringId && paid?.dueOn) {
      const undone = await undoPaidPeriod(tx as unknown as Database, {
        id: recurringId,
        dueOn: paid.dueOn,
        expenseId: input.expenseId,
        reopenStamp: input.reopenStamp ?? undefined,
      });
      if (typeof undone === "string") return "changed";
    } else {
      await softDeleteExpense(tx as unknown as Database, input.expenseId);
    }
    await tx
      .update(financeEmailSuggestions)
      .set({ status: "pending", expenseId: null, decidedAt: null })
      .where(and(eq(financeEmailSuggestions.id, input.id)));
    return "done";
  });
}
