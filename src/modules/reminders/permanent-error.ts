// Is a database failure one that retrying can never fix? The webhook answers 500 to the failures
// that might pass (Telegram retries, the claim having rolled back), but a "poison" update, one
// whose handling always fails the same way, would be retried for hours. Postgres classes 22 (data
// exception: a NUL byte in text, a value out of range) and 23 (integrity violation) are about the
// data, not about the moment; connection, serialization and deadlock errors are not (08, 40, 53...).
// Pure: reads only the SQLSTATE `code` down the `cause` chain (Drizzle wraps the driver's error).

const MAX_DEPTH = 5;

export function isPermanentDbError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth <= MAX_DEPTH && current && typeof current === "object"; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^(22|23)[0-9A-Z]{3}$/.test(code)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
