// @vitest-environment node
// E1 of `finance-email`: the ingest endpoint against Postgres (idempotence by Gmail id with a positive
// control, two overlapping batches) and the CHECKs of the new table and columns with raw inserts.
import { eq } from "drizzle-orm";
import { describe, expect, test, vi } from "vitest";
import { POST } from "@/app/api/finance/email-ingest/route";
import {
  financeEmailSuggestions,
  financeExpenses,
  financePaymentMethods,
  financeSettings,
} from "@/modules/finance/db/schema";
import { testDb } from "./test-db";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: () => testDb,
}));

const SECRET = "integration-secret-0123456789-abcdefghij";
process.env.FINANCE_EMAIL_SECRET = SECRET;

const BBVA_TEXT = `Comercio: TIENDA DEMO SAC | Monto: 43.20 | Moneda: PEN | Fecha: 11/10/2026 | Hora: 14:52:43
Este se cargará a tu tarjeta terminada en *1234`;

const bbva = (id: string, text = BBVA_TEXT) => ({
  id,
  from: "procesos@bbva.com.pe",
  subject: "Has realizado un consumo con tu tarjeta BBVA",
  receivedAt: "2026-10-11T19:52:46Z",
  text,
  auth: "pass",
});

const post = (messages: unknown[], headers: Record<string, string> = {}) =>
  POST(
    new Request("https://os.example.test/api/finance/email-ingest", {
      method: "POST",
      body: JSON.stringify({ messages }),
      headers: { authorization: `Bearer ${SECRET}`, ...headers },
    }),
  );

const rows = () => testDb.select().from(financeEmailSuggestions);

async function violation(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    const cause = (error as { cause?: { code?: string; constraint?: string } }).cause;
    return { code: cause?.code, constraint: cause?.constraint };
  }
  return null;
}

