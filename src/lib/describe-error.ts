// Pure (no server-only): the Server Actions' logs and the owner scripts (`db:demo`) share it.

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
