import { DrizzleQueryError } from "drizzle-orm/errors";
import { redirect } from "next/navigation";
import { beforeEach, expect, test, vi } from "vitest";
import { z } from "zod";
import {
  INVALID_FIELDS_MESSAGE,
  ok,
  UNAUTHORIZED_MESSAGE,
  UNEXPECTED_ERROR_MESSAGE,
} from "@/lib/action-result";
import { getOwnerSession } from "@/lib/auth";
import { describeError, ownerAction } from "@/lib/owner-action";

vi.mock("@/lib/auth", () => ({ getOwnerSession: vi.fn() }));

const schema = z.object({ title: z.string().min(1, "Obligatorio") });
const SESSION = { user: { id: "owner" } };

beforeEach(() => {
  vi.mocked(getOwnerSession)
    .mockReset()
    .mockResolvedValue(SESSION as never);
});

test("runs the handler with the parsed data and the session", async () => {
  const handler = vi.fn(async (data: { title: string }) => ok(data.title.toUpperCase()));
  const action = ownerAction(schema, handler, { name: "test" });

  expect(await action({ title: "hola", extra: 1 })).toEqual({ ok: true, data: "HOLA" });
  expect(handler).toHaveBeenCalledWith({ title: "hola" }, SESSION);
});

test("without an owner session: authorization error, input never parsed", async () => {
  vi.mocked(getOwnerSession).mockResolvedValue(null);
  const parse = vi.spyOn(schema, "safeParse");
  const handler = vi.fn();
  const action = ownerAction(schema, handler, { name: "test" });

  expect(await action({ title: "" })).toEqual({ ok: false, error: UNAUTHORIZED_MESSAGE });
  expect(parse).not.toHaveBeenCalled();
  expect(handler).not.toHaveBeenCalled();
});

test("invalid input: field errors, handler not called", async () => {
  const handler = vi.fn();
  const action = ownerAction(schema, handler, { name: "test" });
  expect(await action({ title: "" })).toEqual({
    ok: false,
    error: INVALID_FIELDS_MESSAGE,
    fieldErrors: { title: ["Obligatorio"] },
  });
  expect(handler).not.toHaveBeenCalled();
});

test("an unexpected error is logged on the server and returned as a generic failure", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const action = ownerAction(
    schema,
    async () => {
      throw new Error("connection refused at 10.0.0.1");
    },
    { name: "createThing" },
  );

  expect(await action({ title: "x" })).toEqual({ ok: false, error: UNEXPECTED_ERROR_MESSAGE });
  expect(log).toHaveBeenCalledTimes(1);
  // Only the error's name: its message could hold input values.
  expect(JSON.parse(log.mock.calls[0][0] as string)).toEqual({
    level: "error",
    event: "server_action_failed",
    action: "createThing",
    error: "Error",
  });
});

test("a database error logs the root cause's code and constraint, never the query params", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const pgError = Object.assign(
    new Error('new row for relation "core_life_areas" violates check constraint "x_check"'),
    {
      code: "23514",
      constraint: "x_check",
      detail: "Failing row contains (…, Secreto, …).",
    },
  );
  const action = ownerAction(
    schema,
    async () => {
      throw new DrizzleQueryError(
        'insert into "core_life_areas" ("name") values ($1)',
        ["Secreto"],
        pgError,
      );
    },
    { name: "createLifeArea" },
  );

  expect(await action({ title: "x" })).toEqual({ ok: false, error: UNEXPECTED_ERROR_MESSAGE });
  const line = log.mock.calls[0][0] as string;
  expect(line).not.toContain("Secreto");
  expect(line).not.toContain("Failing row");
  expect(JSON.parse(line)).toEqual({
    level: "error",
    event: "server_action_failed",
    action: "createLifeArea",
    error: "DrizzleQueryError",
    cause: {
      code: "23514",
      constraint: "x_check",
      message: 'new row for relation "core_life_areas" violates check constraint "x_check"',
    },
  });
});

test("describeError stops on a cyclic cause chain", () => {
  const a: Error & { cause?: unknown } = new Error("a");
  const b: Error & { cause?: unknown } = new Error("b");
  a.cause = b;
  b.cause = a;
  expect(describeError(a).error).toBe("Error");
  expect(describeError("boom")).toEqual({ error: "string" });
});

test("a failing session lookup is also a generic failure", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(getOwnerSession).mockRejectedValue(new Error("db down"));
  const action = ownerAction(schema, vi.fn(), { name: "test" });
  expect(await action({ title: "x" })).toEqual({ ok: false, error: UNEXPECTED_ERROR_MESSAGE });
});

test("Next's redirect signal is rethrown, not swallowed", async () => {
  const action = ownerAction(
    schema,
    async () => {
      redirect("/login");
    },
    { name: "test" },
  );
  await expect(action({ title: "x" })).rejects.toMatchObject({
    digest: expect.stringMatching(/^NEXT_REDIRECT/),
  });
});
