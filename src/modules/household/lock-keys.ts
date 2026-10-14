// The keys of the advisory locks of `household`. Plain constants, no server-only: scripts and
// tests take the same locks without importing server code.

/** First key of every advisory lock `household` takes (its namespace among the app's locks). */
export const HOUSEHOLD_ADVISORY_SPACE = 7_000;

/**
 * Second key of a product name's lock: `(7000, hashtext(<name_key>))`, the FIRST lock of the
 * transaction that adds or restores a product (CLAUDE.md "Advisory locks": two keys, never after a
 * row lock). Two adds of the same name wait for each other and end with one row; different names
 * never wait. The partial unique index on `name_key` is the safety net.
 */
export const productLockKey = (nameKey: string) => nameKey;
