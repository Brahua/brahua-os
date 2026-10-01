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
      // Structured, one line, for Vercel Logs. No input values: they may be personal data.
      console.error(
        JSON.stringify({
          level: "error",
          event: "server_action_failed",
          action: name,
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        }),
      );
      return fail(UNEXPECTED_ERROR_MESSAGE);
    }
  };
}
