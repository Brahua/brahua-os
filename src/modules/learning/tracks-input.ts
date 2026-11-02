// Validation and client types of `learning`'s tracks (L1, SPEC-learning). Client-safe: the sheet
// runs the same schemas before the server action, which is the authority; the database CHECKs are
// the last line. Zod and the CHECKs accept exactly the same texts (CLAUDE.md "household").
import { z } from "zod";
import { hasInvisibleCharacters, normalizeName } from "@/lib/text";
import {
  TARGET_DATE_MAX,
  TARGET_DATE_MIN,
  TRACK_KINDS,
  TRACK_STATUSES,
  TRACK_TITLE_MAX_LENGTH,
  WEEKLY_TARGET_MAX_MINUTES,
  WEEKLY_TARGET_MIN_MINUTES,
  type TrackKind,
  type TrackStatus,
} from "./learning-constants";
import { LEARNING_ERRORS as ERRORS } from "./learning-copy";
import { codePoints, parseSyllabus } from "./syllabus";
import { acceptableTrackUrl } from "./track-url";

// ── What the screens get (never whole rows) ──────────────────────────────────────────────────

/** A step named somewhere else than its syllabus (the card's «Sigue con»). */
export type StepRef = { id: string; title: string };

/** A track as the list and its page show it. */
export type TrackItem = {
  id: string;
  title: string;
  kind: TrackKind;
  status: TrackStatus;
  projectId: string | null;
  url: string | null;
  weeklyTargetMinutes: number | null;
  /** YYYY-MM-DD, or null. */
  targetDate: string | null;
  /** Order inside its status. */
  position: number;
  /** ISO instant while done, else null. */
  finishedAt: string | null;
  /** Its live steps: done of total. */
  steps: { done: number; total: number };
  /** Its next live steps not done, in order (up to two: the card's «Hecho» shows the one after). */
  upcoming: StepRef[];
};

/** A track just named in a notice or the limit's offer. */
export type TrackRef = { id: string; title: string };

/** A project a track can belong to. */
export type ProjectChoice = { id: string; name: string };

/** What a track's status was before a change: its «Deshacer» puts exactly this back. */
export type StatusSnapshot = {
  status: TrackStatus;
  position: number;
  /** ISO instant (the track was done), or null. */
  finishedAt: string | null;
};

/** One track's status change (a swap changes two). */
export type StatusChange = { id: string; title: string; from: StatusSnapshot; to: TrackStatus };

/** A status change: the track as it is now and every change made (empty: it already was). */
export type StatusResult = { track: TrackItem; changes: StatusChange[] };

/** A create: the track and, when another one was paused to make room, that change. */
export type CreateResult = { track: TrackItem; changes: StatusChange[] };

/** A track just deleted (`?deleted=<id>` on the list). */
export type DeletedTrack = { id: string; title: string };

/** A restore: the track and whether it came back «En espera» (no room among the 2 in progress). */
export type RestoreResult = { track: TrackItem; movedToWaiting: boolean };

// ── Fields ───────────────────────────────────────────────────────────────────────────────────

const title = z
  .string({ error: ERRORS.titleRequired })
  .max(1_000, ERRORS.titleTooLong)
  .transform(normalizeName)
  .pipe(
    z
      .string()
      .min(1, ERRORS.titleRequired)
      .refine((value) => codePoints(value) <= TRACK_TITLE_MAX_LENGTH, ERRORS.titleTooLong)
      .refine((value) => !hasInvisibleCharacters(value), ERRORS.invisible),
  );

const kind = z.enum(TRACK_KINDS, { error: ERRORS.kind });

/** "" and null mean none (the owner emptied the field). */
const emptyToNull = (value: unknown) =>
  value === undefined || (typeof value === "string" && value.trim() === "") ? null : value;

/** The project: a uuid or none. Whether it exists is checked in the transaction. */
const projectId = z.preprocess(emptyToNull, z.uuid({ error: ERRORS.project }).nullable());

/** The link: none, or an acceptable http(s) link (track-url.ts), stored normalized. */
const url = z.preprocess(
  emptyToNull,
  z
    .string({ error: ERRORS.url })
    .refine((value) => acceptableTrackUrl(value) !== null, ERRORS.url)
    .transform((value) => acceptableTrackUrl(value) as string)
    .nullable(),
);

/** Minutes per week, 15–3000, or none. */
const weeklyTargetMinutes = z.preprocess(
  emptyToNull,
  z
    .number({ error: ERRORS.weeklyTarget })
    .int(ERRORS.weeklyTarget)
    .min(WEEKLY_TARGET_MIN_MINUTES, ERRORS.weeklyTarget)
    .max(WEEKLY_TARGET_MAX_MINUTES, ERRORS.weeklyTarget)
    .nullable(),
);

/** A real calendar day between 2000 and 2100, or none. */
const targetDate = z.preprocess(
  emptyToNull,
  z.iso
    .date({ error: ERRORS.targetDate })
    .refine((value) => value >= TARGET_DATE_MIN && value <= TARGET_DATE_MAX, ERRORS.targetDate)
    .nullable(),
);

