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
  type NewFinanceEmailSuggestion,
} from "@/modules/finance/db/schema";
import {
  dismissSuggestion,
  registerSuggestion,
  selectSuggestions,
  undoDismiss,
  undoRegister,
} from "@/modules/finance/email/suggestions";
import { selectEmailSettings, setMethodLast4, setOwnNames } from "@/modules/finance/email/settings";
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
    const list = await selectSuggestions(testDb);
    expect(list.map((item) => item.id)).toEqual([unreadable.id, first.id]);
    expect(list[0]).toMatchObject({ status: "unreadable", amountCents: null });
  });

  test("the method hint needs exactly one method with those digits", async () => {
    const bbva = await method("BBVA crédito", "1234");
    await suggest();
    expect((await selectSuggestions(testDb))[0].method).toEqual({
      id: bbva.id,
      name: "BBVA crédito",
    });
    // A second method with the same digits makes it ambiguous: no hint (positive control above).
    await method("Otra", "1234");
    expect((await selectSuggestions(testDb))[0].method).toBeNull();
  });

  test("an archived method is no hint", async () => {
    await method("Vieja", "1234", { archivedAt: new Date() });
    await suggest();
    expect((await selectSuggestions(testDb))[0].method).toBeNull();
  });

  test("a visible expense of the same amount, currency and day flags a possible duplicate", async () => {
    await suggest();
    expect((await selectSuggestions(testDb))[0].duplicate).toBe(false);
    const base = { amountCents: 4320, currency: "PEN", spentOn: "2026-10-11" } as const;
    // Other day, other amount, other currency, deleted: none of them counts.
    await testDb.insert(financeExpenses).values([
      { ...base, spentOn: "2026-10-12" },
      { ...base, amountCents: 4321 },
      { ...base, currency: "USD" },
      { ...base, deletedAt: new Date() },
    ]);
    expect((await selectSuggestions(testDb))[0].duplicate).toBe(false);
    await testDb.insert(financeExpenses).values(base);
    expect((await selectSuggestions(testDb))[0].duplicate).toBe(true);
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
