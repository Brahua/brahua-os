// The keys of the advisory locks of `finance` (catalog.ts documents the rules). Plain constants,
// no server-only: scripts (the Notion import of F5) take the same locks without importing server
// code.

/** First key of every advisory lock `finance` takes (its namespace among the app's locks). */
export const FINANCE_ADVISORY_SPACE = 5_000;

/** Second key of the categories lock (create, rename, reorder, archive, reactivate). */
export const FINANCE_CATEGORIES_KEY = "finance:categories";

/** Second key of the payment methods lock (create, edit, reorder, archive, reactivate). */
export const FINANCE_METHODS_KEY = "finance:methods";

// F2: one recurring payment's lock is `(5000, hashtext(<recurring id>))` (pay, skip, undo and
// editing its cycle).