/** A pasted syllabus as its step titles (syllabus.ts): one per non-blank line. */
export const syllabusSchema = z.string({ error: ERRORS.syllabusTooBig }).transform((text, ctx) => {
  const parsed = parseSyllabus(text);
  if (parsed.ok) return parsed.titles;
  const message =
    parsed.error === "tooMany"
      ? ERRORS.syllabusTooMany
      : parsed.error === "tooBig"
        ? ERRORS.syllabusTooBig
        : parsed.error === "tooLong"
          ? ERRORS.syllabusTooLong(parsed.line ?? 0)
          : ERRORS.syllabusInvisible(parsed.line ?? 0);
  ctx.addIssue({ code: "custom", message });
  return z.NEVER;
});

const id = z.uuid({ error: ERRORS.notFound });

/** Every field the form edits, sent whole: a missing optional field is «none» on purpose. */
export const trackFieldsSchema = z.object({
  title,
  kind,
  projectId: projectId.default(null),
  url: url.default(null),
  weeklyTargetMinutes: weeklyTargetMinutes.default(null),
  targetDate: targetDate.default(null),
});
export type TrackFields = z.output<typeof trackFieldsSchema>;

/** The form's fields in the order errors are focused. */
export const TRACK_FIELDS = [
  "title",
  "kind",
  "syllabus",
  "status",
  "pauseTrackId",
  "weeklyTargetMinutes",
  "targetDate",
  "projectId",
  "url",
] as const;
export type TrackField = (typeof TRACK_FIELDS)[number];

/**
 * «Nuevo frente»: the fields, the pasted syllabus (none for a practice), whether it starts in
 * progress or waiting and, when 2 are already in progress, the one that moves to «En espera».
 */
export const createTrackInputSchema = trackFieldsSchema
  .extend({
    syllabus: syllabusSchema.default([]),
    status: z.enum(["active", "waiting"], { error: ERRORS.status }).default("active"),
    pauseTrackId: z.preprocess(emptyToNull, z.uuid({ error: ERRORS.pauseUnavailable }).nullable()),
  })
  .superRefine((value, ctx) => {
    if (value.kind === "practice" && value.syllabus.length > 0) {
      ctx.addIssue({ code: "custom", path: ["syllabus"], message: ERRORS.practiceSyllabus });
    }
    if (value.pauseTrackId !== null && value.status !== "active") {
      ctx.addIssue({ code: "custom", path: ["pauseTrackId"], message: ERRORS.invalid });
    }
  });
export type CreateTrackInput = z.output<typeof createTrackInputSchema>;

/** «Ajustes»: the same fields of an existing track. */
export const updateTrackInputSchema = trackFieldsSchema.extend({ id });
export type UpdateTrackInput = z.output<typeof updateTrackInputSchema>;

export const trackIdInputSchema = z.object({ id });

/**
 * «Poner en curso», «Pasar a espera», «Terminar», «Reabrir»: the status wanted (idempotent) and,
 * to put one in progress when 2 already are, the one that moves to «En espera».
 */
export const changeStatusInputSchema = z
  .object({
    id,
    to: z.enum(TRACK_STATUSES, { error: ERRORS.invalid }),
    pauseTrackId: z.preprocess(emptyToNull, z.uuid({ error: ERRORS.pauseUnavailable }).nullable()),
  })
  .refine(
    (value) =>
      value.pauseTrackId === null || (value.to === "active" && value.pauseTrackId !== value.id),
    { message: ERRORS.invalid, path: ["pauseTrackId"] },
  );
export type ChangeStatusInput = z.output<typeof changeStatusInputSchema>;

const snapshot = z
  .object({
    status: z.enum(TRACK_STATUSES, { error: ERRORS.invalid }),
    position: z.number({ error: ERRORS.invalid }).int(ERRORS.invalid).min(0).max(1_000_000),
    finishedAt: z.iso.datetime({ error: ERRORS.invalid }).nullable(),
  })
  // The table's rule: a finished time if and only if done.
  .refine((value) => (value.status === "done") === (value.finishedAt !== null), ERRORS.invalid);

/**
 * «Deshacer» of a status change: every change it made (one, or two for a swap), each put back
 * only while the track still has the status that change left.
 */
export const undoStatusInputSchema = z.object({
  changes: z
    .array(
      z.object({
        id,
        title: z.string().max(1_000).default(""),
        from: snapshot,
        to: z.enum(TRACK_STATUSES, { error: ERRORS.invalid }),
      }),
      { error: ERRORS.invalid },
    )
    .min(1, ERRORS.invalid)
    .max(2, ERRORS.invalid)
    .refine((changes) => new Set(changes.map((change) => change.id)).size === changes.length, {
      message: ERRORS.invalid,
    }),
});
export type UndoStatusInput = z.output<typeof undoStatusInputSchema>;
