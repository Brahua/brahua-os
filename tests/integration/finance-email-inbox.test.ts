// @vitest-environment node
// E3 of `finance-email`: the inbox against Postgres — what the list shows (method hint, duplicate
// flag), register (what was read, the owner's overrides, twice, at the same time), the exact undo of
// each decision and the settings («Mis nombres», last four digits).
import { eq } from "drizzle-orm";
import { describe, expect, test, vi } from "vitest";
import {
  financeEmailSuggestions,
  financeExpenses,
  financePaymentMethods,
  financeRecurringPayments,
  financeSettings,
  financeSettlements,
  type NewFinanceEmailSuggestion,
} from "@/modules/finance/db/schema";
import {
  correctPaidAmount,
  dismissSuggestion,
  markSuggestionPaid,
  registerSuggestion,
  selectSuggestions,
  undoCorrection,
  undoDismiss,
  undoRegister,
} from "@/modules/finance/email/suggestions";
import { selectEmailSettings, setMethodLast4, setOwnNames } from "@/modules/finance/email/settings";
import { payPeriod } from "@/modules/finance/recurring";
import { testDb } from "./test-db";

vi.mock("server-only", () => ({}));

const TODAY = "2026-10-14";
let counter = 0;

async function suggest(over: Partial<NewFinanceEmailSuggestion> = {}) {
  counter += 1;
  const [row] = await testDb
    .insert(financeEmailSuggestions)
    .values({
      gmailMessageId: `msg${String(counter).padStart(8, "0")}`,
      source: "bbva",
      kind: "card",
      status: "pending",
      amountCents: 4320,
      currency: "PEN",
      merchant: "TIENDA DEMO SAC",
      occurredOn: "2026-10-11",
      cardLast4: "1234",
      subject: "Has realizado un consumo con tu tarjeta BBVA",
      senderVerified: true,
      ...over,
    })
    .returning();
  return row;
}

const method = async (name: string, last4: string | null, extra = {}) => {
  const [row] = await testDb
    .insert(financePaymentMethods)
    .values({ name, last4, sortOrder: counter++, ...extra })
    .returning();
  return row;
};

const expenses = () => testDb.select().from(financeExpenses);
const suggestionOf = async (id: string) =>
  (
    await testDb.select().from(financeEmailSuggestions).where(eq(financeEmailSuggestions.id, id))
  )[0];

describe("the inbox list", () => {
  test("shows pending and unreadable, newest first, never decided ones", async () => {
    const first = await suggest({ createdAt: new Date("2026-10-11T10:00:00Z") });
    const unreadable = await suggest({
      status: "unreadable",
      kind: null,
      amountCents: null,
      currency: null,
      merchant: null,
      occurredOn: null,
      createdAt: new Date("2026-10-12T10:00:00Z"),
    });
    await suggest({ status: "dismissed", decidedAt: new Date() });
    const list = await selectSuggestions(testDb, TODAY);
    expect(list.map((item) => item.id)).toEqual([unreadable.id, first.id]);
    expect(list[0]).toMatchObject({ status: "unreadable", amountCents: null });
  });

  test("the method hint needs exactly one method with those digits", async () => {
    const bbva = await method("BBVA crédito", "1234");
    await suggest();
    expect((await selectSuggestions(testDb, TODAY))[0].method).toEqual({
      id: bbva.id,
      name: "BBVA crédito",
    });
    // A second method with the same digits makes it ambiguous: no hint (positive control above).
    await method("Otra", "1234");
    expect((await selectSuggestions(testDb, TODAY))[0].method).toBeNull();
  });

  test("an archived method is no hint", async () => {
    await method("Vieja", "1234", { archivedAt: new Date() });
    await suggest();
    expect((await selectSuggestions(testDb, TODAY))[0].method).toBeNull();
  });

  test("a visible expense of the same amount, currency and day flags a possible duplicate", async () => {
    await suggest();
    expect((await selectSuggestions(testDb, TODAY))[0].duplicate).toBe(false);
    const base = { amountCents: 4320, currency: "PEN", spentOn: "2026-10-11" } as const;
    // Other day, other amount, other currency, deleted: none of them counts.
    await testDb.insert(financeExpenses).values([
      { ...base, spentOn: "2026-10-12" },
      { ...base, amountCents: 4321 },
      { ...base, currency: "USD" },
      { ...base, deletedAt: new Date() },
    ]);
    expect((await selectSuggestions(testDb, TODAY))[0].duplicate).toBe(false);
    await testDb.insert(financeExpenses).values(base);
    expect((await selectSuggestions(testDb, TODAY))[0].duplicate).toBe(true);
  });
});

