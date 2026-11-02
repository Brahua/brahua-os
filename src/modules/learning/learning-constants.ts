// Plain constants of `learning` shared by the Zod schemas (client and server) and the database
// CHECK constraints (SPEC-learning "Modelo de datos"). No server code: the client imports them.

/** What is studied: only `practice` has no syllabus (it is measured in time, L2). */
export const TRACK_KINDS = ["certification", "course", "book", "practice"] as const;
export type TrackKind = (typeof TRACK_KINDS)[number];

/** «En curso», «En espera», «Terminado». No «abandoned»: what doesn't go on waits, guilt-free. */
export const TRACK_STATUSES = ["active", "waiting", "done"] as const;
export type TrackStatus = (typeof TRACK_STATUSES)[number];

/** At most this many tracks «En curso» at a time (decision of the owner, 2026-10-29). */
export const MAX_ACTIVE_TRACKS = 2;

export const TRACK_TITLE_MAX_LENGTH = 120;
export const STEP_TITLE_MAX_LENGTH = 200;
/** A track holds at most this many live steps (a pasted syllabus included). */
export const MAX_STEPS_PER_TRACK = 500;
export const TRACK_URL_MAX_LENGTH = 2_000;
/** The weekly target, in minutes (15 min – 50 h). */
export const WEEKLY_TARGET_MIN_MINUTES = 15;
export const WEEKLY_TARGET_MAX_MINUTES = 3_000;
/** The target date's bounds (a typo like 0202 or 20266 is refused, not stored). */
export const TARGET_DATE_MIN = "2000-01-01";
export const TARGET_DATE_MAX = "2100-12-31";

// ── L2: time ───────────────────────────────────────────────────────────────────────────────

/** How a session was recorded: «Estudiar»/«Detener», or «Anotar tiempo». */
export const SESSION_SOURCES = ["timer", "manual"] as const;
export type SessionSource = (typeof SESSION_SOURCES)[number];

/** A session's minutes (a stopped timer or one written by hand). */
export const SESSION_MIN_MINUTES = 1;
export const SESSION_MAX_MINUTES = 600;
/** «Anotar tiempo» reaches this many days back (today included as day 0). */
export const MANUAL_DAYS_BACK = 30;
/** A timer that ran more than this asks to confirm or correct its minutes (owner, 2026-10-29). */
export const LONG_SESSION_MINUTES = 240;
/** A track's page lists the sessions of this many weeks (the current one included). */
export const SESSION_WEEKS_SHOWN = 8;
