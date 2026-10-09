// What the Telegram bot (`reminders`, R3) needs from `finance`, as plain data-layer functions: this
// file imports nothing of `reminders` (the composition root `src/lib/bot-capture.ts` joins the two).
// The webhook has already authenticated Telegram and checked that the chat is the owner's, so,
// like the tick, these trust their caller; the input is still validated with the schema of the
// expense form.
import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { parseExpenseText } from "@/lib/natural-date";
import { ownerDateKey } from "@/lib/time";
import { financeExpenses } from "./db/schema";
import { createExpenseInputSchema, type ExpenseItem } from "./expense-input";
import { insertExpense } from "./expenses";
import { EXPENSE_ERRORS } from "./finance-copy";
import { centsToInput } from "./money";

export type CaptureExpenseResult =
  { ok: true; expense: ExpenseItem } | { ok: false; reason: "no_amount" | "too_long" | "invalid" };

/**
 * Saves an expense from a line of text: «12.50 café», «café 12,50», «S/ 12 taxi», «USD 95
 * claude». The amount is read by the shared parser (whole cents, never a float); what is left is
 * the description; the rest takes the defaults of SPEC-finance (today in Lima, the last method,
 * its currency). `db` may be the webhook's transaction (the insert is then a savepoint of it).
 */
export async function captureExpenseText(
  db: Database,
  text: string,
  now: Date,
): Promise<CaptureExpenseResult> {
  const reading = parseExpenseText(text);
  if (reading.amountCents === null) return { ok: false, reason: "no_amount" };
  const parsed = createExpenseInputSchema.safeParse({
    amount: centsToInput(reading.amountCents),
    description: reading.description === "" ? null : reading.description,
    ...(reading.currency ? { currency: reading.currency } : {}),
  });
  if (!parsed.success) {
    const tooLong = parsed.error.issues.some(
      (issue) => issue.message === EXPENSE_ERRORS.descriptionTooLong,
    );
    return { ok: false, reason: tooLong ? "too_long" : "invalid" };
  }
  const expense = await insertExpense(db, parsed.data, ownerDateKey(now));
  return typeof expense === "string" ? { ok: false, reason: "invalid" } : { ok: true, expense };
}

/**
 * "Deshacer" of a captured expense: soft-deletes exactly `id`, but only while nobody touched it
 * (not deleted and `updated_at` still equals `created_at`; an edit stamps `updated_at`). A loose
 * expense only: one that pays a recurring payment is never undone from here. One UPDATE: a
 * concurrent edit either wins first ("changed") or loses; a newer state is never overwritten.
 */
export async function undoCapturedExpense(
  db: Database,
  id: string,
): Promise<"undone" | "changed" | "gone"> {
  const undone = await db
    .update(financeExpenses)
    .set({ deletedAt: sql`now()` })
    .where(
      and(
        eq(financeExpenses.id, id),
        isNull(financeExpenses.deletedAt),
        isNull(financeExpenses.recurringPaymentId),
        sql`${financeExpenses.updatedAt} = ${financeExpenses.createdAt}`,
      ),
    )
    .returning({ id: financeExpenses.id });
  if (undone.length > 0) return "undone";
  const [row] = await db
    .select({ deletedAt: financeExpenses.deletedAt })
    .from(financeExpenses)
    .where(eq(financeExpenses.id, id));
  return !row || row.deletedAt !== null ? "gone" : "changed";
}
