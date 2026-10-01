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
import { ownerAction } from "@/lib/owner-action";

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
  expect(JSON.parse(log.mock.calls[0][0] as string)).toEqual({
    level: "error",
    event: "server_action_failed",
    action: "createThing",
    error: "Error: connection refused at 10.0.0.1",
  });
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
