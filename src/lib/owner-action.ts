// The shape every Server Action follows (SPEC-core "Estilo de código"): owner check, Zod,
// ActionResult, and no stack traces for the client. A module's actions.ts wraps its handlers:
//
//   const create = ownerAction(schema, async (data) => ok(await insert(getDb(), data)), { name: "x" });
//   export async function createX(input: unknown) { return create(input); }
//
// (A "use server" file may only export async functions, hence the one-line wrapper.)
import "server-only";
import { unstable_rethrow } from "next/navigation";
import type { z } from "zod";
import { fail, unauthorized, UNEXPECTED_ERROR_MESSAGE, type ActionResult } from "./action-result";
import { getOwnerSession, type OwnerSession } from "./auth";

type OwnerActionOptions = {
  /** Shows up in the server log when the handler fails unexpectedly. */
  name: string;
};

/**
 * Builds a Server Action body that:
 * 1. Checks the owner session first. Without it (no session, a forged cookie, another email)
 *    it returns the authorization error without looking at the input, so nothing about the
 *    expected fields leaks.
 * 2. Validates `input` (untrusted: any POST can call an action) with `schema`; failures become
 *    per-field errors.
 * 3. Runs `handler` with the parsed data. Anything it throws (other than Next's own redirect or
 *    notFound signals) is logged on the server and returned as a generic failure.
 */
export function ownerAction<Schema extends z.ZodType, T>(
  schema: Schema,
  handler: (data: z.output<Schema>, session: OwnerSession) => Promise<ActionResult<T>>,
  { name }: OwnerActionOptions,
): (input: unknown) => Promise<ActionResult<T>> {
  return async (input) => {
    try {
      const session = await getOwnerSession();
      if (!session) return unauthorized();
      const parsed = schema.safeParse(input);
      if (!parsed.success) return fail(parsed.error);
      return await handler(parsed.data, session);
    } catch (error) {
      unstable_rethrow(error);
      // Structured, one line, for Vercel Logs.
      console.error(
        JSON.stringify({
          level: "error",
          event: "server_action_failed",
          action: name,
          ...describeError(error),
        }),
      );
      return fail(UNEXPECTED_ERROR_MESSAGE);
    }
  };
}

/** How deep to follow `cause` (a cyclic or absurdly deep chain must not loop forever). */
const MAX_CAUSE_DEPTH = 5;

/**
 * What the log may say about an error: never input values, which may be personal data. So no
 * message text at all: not from the wrapper errors (Drizzle's "Failed query: … params: …"
 * contains the values) and not from the root cause either (some Postgres messages quote the
 * input, e.g. `invalid input syntax for type uuid: "…"`; `detail` holds values too). Only the
 * error's name plus the root cause's `code` and `constraint`.
 */
export function describeError(error: unknown): {
  error: string;
  cause?: { code?: string; constraint?: string };
} {
  // Some subclasses (e.g. DrizzleQueryError) keep the default name "Error": use the class name.
  const name =
    error instanceof Error
      ? error.name !== "Error"
        ? error.name
        : error.constructor.name || error.name
      : typeof error;
  let root: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    const next = (root as { cause?: unknown } | null)?.cause;
    if (!next || typeof next !== "object") break;
    root = next;
  }
  if (root === error || !root || typeof root !== "object") return { error: name };
  const { code, constraint } = root as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" ? value : undefined);
  return { error: name, cause: { code: text(code), constraint: text(constraint) } };
}