describe("register", () => {
  test("takes what was read: amount, merchant, currency, day and the method of its card", async () => {
    const bbva = await method("BBVA crédito", "1234");
    const row = await suggest();
    const outcome = await registerSuggestion(testDb, { id: row.id }, TODAY);
    expect(outcome.kind).toBe("registered");
    const [expense] = await expenses();
    expect(expense).toMatchObject({
      amountCents: 4320,
      currency: "PEN",
      description: "TIENDA DEMO SAC",
      spentOn: "2026-10-11",
      paymentMethodId: bbva.id,
      categoryId: null,
    });
    expect(await suggestionOf(row.id)).toMatchObject({
      status: "registered",
      expenseId: expense.id,
    });
    expect((await suggestionOf(row.id)).decidedAt).not.toBeNull();
  });

  test("the owner's overrides win (amount, description, method)", async () => {
    await method("BBVA crédito", "1234");
    const cash = await method("Efectivo", null);
    const row = await suggest();
    await registerSuggestion(
      testDb,
      { id: row.id, overrides: { amount: 5000, description: "Cena", paymentMethodId: cash.id } },
      TODAY,
    );
    expect((await expenses())[0]).toMatchObject({
      amountCents: 5000,
      description: "Cena",
      paymentMethodId: cash.id,
    });
  });

  test("an unverified sender is refused a bare register but can be registered with the sheet's fields", async () => {
    const row = await suggest({ senderVerified: false });
    expect(await registerSuggestion(testDb, { id: row.id }, TODAY)).toEqual({
      kind: "failed",
      reason: "needsReview",
    });
    expect(await expenses()).toHaveLength(0);
    const outcome = await registerSuggestion(testDb, { id: row.id, overrides: {} }, TODAY);
    expect(outcome.kind).toBe("registered");
  });

  test("a merchant stored with bold markers is shown and registered clean", async () => {
    const row = await suggest({ merchant: "*PARAMOUNT+*" });
    expect((await selectSuggestions(testDb, TODAY))[0].merchant).toBe("PARAMOUNT+");
    await registerSuggestion(testDb, { id: row.id }, TODAY);
    expect((await expenses())[0].description).toBe("PARAMOUNT+");
  });

  test("a USD suggestion makes a USD expense with the rate in force", async () => {
    const row = await suggest({ currency: "USD", amountCents: 646 });
    await registerSuggestion(testDb, { id: row.id }, TODAY);
    expect((await expenses())[0]).toMatchObject({ currency: "USD", amountCents: 646 });
  });

  test("a day after today in Lima is today", async () => {
    const row = await suggest({ occurredOn: "2026-10-15" });
    await registerSuggestion(testDb, { id: row.id }, TODAY);
    expect((await expenses())[0].spentOn).toBe(TODAY);
  });

  test("a second register of the same suggestion creates nothing new", async () => {
    const row = await suggest();
    const first = await registerSuggestion(testDb, { id: row.id }, TODAY);
    const second = await registerSuggestion(testDb, { id: row.id }, TODAY);
    expect(second.kind).toBe("already");
    expect(second.kind === "already" && first.kind === "registered" && second.expense.id).toBe(
      first.kind === "registered" ? first.expense.id : null,
    );
    expect(await expenses()).toHaveLength(1);
  });

  test("two at once leave one expense; two different suggestions leave two (positive control)", async () => {
    const row = await suggest();
    await Promise.all([
      registerSuggestion(testDb, { id: row.id }, TODAY),
      registerSuggestion(testDb, { id: row.id }, TODAY),
      registerSuggestion(testDb, { id: row.id }, TODAY),
    ]);
    expect(await expenses()).toHaveLength(1);
    const other = await suggest();
    await registerSuggestion(testDb, { id: other.id }, TODAY);
    expect(await expenses()).toHaveLength(2);
  });

  test("refuses what is not pending, and a method or category that is gone", async () => {
    const dismissed = await suggest({ status: "dismissed", decidedAt: new Date() });
    expect(await registerSuggestion(testDb, { id: dismissed.id }, TODAY)).toEqual({
      kind: "failed",
      reason: "notPending",
    });
    const unreadable = await suggest({
      status: "unreadable",
      kind: null,
      amountCents: null,
      currency: null,
      merchant: null,
      occurredOn: null,
    });
    expect((await registerSuggestion(testDb, { id: unreadable.id }, TODAY)).kind).toBe("failed");
    expect(
      await registerSuggestion(testDb, { id: "00000000-0000-4000-8000-000000000000" }, TODAY),
    ).toEqual({ kind: "failed", reason: "notFound" });
    const row = await suggest();
    const gone = await method("Archivado", null, { archivedAt: new Date() });
    expect(
      await registerSuggestion(
        testDb,
        { id: row.id, overrides: { paymentMethodId: gone.id } },
        TODAY,
      ),
    ).toEqual({ kind: "failed", reason: "methodUnavailable" });
    // The refusal rolled everything back: still pending, no expense.
    expect(await suggestionOf(row.id)).toMatchObject({ status: "pending", expenseId: null });
    expect(await expenses()).toHaveLength(0);
  });
});

