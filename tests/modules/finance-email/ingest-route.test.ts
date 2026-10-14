// @vitest-environment node
// E1 of `finance-email`: the endpoint answers BEFORE touching the database when the caller is not
// the owner's script, when the body is too big or not JSON, or has the wrong shape. The database
// stub throws on any use, so "never reached" is proven, not assumed.
import { describe, expect, test, vi } from "vitest";
import type { Database } from "@/lib/db";
import { handleEmailIngest } from "@/modules/finance/email/ingest";
import { MAX_INGEST_BODY_BYTES } from "@/modules/finance/email/constants";

vi.mock("server-only", () => ({}));

const SECRET = "test-secret-0123456789-0123456789-abcdef";
const env: Record<string, string | undefined> = { FINANCE_EMAIL_SECRET: SECRET };
const db = new Proxy(
  {},
  {
    get() {
      throw new Error("the database must not be touched");
    },
  },
) as unknown as Database;

const message = {
  id: "abc12345def67890",
  from: "procesos@bbva.com.pe",
  subject: "Has realizado un consumo con tu tarjeta BBVA",
  receivedAt: "2026-10-11T19:52:46Z",
  text: "x",
  auth: "pass",
};

const call = (body: BodyInit | null, headers: Record<string, string> = {}, e = env) =>
  handleEmailIngest(
    new Request("https://os.example.test/api/finance/email-ingest", {
      method: "POST",
      body,
      headers,
    }),
    { db, env: e },
  );
const bearer = { authorization: `Bearer ${SECRET}` };

describe("authentication comes first", () => {
  test.each([
    ["no header", {}],
    ["a wrong secret", { authorization: "Bearer not-the-secret-not-the-secret-12345678" }],
    ["a different scheme", { authorization: `Basic ${SECRET}` }],
    ["the secret without Bearer", { authorization: SECRET }],
  ])("%s → bare 404 and no body read", async (_label, headers) => {
    const response = await call(JSON.stringify({ messages: [message] }), headers);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });

  test("other methods get the same bare 404", async () => {
    const { GET, HEAD, PUT, PATCH, DELETE } = await import("@/app/api/finance/email-ingest/route");
    for (const handler of [GET, HEAD, PUT, PATCH, DELETE]) {
      const response = handler();
      expect(response.status).toBe(404);
    }
  });

  test("a weak secret (few distinct characters) is not accepted", async () => {
    const weak = "a".repeat(40);
    expect(
      (await call("{}", { authorization: `Bearer ${weak}` }, { FINANCE_EMAIL_SECRET: weak }))
        .status,
    ).toBe(404);
  });

  test("a server without the secret (or with a short one) authorizes nobody", async () => {
    expect((await call("{}", bearer, {})).status).toBe(404);
    expect((await call("{}", bearer, { FINANCE_EMAIL_SECRET: "short" })).status).toBe(404);
  });
});

describe("then size, JSON and shape", () => {
  test("a body over the limit is 413 (declared or streamed)", async () => {
    const big = "x".repeat(MAX_INGEST_BODY_BYTES + 1);
    expect((await call(big, bearer)).status).toBe(413);
    expect(
      (await call(big, { ...bearer, "content-length": String(MAX_INGEST_BODY_BYTES + 1) })).status,
    ).toBe(413);
  });

  test("not JSON is 400", async () => {
    expect((await call("{nope", bearer)).status).toBe(400);
  });

  test.each([
    ["no messages", { messages: [] }],
    ["more than 10", { messages: Array.from({ length: 11 }, () => message) }],
    ["a NUL in the text", { messages: [{ ...message, text: "a\u0000b" }] }],
    ["a NUL in the subject", { messages: [{ ...message, subject: "a\u0000b" }] }],
    ["a bad Gmail id", { messages: [{ ...message, id: "../etc/passwd" }] }],
    ["a text over 8 KB", { messages: [{ ...message, text: "x".repeat(8 * 1024 + 1) }] }],
    ["a bad date", { messages: [{ ...message, receivedAt: "yesterday" }] }],
    ["extra shape", { nope: true }],
  ])("%s is 400", async (_label, body) => {
    expect((await call(JSON.stringify(body), bearer)).status).toBe(400);
  });

  test("a batch with only unknown or ignored mail never reaches the database", async () => {
    const response = await call(
      JSON.stringify({
        messages: [
          { ...message, from: "someone@else.test" },
          {
            ...message,
            id: "abc12345def67891",
            subject: "BBVA - Constancia Pago de Tarjetas propias",
          },
        ],
      }),
      bearer,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ created: 0, unknown: 1, ignored: 1 });
  });
});

describe("a row the database refuses", () => {
  const stub = (failures: unknown[]) => {
    const queue = [...failures];
    return {
      insert: () => ({
        values: () => ({
          onConflictDoUpdate: () => ({
            returning: async () => {
              const next = queue.shift();
              if (next) throw next;
              return [{ id: "row", isNew: true }];
            },
          }),
        }),
      }),
    } as unknown as Database;
  };
  const bbvaMessage = (id: string) => ({
    ...message,
    id,
    text: "Comercio: TIENDA | Monto: 10.00 | Moneda: PEN | Fecha: 11/10/2026 | Hora: 1",
  });
  const run = (database: Database, ids: string[]) =>
    handleEmailIngest(
      new Request("https://os.example.test/x", {
        method: "POST",
        body: JSON.stringify({ messages: ids.map(bbvaMessage) }),
        headers: bearer,
      }),
      { db: database, env },
    );
  const pgError = (code: string) => Object.assign(new Error("failed"), { cause: { code } });

  test("for good (SQLSTATE 22/23) it is skipped and the rest of the batch goes in", async () => {
    const response = await run(stub([pgError("22021")]), ["abc12345def67890", "abc12345def67891"]);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ created: 1, rejected: 1 });
  });

  test("a transient error (connection, timeout) is a 500 so the script retries", async () => {
    const response = await run(stub([pgError("57P01")]), ["abc12345def67890"]);
    expect(response.status).toBe(500);
  });
});
