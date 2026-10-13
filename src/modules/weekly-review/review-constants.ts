// Plain constants of `weekly-review` shared by the Zod schemas (client and server) and the
// database CHECK constraints (SPEC-weekly-review "Modelo de datos"). No server code.

/** The note of a closed week: 1–280 characters, plain text. */
export const REVIEW_NOTE_MAX_LENGTH = 280;