describe("POST /api/finance/email-ingest", () => {
  test("creates one pending suggestion with what the parser read (and nothing of the body)", async () => {
    const response = await post([bbva("abc12345def67890")]);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ received: 1, created: 1, duplicates: 0 });
    const [row] = await rows();
    expect(row).toMatchObject({
      gmailMessageId: "abc12345def67890",
      source: "bbva",
      kind: "card",
      status: "pending",
      amountCents: 4320,
      currency: "PEN",
      merchant: "TIENDA DEMO SAC",
      occurredOn: "2026-10-11",
      cardLast4: "1234",
      senderVerified: true,
      expenseId: null,
    });
    expect(JSON.stringify(row)).not.toContain("Este se cargará");
  });

  test("the same message three times leaves one row; a different id leaves another (positive control)", async () => {
    for (let i = 0; i < 3; i += 1) await post([bbva("abc12345def67890")]);
    expect(await rows()).toHaveLength(1);
    const response = await post([bbva("abc12345def67891")]);
    expect(await response.json()).toMatchObject({ created: 1 });
    expect(await rows()).toHaveLength(2);
  });

  test("two batches at once with the same ids do not duplicate (and do not fail)", async () => {
    const batch = [bbva("abc12345def67890"), bbva("abc12345def67891")];
    const responses = await Promise.all([post(batch), post(batch), post(batch)]);
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(await rows()).toHaveLength(2);
  });

  test("a re-sent message does not change what was already decided", async () => {
    await post([bbva("abc12345def67890")]);
    await testDb
      .update(financeEmailSuggestions)
      .set({ status: "dismissed", decidedAt: new Date() });
    await post([bbva("abc12345def67890", BBVA_TEXT.replace("43.20", "99.00"))]);
    const [row] = await rows();
    expect(row).toMatchObject({ status: "dismissed", amountCents: 4320 });
  });

  test("a known format that cannot be read is stored as «unreadable»", async () => {
    const response = await post([bbva("abc12345def67890", "nothing useful here")]);
    expect(await response.json()).toMatchObject({ created: 0, unreadable: 1 });
    const [row] = await rows();
    expect(row).toMatchObject({ status: "unreadable", amountCents: null, merchant: null });
  });

  test("unknown and ignored mail is not stored", async () => {
    await post([
      { ...bbva("abc12345def67890"), from: "promo@else.test" },
      { ...bbva("abc12345def67891"), subject: "BBVA - Constancia Pago de Tarjetas propias" },
    ]);
    expect(await rows()).toHaveLength(0);
  });

  test("a re-sent unreadable email that now reads becomes the suggestion (once)", async () => {
    await post([bbva("abc12345def67890", "nothing useful here")]);
    expect((await rows())[0].status).toBe("unreadable");
    const again = await post([bbva("abc12345def67890")]);
    expect(await again.json()).toMatchObject({ created: 0, reread: 1, duplicates: 0 });
    expect((await rows())[0]).toMatchObject({ status: "pending", amountCents: 4320 });
    // Read now: a third send changes nothing.
    const third = await post([bbva("abc12345def67890")]);
    expect(await third.json()).toMatchObject({ reread: 0, duplicates: 1 });
  });

  test("a decided row is never re-read, even when it was unreadable", async () => {
    await post([bbva("abc12345def67890", "nothing useful here")]);
    await testDb
      .update(financeEmailSuggestions)
      .set({ status: "dismissed", decidedAt: new Date() });
    await post([bbva("abc12345def67890")]);
    expect((await rows())[0]).toMatchObject({ status: "dismissed", amountCents: null });
  });

  describe("transfers and «Mis nombres»", () => {
    const plin = (id: string, to: string) => ({
      id,
      from: "procesos@bbva.com.pe",
      subject: "Constancia de operación transferencia PLIN",
      receivedAt: "2026-10-14T07:04:23Z",
      text: `| Plineaste S/ 10.00 a ${to} | |\n| Fecha y hora: | 14 de octubre, 2026 02:04 |`,
      auth: "pass",
    });

    test("without names set, a Plin to anyone is a suggestion (positive control)", async () => {
      await post([plin("abc12345def67890", "Jhorman J Bravo H")]);
      expect(await rows()).toHaveLength(1);
    });

    test("with the owner's name set, a Plin to their own account is ignored; others are not", async () => {
      await testDb
        .insert(financeSettings)
        .values({ id: 1, ownNames: ["Jhorman Josue Bravo Huaman"] });
      const response = await post([
        plin("abc12345def67890", "Jhorman J Bravo H"),
        plin("abc12345def67891", "Maria Perez Quispe"),
      ]);
      expect(await response.json()).toMatchObject({ created: 1, ignored: 1 });
      const [row] = await rows();
      expect(row).toMatchObject({ merchant: "Maria Perez Quispe", kind: "transfer" });
    });
  });

  test("a wrong secret is a bare 404 and writes nothing", async () => {
    const response = await post([bbva("abc12345def67890")], { authorization: "Bearer nope" });
    expect(response.status).toBe(404);
    expect(await rows()).toHaveLength(0);
  });

  test("an unverified sender is kept as such", async () => {
    await post([{ ...bbva("abc12345def67890"), auth: "fail" }]);
    expect((await rows())[0].senderVerified).toBe(false);
  });
});