describe("the exact undo", () => {
  test("undo of a register removes that expense and puts the suggestion back", async () => {
    const row = await suggest();
    const outcome = await registerSuggestion(testDb, { id: row.id }, TODAY);
    if (outcome.kind !== "registered") throw new Error("not registered");
    expect(await undoRegister(testDb, { id: row.id, expenseId: outcome.expense.id })).toBe("done");
    expect(await suggestionOf(row.id)).toMatchObject({
      status: "pending",
      expenseId: null,
      decidedAt: null,
    });
    expect((await expenses())[0].deletedAt).not.toBeNull();
    // Registered again after the undo: a new expense, the old one stays deleted.
    const again = await registerSuggestion(testDb, { id: row.id }, TODAY);
    expect(again.kind).toBe("registered");
    expect(await expenses()).toHaveLength(2);
  });

  test("an old undo (another expense id) changes nothing", async () => {
    const row = await suggest();
    const outcome = await registerSuggestion(testDb, { id: row.id }, TODAY);
    if (outcome.kind !== "registered") throw new Error("not registered");
    expect(
      await undoRegister(testDb, { id: row.id, expenseId: "00000000-0000-4000-8000-000000000000" }),
    ).toBe("changed");
    expect(await suggestionOf(row.id)).toMatchObject({ status: "registered" });
    expect((await expenses())[0].deletedAt).toBeNull();
  });

  test("dismiss, and its undo (an unreadable one stays unreadable)", async () => {
    const row = await suggest();
    expect(await dismissSuggestion(testDb, row.id)).toBe("done");
    expect(await dismissSuggestion(testDb, row.id)).toBe("done");
    expect((await suggestionOf(row.id)).status).toBe("dismissed");
    expect(await undoDismiss(testDb, row.id)).toBe("done");
    expect(await suggestionOf(row.id)).toMatchObject({ status: "pending", decidedAt: null });

    const unreadable = await suggest({
      status: "unreadable",
      kind: null,
      amountCents: null,
      currency: null,
      merchant: null,
      occurredOn: null,
    });
    await dismissSuggestion(testDb, unreadable.id);
    await undoDismiss(testDb, unreadable.id);
    expect((await suggestionOf(unreadable.id)).status).toBe("unreadable");
  });

  test("a registered suggestion cannot be dismissed, and undoing a dismiss that was registered is refused", async () => {
    const row = await suggest();
    await registerSuggestion(testDb, { id: row.id }, TODAY);
    expect(await dismissSuggestion(testDb, row.id)).toBe("changed");
    expect(await undoDismiss(testDb, row.id)).toBe("changed");
  });
});

