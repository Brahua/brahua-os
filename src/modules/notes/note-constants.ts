// Limits and fixed values of `notes` (SPEC-notes "Modelo de datos", "Supuestos"). Client-safe:
// forms, Zod and the table's CHECKs read the same numbers.

/** `daily`: one per Lima day, without a title. `page`: a knowledge note with a title. */
export const NOTE_KINDS = ["daily", "page"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

/** A note's body (Markdown): a long diary entry fits (projects allow 20 000). */
export const NOTE_BODY_MAX_LENGTH = 50_000;
/** From this many characters on, the editor shows how many are used. */
export const NOTE_BODY_COUNTER_FROM = NOTE_BODY_MAX_LENGTH - 5_000;
/** A knowledge note's title, normalized like names. */
export const NOTE_TITLE_MAX_LENGTH = 120;

/** The first and last day a daily note may have (the CHECK; Zod also refuses future days). */
export const NOTE_DAY_MIN = "2000-01-01";
export const NOTE_DAY_MAX = "2100-12-31";

/** The list shows this many notes, and «Ver más» adds as many again. */
export const NOTES_PAGE_SIZE = 30;
/** The most notes the list shows at once (`?n=`), so a hand-written URL can't ask for millions. */
export const NOTES_MAX_SHOWN = 3_000;

/** The `[[` picker shows at most this many results, across every type (SPEC-notes). */
export const NOTE_LINK_RESULTS_MAX = 8;
/** The longest text after `[[` the picker searches with (longer: the list closes). */
export const NOTE_LINK_QUERY_MAX_LENGTH = 80;
/** The picker searches this long after the last key press. */
export const NOTE_LINK_SEARCH_DELAY_MS = 150;

/** The autosave runs this long after the last key press. */
export const NOTE_SAVE_DELAY_MS = 1_000;
