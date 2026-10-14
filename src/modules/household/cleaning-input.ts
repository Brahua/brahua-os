// Validation of «Añadir limpieza» (SPEC-household). Client-safe: the sheet runs the same schema
// before the server action, which is the authority. The output is what the action needs to
// create the task: a title, a zone, a frequency, and the first day (null: the first that fits).
import { z } from "zod";
import { hasInvisibleCharacters, normalizeName } from "@/lib/text";
import {
  CLEANING_TITLE_MAX_LENGTH,
  FREQUENCIES,
  isoWeekdayOf,
  normalizeZone,
  TAG_MAX_LENGTH,
  zoneTagName,
  ZONE_MAX_LENGTH,
  type Frequency,
} from "./cleaning";
import { CLEANING_ERRORS as ERRORS } from "./cleaning-copy";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Length in characters as Postgres counts them (code points, not UTF-16 units). */
const codePoints = (value: string) => [...value].length;

const title = z
  .string({ error: ERRORS.title })
  .max(1000, ERRORS.titleTooLong)
  .transform(normalizeName)
  .pipe(
    z
      .string()
      .min(1, ERRORS.title)
      .refine((value) => codePoints(value) <= CLEANING_TITLE_MAX_LENGTH, ERRORS.titleTooLong),
  );

const zone = z
  .string({ error: ERRORS.zoneEmpty })
  .max(200, ERRORS.zoneTooLong)
  .transform(normalizeZone)
  .pipe(
    z
      .string()
      .min(1, ERRORS.zoneEmpty)
      // The tag is what must fit (`tasks`: 30), and lowercasing can lengthen a name ("İ").
      .refine((value) => codePoints(zoneTagName(value)) <= TAG_MAX_LENGTH, ERRORS.zoneTooLong)
      .refine((value) => codePoints(value) <= ZONE_MAX_LENGTH, ERRORS.zoneTooLong)
      .refine((value) => !value.includes(","), ERRORS.zoneComma)
      .refine((value) => !hasInvisibleCharacters(value), ERRORS.zoneInvisible),
  );

const weekday = z.number().int().min(1).max(7);

/** A real calendar day as YYYY-MM-DD ("" and null both mean none). */
const firstDay = z.preprocess(
  (value) => (value === "" ? null : value),
  z
    .string({ error: ERRORS.date })
    .refine(
      (value) =>
        DAY.test(value) &&
        !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
        new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value,
      ERRORS.date,
    )
    .nullable(),
);

export const addCleaningInputSchema = z
  .object({
    title,
    zone,
    frequency: z.enum(FREQUENCIES, { error: ERRORS.frequency }),
    weekdays: z.array(weekday).max(14).default([]),
    firstDate: firstDay.optional().default(null),
  })
  .superRefine((value, context) => {
    if (value.frequency !== "weekly") return;
    if (value.weekdays.length === 0) {
      context.addIssue({ code: "custom", path: ["weekdays"], message: ERRORS.weekdays });
    } else if (
      value.firstDate !== null &&
      !value.weekdays.includes(isoWeekdayOf(value.firstDate))
    ) {
      context.addIssue({ code: "custom", path: ["firstDate"], message: ERRORS.dateNotOnWeekday });
    }
  });

export type AddCleaningInput = z.output<typeof addCleaningInputSchema>;

/** Field names of the sheet, in order (focus goes to the first invalid one). */
export const ADD_CLEANING_FIELDS = ["title", "zone", "frequency", "weekdays", "firstDate"] as const;

export const cleaningIdInputSchema = z.object({ id: z.uuid() });

export type { Frequency };
