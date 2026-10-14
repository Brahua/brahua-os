"use server";

// Server Actions of the email suggestions (SPEC-finance-email). Each one goes through ownerAction():
// owner check first, Zod, then an ActionResult. Reachable by any POST, so input is `unknown`.
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { getDb } from "@/lib/db";
import { ownerAction } from "@/lib/owner-action";
import { ownerDateKey } from "@/lib/time";
import type { ExpenseItem } from "../expense-input";
import { expenseRefused } from "../failures";
import { revalidateFinanceAndHome, revalidateFinanceScreens } from "../revalidate";
import { EMAIL_COPY, EMAIL_ERRORS } from "./email-copy";
import {
  registerSuggestionInputSchema,
  setMethodLast4InputSchema,
  setOwnNamesInputSchema,
  suggestionIdInputSchema,
  undoRegisterInputSchema,
  type EmailSettings,
} from "./input";
import {
  selectEmailSettings,
  setMethodLast4 as writeMethodLast4,
  setOwnNames as writeOwnNames,
} from "./settings";
import {
  dismissSuggestion,
  markSuggestionPaid,
  registerSuggestion,
  undoDismiss,
  undoRegister,
  type DecideOutcome,
} from "./suggestions";

export type RegisteredSuggestion = { suggestionId: string; expense: ExpenseItem };

const register = ownerAction(
  registerSuggestionInputSchema,
  async (data) => {
    const outcome = await registerSuggestion(getDb(), data, ownerDateKey(new Date()));
    revalidateFinanceScreens();
    if (outcome.kind === "failed") {
      if (outcome.reason === "notFound") return fail<RegisteredSuggestion>(EMAIL_COPY.notFound);
      if (outcome.reason === "needsReview") {
        return fail<RegisteredSuggestion>(EMAIL_COPY.needsReview);
      }
      if (outcome.reason === "notPending") {
        return fail<RegisteredSuggestion>(EMAIL_COPY.alreadyDecided);
      }
      return expenseRefused<RegisteredSuggestion>(outcome.reason);
    }
    return ok({ suggestionId: outcome.suggestionId, expense: outcome.expense });
  },
  { name: "registerEmailSuggestion" },
);

/** «Registrar»: the suggestion becomes an expense (what was read, or what the sheet changed). */
export async function registerEmailSuggestion(
  input: unknown,
): Promise<ActionResult<RegisteredSuggestion>> {
  return register(input);
}

export type PaidSuggestion = RegisteredSuggestion & {
  recurringName: string;
  /** Set when this pay closed the payment (its last installment): «Deshacer» reopens it. */
  closedStamp: string | null;
};

const markPaid = ownerAction(
  suggestionIdInputSchema,
  async ({ id }) => {
    const outcome = await markSuggestionPaid(getDb(), id, ownerDateKey(new Date()));
    // The period leaves «Pendientes» and the home page's «Pagos»: both are revalidated.
    revalidateFinanceAndHome();
    if (outcome.kind === "failed") {
      const message =
        outcome.reason === "notFound"
          ? EMAIL_COPY.notFound
          : outcome.reason === "needsReview"
            ? EMAIL_COPY.needsReview
            : outcome.reason === "notPending"
              ? EMAIL_COPY.alreadyDecided
              : outcome.reason === "noMatch"
                ? EMAIL_COPY.noMatch
                : EMAIL_COPY.changedMeanwhile;
      return fail<PaidSuggestion>(message);
    }
    return ok({
      suggestionId: outcome.suggestionId,
      expense: outcome.expense,
      recurringName: outcome.recurringName,
      closedStamp: outcome.closedStamp,
    });
  },
  { name: "markEmailSuggestionPaid" },
);

/** «Marcar como pagado»: the suggestion is the payment of the recurring payment it looks like. */
export async function markEmailSuggestionPaid(
  input: unknown,
): Promise<ActionResult<PaidSuggestion>> {
  return markPaid(input);
}

function decided(outcome: DecideOutcome): ActionResult<{ id: string }> | null {
  if (outcome === "notFound") return fail(EMAIL_COPY.notFound);
  if (outcome === "changed") return fail(EMAIL_COPY.changedMeanwhile);
  return null;
}

const dismiss = ownerAction(
  suggestionIdInputSchema,
  async ({ id }) => {
    const outcome = await dismissSuggestion(getDb(), id);
    revalidateFinanceScreens();
    return decided(outcome) ?? ok({ id });
  },
  { name: "dismissEmailSuggestion" },
);

/** «Descartar»: out of the inbox, back with «Deshacer». */
export async function dismissEmailSuggestion(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return dismiss(input);
}

const restoreDismissed = ownerAction(
  suggestionIdInputSchema,
  async ({ id }) => {
    const outcome = await undoDismiss(getDb(), id);
    revalidateFinanceScreens();
    return decided(outcome) ?? ok({ id });
  },
  { name: "undoDismissEmailSuggestion" },
);

/** «Deshacer» of a dismiss. */
export async function undoDismissEmailSuggestion(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return restoreDismissed(input);
}

const undoRegistered = ownerAction(
  undoRegisterInputSchema,
  async (data) => {
    const outcome = await undoRegister(getDb(), data);
    // The expense leaves the month and, if it paid a period, that period is pending again on the
    // home page too.
    revalidateFinanceAndHome();
    return decided(outcome) ?? ok({ id: data.id });
  },
  { name: "undoRegisterEmailSuggestion" },
);

/** «Deshacer» of a register: the expense it created goes, the suggestion comes back. */
export async function undoRegisterEmailSuggestion(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return undoRegistered(input);
}

const saveOwnNames = ownerAction(
  setOwnNamesInputSchema,
  async ({ names }) => {
    await writeOwnNames(getDb(), names);
    revalidateFinanceScreens();
    return ok(await selectEmailSettings(getDb()));
  },
  { name: "setFinanceOwnNames" },
);

/** «Mis nombres» (Ajustes). */
export async function setOwnNames(input: unknown): Promise<ActionResult<EmailSettings>> {
  return saveOwnNames(input);
}

const saveLast4 = ownerAction(
  setMethodLast4InputSchema,
  async ({ id, last4 }) => {
    const failure = await writeMethodLast4(getDb(), id, last4);
    revalidateFinanceScreens();
    if (failure) return fail<EmailSettings>(EMAIL_ERRORS.methodGone);
    return ok(await selectEmailSettings(getDb()));
  },
  { name: "setFinanceMethodLast4" },
);

/** The last four digits of a payment method's card (Ajustes). */
export async function setMethodLast4(input: unknown): Promise<ActionResult<EmailSettings>> {
  return saveLast4(input);
}