describe("CHECKs (defense behind Zod)", () => {
  const valid = {
    gmailMessageId: "abc12345def67890",
    source: "bbva",
    subject: "Has realizado un consumo",
    status: "pending",
    kind: "card",
    amountCents: 1000,
    currency: "PEN",
    merchant: "Tienda",
    occurredOn: "2026-10-11",
  } as const;
  const insert = (over: Record<string, unknown>) =>
    violation(() => testDb.insert(financeEmailSuggestions).values({ ...valid, ...over } as never));
  const check = (constraint: string) => ({ code: "23514", constraint });

  test("a valid row passes (positive control)", async () => {
    expect(await insert({})).toBeNull();
  });

  test.each([
    ["source", { source: "scotiabank" }, "finance_email_suggestions_source_check"],
    ["kind", { kind: "other" }, "finance_email_suggestions_kind_check"],
    ["status", { status: "done" }, "finance_email_suggestions_status_check"],
    ["amount (zero)", { amountCents: 0 }, "finance_email_suggestions_amount_check"],
    ["amount (too big)", { amountCents: 100_000_001 }, "finance_email_suggestions_amount_check"],
    ["currency", { currency: "EUR" }, "finance_email_suggestions_currency_check"],
    ["merchant too long", { merchant: "x".repeat(81) }, "finance_email_suggestions_text_check"],
    ["empty merchant", { merchant: "" }, "finance_email_suggestions_text_check"],
    ["subject too long", { subject: "x".repeat(121) }, "finance_email_suggestions_text_check"],
    ["card digits", { cardLast4: "12a4" }, "finance_email_suggestions_text_check"],
    [
      "a pending row without an amount",
      { amountCents: null },
      "finance_email_suggestions_reading_check",
    ],
    [
      "a pending row without a day",
      { occurredOn: null },
      "finance_email_suggestions_reading_check",
    ],
  ])("rejects %s", async (_label, over, constraint) => {
    expect(await insert(over)).toEqual(check(constraint));
  });

  test("an unreadable row, dismissed, still needs none of the reading fields", async () => {
    expect(
      await insert({
        status: "dismissed",
        kind: null,
        amountCents: null,
        currency: null,
        merchant: null,
        occurredOn: null,
      }),
    ).toBeNull();
    // …but a pending one does (positive control of the rule above).
    expect(await insert({ gmailMessageId: "abc12345def67899", amountCents: null })).toEqual(
      check("finance_email_suggestions_reading_check"),
    );
  });

  test("an unreadable row needs none of the reading fields", async () => {
    expect(
      await insert({
        status: "unreadable",
        kind: null,
        amountCents: null,
        currency: null,
        merchant: null,
        occurredOn: null,
      }),
    ).toBeNull();
  });

  test("a registered row points at its expense, any other never does", async () => {
    const [expense] = await testDb
      .insert(financeExpenses)
      .values({ amountCents: 1000, currency: "PEN", spentOn: "2026-10-11" })
      .returning();
    expect(await insert({ status: "registered" })).toEqual(
      check("finance_email_suggestions_expense_check"),
    );
    expect(await insert({ status: "pending", expenseId: expense.id })).toEqual(
      check("finance_email_suggestions_expense_check"),
    );
    expect(await insert({ status: "registered", expenseId: expense.id })).toBeNull();
    // RESTRICT (23001): an expense that a suggestion points at cannot be hard-deleted.
    expect(
      await violation(() =>
        testDb.delete(financeExpenses).where(eq(financeExpenses.id, expense.id)),
      ),
    ).toMatchObject({ code: "23001" });
  });

  test("the Gmail id is unique", async () => {
    await insert({});
    expect(await insert({})).toEqual({
      code: "23505",
      constraint: "finance_email_suggestions_message_unique",
    });
  });
});

describe("the new columns", () => {
  test("last4 of a payment method: four digits or nothing", async () => {
    const method = (last4: string | null, name: string) =>
      violation(() => testDb.insert(financePaymentMethods).values({ name, sortOrder: 0, last4 }));
    expect(await method("6392", "BCP crédito")).toBeNull();
    expect(await method(null, "Efectivo")).toBeNull();
    expect(await method("639", "Corta")).toEqual({
      code: "23514",
      constraint: "finance_payment_methods_last4_check",
    });
    expect(await method("63a2", "Letra")).toEqual({
      code: "23514",
      constraint: "finance_payment_methods_last4_check",
    });
  });

  test("own names: up to 10, empty by default", async () => {
    await testDb.insert(financeSettings).values({ id: 1 });
    const [row] = await testDb.select().from(financeSettings);
    expect(row.ownNames).toEqual([]);
    const set = (names: string[]) =>
      violation(() => testDb.update(financeSettings).set({ ownNames: names }));
    expect(await set(Array.from({ length: 10 }, (_, i) => `Nombre ${i}`))).toBeNull();
    expect(await set(Array.from({ length: 11 }, (_, i) => `Nombre ${i}`))).toEqual({
      code: "23514",
      constraint: "finance_settings_own_names_check",
    });
  });
});