describe("settings", () => {
  test("«Mis nombres» is created and replaced", async () => {
    expect((await selectEmailSettings(testDb)).ownNames).toEqual([]);
    await setOwnNames(testDb, ["Ana Demo Perez"]);
    expect((await selectEmailSettings(testDb)).ownNames).toEqual(["Ana Demo Perez"]);
    await setOwnNames(testDb, []);
    expect((await selectEmailSettings(testDb)).ownNames).toEqual([]);
  });

  test("last four digits: set, clear, and a method that is gone", async () => {
    const visible = await method("BBVA", null);
    expect(await setMethodLast4(testDb, visible.id, "3659")).toBeNull();
    expect((await selectEmailSettings(testDb)).methods).toEqual([
      { id: visible.id, name: "BBVA", last4: "3659" },
    ]);
    expect(await setMethodLast4(testDb, visible.id, null)).toBeNull();
    expect((await selectEmailSettings(testDb)).methods[0].last4).toBeNull();
    const archived = await method("Vieja", null, { archivedAt: new Date() });
    expect(await setMethodLast4(testDb, archived.id, "1111")).toBe("methodGone");
    expect(await setMethodLast4(testDb, "00000000-0000-4000-8000-000000000000", "1111")).toBe(
      "methodGone",
    );
  });
});

