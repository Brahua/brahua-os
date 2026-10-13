// Plain constants of `weekly-review` shared by the Zod schemas (client and server) and the
// database CHECK constraints (SPEC-weekly-review "Modelo de datos"). No server code.

/** The note of a closed week: 1–280 characters, plain text. */
export const REVIEW_NOTE_MAX_LENGTH = 280;

/**
 * The objective of the next week: 1–140 characters. It is `goals`' own limit (the objective lives
 * in its store and `goals` validates it again), repeated here only so the form can say it without
 * a round trip.
 */
export const REVIEW_OBJECTIVE_MAX_LENGTH = 140;
