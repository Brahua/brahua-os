// Validation and client types of `habits` (SPEC-habits "Comandos y estructura"). Client-safe: the
// server actions are the authority, and the forms run the same schemas first so errors show
// without a round trip.
import { z } from "zod";
import type { AreaColor, AreaIconName } from "@/design-system/areas";
import { hasInvisibleCharacters, normalizeName } from "@/lib/text";
import { frequencyInputShape } from "./frequency-input";
import { measureInputShape } from "./measure-input";
import {
  HABIT_NAME_MAX_LENGTH,
  type HabitFrequency,
  type HabitKind,
  type HabitMeasure,
} from "./habit-constants";

export const HABIT_ERRORS = {
  nameRequired: "Escribe el nombre del hábito.",
  nameTooLong: `Usa ${HABIT_NAME_MAX_LENGTH} caracteres como máximo.`,
  nameInvisible: "Quita los caracteres invisibles o de control del nombre.",
  area: "Elige un área.",
  areaUnavailable: "Esa área ya no está disponible (se archivó o no existe). Elige otra.",
  dayInvalid: "Ese día no es válido.",
  dayOutOfWindow: "Solo puedes registrar hoy y los 7 días anteriores, desde que empezó el hábito.",
  measureMismatch: "Este hábito se registra con una cantidad, no con sí o no.",
  notFound: "Este hábito ya no existe (se eliminó).",
  archived: "Este hábito está archivado: reactívalo para registrarlo.",
} as const;

/** A life area as a habit shows it (it may be archived since). */
export type HabitAreaSummary = {
  id: string;
  slug: string;
  name: string;
  icon: AreaIconName;
  color: AreaColor;
};

/**
 * What "Hoy" (and later `today`) gets of a habit: its rules, its area and the day it is shown
 * for. Never the whole row. H2–H4 add what they need here (e.g. the streak).
 */
export type HabitItem = {
  id: string;
  name: string;
  kind: HabitKind;
  measure: HabitMeasure;
  goal: number;
  unit: string | null;
  step: number;
  frequency: HabitFrequency;
  weeklyTarget: number | null;
  weekdays: number[] | null;
  /** A day in Lima, YYYY-MM-DD. */
  startDate: string;
  area: HabitAreaSummary | null;
  /** What was logged on the day the list was read for (0 without a log). */
  quantity: number;
  /** The goal in force that day: the log's own, or the habit's goal without a log. */
  target: number;
  /** Whether any day was ever logged, even unmarked again (deleting it asks first then). */
  hasLogs: boolean;
};

/** What the "Hábito eliminado · Deshacer" notice needs of a deleted habit. */
export type DeletedHabit = { id: string; name: string };

/** The name as stored: like names (NFC, collapsed whitespace, trimmed). */
export const normalizeHabitName = normalizeName;

const name = z
  .string({ error: HABIT_ERRORS.nameRequired })
  // A cheap cap before normalizing: an absurdly long string is refused without the work.
  .max(HABIT_NAME_MAX_LENGTH * 4, HABIT_ERRORS.nameTooLong)
  .transform(normalizeHabitName)
  .pipe(
    z
      .string()
      .min(1, HABIT_ERRORS.nameRequired)
      .max(HABIT_NAME_MAX_LENGTH, HABIT_ERRORS.nameTooLong)
      .refine((value) => !hasInvisibleCharacters(value), HABIT_ERRORS.nameInvisible),
  );

/** Ids are uuids: anything else can't be a habit (and never reaches Postgres). */
const id = z.uuid({ error: HABIT_ERRORS.notFound });

/** An optional area: "", null or missing is none. */
const lifeAreaId = z.preprocess(
  (value) => (value === "" || value === undefined ? null : value),
  z.uuid({ error: HABIT_ERRORS.area }).nullable(),
);

/** A real calendar day, YYYY-MM-DD. */
const day = z.iso.date({ error: HABIT_ERRORS.dayInvalid });

/**
 * Creating a habit. H1: a daily yes/no habit to keep, with a name and optionally an area. H2 adds
 * the frequency (frequency-input.ts) and H3 the kind and the measure (measure-input.ts), each in
 * its own file, as optional fields with H1's defaults.
 */
export const createHabitInputSchema = z.object({
  name,
  lifeAreaId,
  ...frequencyInputShape,
  ...measureInputShape,
});

export type CreateHabitInput = z.output<typeof createHabitInputSchema>;

/** Field names of the create form, in order (focus goes to the first invalid one). */
export const CREATE_HABIT_FIELDS = ["name", "lifeAreaId"] as const;
export type CreateHabitField = (typeof CREATE_HABIT_FIELDS)[number];

/** Delete and undo. */
export const habitIdInputSchema = z.object({ id });

/**
 * A yes/no habit's day, as the state wanted (not a toggle): sending it twice changes nothing, so
 * a double tap or a retry is safe.
 */
export const setHabitDoneInputSchema = z.object({ id, day, done: z.boolean() });

export type SetHabitDoneInput = z.output<typeof setHabitDoneInputSchema>;