describe("recurring payments that arrive by email (addendum E5)", () => {
  /** A monthly payment due on the 10th: its period of 2026-10-10 is pending on TODAY (2026-10-14). */
  const recurring = async (over: Partial<typeof financeRecurringPayments.$inferInsert> = {}) => {
    const [row] = await testDb
      .insert(financeRecurringPayments)
      .values({
        name: "Netflix",
        amountCents: 5000,
        currency: "PEN",
        cycle: "monthly",
        dayOfMonth: 10,
        startDate: "2026-10-01",
        ...over,
      })
      .returning();
    return row;
  };
  const expenseRows = () => testDb.select().from(financeExpenses);
  const settlements = () => testDb.select().from(financeSettlements);
  const aliasesOf = async (id: string) =>
    (
      await testDb
        .select()
        .from(financeRecurringPayments)
        .where(eq(financeRecurringPayments.id, id))
    )[0].emailAliases;
  const netflix = (over: Partial<NewFinanceEmailSuggestion> = {}) =>
    suggest({ merchant: "NETFLIX.COM", amountCents: 5000, occurredOn: "2026-10-13", ...over });

  test("the list says which payment it looks like, its period and whether the amount is the expected", async () => {
    const payment = await recurring();
    await netflix();
    await netflix({ amountCents: 6000 });
    const [different, same] = await selectSuggestions(testDb, TODAY);
    expect(same.recurring).toEqual({
      id: payment.id,
      name: "Netflix",
      dueOn: "2026-10-10",
      state: "pending",
      expectedCents: 5000,
      sameAmount: true,
      paid: null,
    });
    expect(different.recurring).toMatchObject({ sameAmount: false, expectedCents: 5000 });
  });

  test("no payment, another currency, an archived payment or two equal ones: no match", async () => {
    await netflix();
    expect((await selectSuggestions(testDb, TODAY))[0].recurring).toBeNull();
    const usd = await recurring({ currency: "USD" });
    expect((await selectSuggestions(testDb, TODAY))[0].recurring).toBeNull();
    await testDb.delete(financeRecurringPayments).where(eq(financeRecurringPayments.id, usd.id));
    const archived = await recurring({ archivedAt: new Date() });
    expect((await selectSuggestions(testDb, TODAY))[0].recurring).toBeNull();
    await testDb
      .delete(financeRecurringPayments)
      .where(eq(financeRecurringPayments.id, archived.id));
    await recurring();
    expect((await selectSuggestions(testDb, TODAY))[0].recurring).not.toBeNull();
    await recurring();
    expect((await selectSuggestions(testDb, TODAY))[0].recurring).toBeNull();
  });

  test("marking it paid: the period's expense with the email's amount, day and method; the merchant is remembered", async () => {
    const bbva = await method("BBVA crédito", "1234");
    const payment = await recurring();
    const row = await netflix({ amountCents: 5400, occurredOn: "2026-10-13" });
    const outcome = await markSuggestionPaid(testDb, row.id, TODAY);
    expect(outcome.kind).toBe("paid");
    const [expense] = await expenseRows();
    expect(expense).toMatchObject({
      description: "Netflix",
      amountCents: 5400,
      spentOn: "2026-10-13",
      paymentMethodId: bbva.id,
      recurringPaymentId: payment.id,
      recurringDueOn: "2026-10-10",
    });
    expect(await settlements()).toEqual([
      expect.objectContaining({ dueOn: "2026-10-10", status: "paid", expenseId: expense.id }),
    ]);
    expect(await suggestionOf(row.id)).toMatchObject({
      status: "registered",
      expenseId: expense.id,
    });
    expect(await aliasesOf(payment.id)).toEqual(["netflix com"]);
  });

  test("a learned merchant is recognized at another amount and under another name", async () => {
    const payment = await recurring({ name: "Streaming", amountCents: 1000 });
    await testDb
      .update(financeRecurringPayments)
      .set({ emailAliases: ["netflix com"] })
      .where(eq(financeRecurringPayments.id, payment.id));
    await netflix({ amountCents: 7777 });
    expect((await selectSuggestions(testDb, TODAY))[0].recurring).toMatchObject({
      id: payment.id,
      sameAmount: false,
    });
  });

  test("twice, or three at once, leaves one expense and one paid period", async () => {
    await recurring();
    const row = await netflix();
    const results = await Promise.all([
      markSuggestionPaid(testDb, row.id, TODAY),
      markSuggestionPaid(testDb, row.id, TODAY),
      markSuggestionPaid(testDb, row.id, TODAY),
    ]);
    expect(results.filter((r) => r.kind === "paid")).toHaveLength(1);
    expect(await expenseRows()).toHaveLength(1);
    expect(await settlements()).toHaveLength(1);
    expect(await markSuggestionPaid(testDb, row.id, TODAY)).toEqual({
      kind: "failed",
      reason: "notPending",
    });
  });

  test("a period already paid by hand is «paid»: nothing is created", async () => {
    const payment = await recurring();
    await payPeriod(testDb, { id: payment.id, dueOn: "2026-10-10" }, TODAY);
    const row = await netflix();
    expect((await selectSuggestions(testDb, TODAY))[0].recurring).toMatchObject({
      state: "paid",
      dueOn: "2026-10-10",
    });
    expect(await markSuggestionPaid(testDb, row.id, TODAY)).toEqual({
      kind: "failed",
      reason: "noMatch",
    });
    expect(await expenseRows()).toHaveLength(1);
  });

  test("no match and an unverified sender are refused", async () => {
    const lonely = await netflix();
    expect(await markSuggestionPaid(testDb, lonely.id, TODAY)).toEqual({
      kind: "failed",
      reason: "noMatch",
    });
    await recurring();
    const unverified = await netflix({ senderVerified: false });
    expect(await markSuggestionPaid(testDb, unverified.id, TODAY)).toEqual({
      kind: "failed",
      reason: "needsReview",
    });
    expect(await expenseRows()).toHaveLength(0);
  });

  test("Deshacer frees the exact period: the expense is gone, the period pending, the suggestion back", async () => {
    const payment = await recurring();
    const row = await netflix();
    const outcome = await markSuggestionPaid(testDb, row.id, TODAY);
    if (outcome.kind !== "paid") throw new Error("not paid");
    expect(
      await undoRegister(testDb, {
        id: row.id,
        expenseId: "00000000-0000-4000-8000-000000000000",
      }),
    ).toBe("changed");
    expect(await settlements()).toHaveLength(1);
    expect(await undoRegister(testDb, { id: row.id, expenseId: outcome.expense.id })).toBe("done");
    expect(await settlements()).toHaveLength(0);
    expect((await expenseRows())[0].deletedAt).not.toBeNull();
    expect(await suggestionOf(row.id)).toMatchObject({ status: "pending", expenseId: null });
    // The period is pending again and the suggestion still looks like that payment.
    expect((await selectSuggestions(testDb, TODAY))[0].recurring).toMatchObject({
      id: payment.id,
      state: "pending",
    });
    // The merchant it learned stays.
    expect(await aliasesOf(payment.id)).toEqual(["netflix com"]);
  });

  test("the last installment archives the payment and Deshacer (with its stamp) reopens it", async () => {
    const payment = await recurring({ installmentsTotal: 1 });
    const row = await netflix();
    const outcome = await markSuggestionPaid(testDb, row.id, TODAY);
    if (outcome.kind !== "paid") throw new Error("not paid");
    expect(outcome.closedStamp).not.toBeNull();
    const archived = () =>
      testDb
        .select({ archivedAt: financeRecurringPayments.archivedAt })
        .from(financeRecurringPayments)
        .where(eq(financeRecurringPayments.id, payment.id));
    expect((await archived())[0].archivedAt).not.toBeNull();
    await undoRegister(testDb, {
      id: row.id,
      expenseId: outcome.expense.id,
      reopenStamp: outcome.closedStamp,
    });
    expect((await archived())[0].archivedAt).toBeNull();
  });

  test("it remembers at most ten merchants, the oldest leaves", async () => {
    const payment = await recurring({ name: "Streaming", amountCents: null });
    await testDb
      .update(financeRecurringPayments)
      .set({ emailAliases: Array.from({ length: 10 }, (_, i) => `viejo ${i}`) })
      .where(eq(financeRecurringPayments.id, payment.id));
    // The merchant has to match by alias or name to be paid: the name's word is in it.
    const row = await suggest({
      merchant: "STREAMING NUEVO",
      amountCents: 100,
      occurredOn: "2026-10-13",
    });
    await markSuggestionPaid(testDb, row.id, TODAY);
    const aliases = await aliasesOf(payment.id);
    expect(aliases).toHaveLength(10);
    expect(aliases.at(-1)).toBe("streaming nuevo");
    expect(aliases).not.toContain("viejo 0");
  });

  test("a payment's CHECK holds at most ten aliases", async () => {
    const payment = await recurring();
    let code: string | undefined;
    try {
      await testDb
        .update(financeRecurringPayments)
        .set({ emailAliases: Array.from({ length: 11 }, (_, i) => `a${i}`) })
        .where(eq(financeRecurringPayments.id, payment.id));
    } catch (error) {
      code = (error as { cause?: { code?: string } }).cause?.code;
    }
    expect(code).toBe("23514");
  });

  describe("a period already paid with another amount: correcting it", () => {
    /** Netflix paid by hand with S/ 50.00; the bank charged S/ 54.00. */
    async function setup(over: Partial<NewFinanceEmailSuggestion> = {}) {
      const payment = await recurring();
      const paid = await payPeriod(testDb, { id: payment.id, dueOn: "2026-10-10" }, TODAY);
      if (typeof paid === "string") throw new Error(paid);
      const row = await netflix({ amountCents: 5400, ...over });
      return { payment, expenseId: paid.expense.id, row };
    }

    test("the list tells what was paid with and that it differs", async () => {
      const { expenseId } = await setup();
      expect((await selectSuggestions(testDb, TODAY))[0].recurring).toMatchObject({
        state: "paid",
        sameAmount: false,
        paid: { expenseId, amountCents: 5000 },
      });
    });

    test("the expense takes the charged amount, the suggestion is decided, the period stays paid", async () => {
      const { expenseId, row } = await setup();
      const outcome = await correctPaidAmount(testDb, row.id, TODAY);
      expect(outcome).toMatchObject({ kind: "corrected", previousCents: 5000 });
      const [expense] = await expenseRows();
      expect(expense).toMatchObject({ id: expenseId, amountCents: 5400, deletedAt: null });
      expect(await settlements()).toHaveLength(1);
      expect(await suggestionOf(row.id)).toMatchObject({ status: "dismissed" });
      expect(await expenseRows()).toHaveLength(1);
    });

    test("Deshacer puts the amount back and the suggestion returns; an expense edited meanwhile is left alone", async () => {
      const { expenseId, row } = await setup();
      await correctPaidAmount(testDb, row.id, TODAY);
      expect(await undoCorrection(testDb, { id: row.id, expenseId, previousCents: 5000 })).toBe(
        "done",
      );
      expect((await expenseRows())[0].amountCents).toBe(5000);
      expect(await suggestionOf(row.id)).toMatchObject({ status: "pending", decidedAt: null });
      // Corrected again, then the owner edits the expense: the old undo must not touch it.
      await correctPaidAmount(testDb, row.id, TODAY);
      await testDb.update(financeExpenses).set({ amountCents: 9999 });
      expect(await undoCorrection(testDb, { id: row.id, expenseId, previousCents: 5000 })).toBe(
        "changed",
      );
      expect((await expenseRows())[0].amountCents).toBe(9999);
    });

    test("same amount, a pending period, no match or an unverified sender: nothing to correct", async () => {
      const payment = await recurring();
      const lonely = await netflix({ amountCents: 5400 });
      // Pending period: that is «Marcar como pagado», not a correction.
      expect(await correctPaidAmount(testDb, lonely.id, TODAY)).toEqual({
        kind: "failed",
        reason: "noMatch",
      });
      await payPeriod(testDb, { id: payment.id, dueOn: "2026-10-10" }, TODAY);
      const same = await netflix({ amountCents: 5000 });
      expect(await correctPaidAmount(testDb, same.id, TODAY)).toEqual({
        kind: "failed",
        reason: "noMatch",
      });
      const unverified = await netflix({ amountCents: 5400, senderVerified: false });
      expect(await correctPaidAmount(testDb, unverified.id, TODAY)).toEqual({
        kind: "failed",
        reason: "needsReview",
      });
      expect((await expenseRows())[0].amountCents).toBe(5000);
    });

    test("three at once correct once", async () => {
      const { row } = await setup();
      const results = await Promise.all([
        correctPaidAmount(testDb, row.id, TODAY),
        correctPaidAmount(testDb, row.id, TODAY),
        correctPaidAmount(testDb, row.id, TODAY),
      ]);
      expect(results.filter((r) => r.kind === "corrected")).toHaveLength(1);
      expect((await expenseRows())[0].amountCents).toBe(5400);
    });

    test("a USD expense takes the current rate when its amount changes (the rule of editing)", async () => {
      await testDb.insert(financeSettings).values({ id: 1, usdToPen: "3.7500" });
      const payment = await recurring({ name: "Paramount+", currency: "USD", amountCents: 600 });
      await payPeriod(testDb, { id: payment.id, dueOn: "2026-10-10" }, TODAY);
      const row = await suggest({
        merchant: "PARAMOUNT+",
        currency: "USD",
        amountCents: 646,
        occurredOn: "2026-10-13",
      });
      expect((await correctPaidAmount(testDb, row.id, TODAY)).kind).toBe("corrected");
      expect((await expenseRows())[0]).toMatchObject({ amountCents: 646, currency: "USD" });
    });
  });
});
