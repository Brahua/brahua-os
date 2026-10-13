// Validation and client types of `goals` (SPEC-goals "Comandos y estructura"). Client-safe: the
// server actions are the authority, and the forms run the same schemas first so errors show
// without a round trip.
//
// All three sources (habit, project, manual) are validated here, so the schema is complete from
// G1; the form offers only "Cantidad" until G2, and the domain refuses the others
// ("sourceUnavailable", goals.ts).
import { z } from "zod";
import type { AreaColor, AreaIconName } from "@/design-system/areas";
import { hasInvisibleCharacters, normalizeName } from "@/lib/text";
import {
  GOAL_DELTA_MAX,
  GOAL_NOTES_MAX_LENGTH,
  GOAL_PERIOD_KINDS,
  GOAL_PROJECT_TARGET,
  GOAL_TARGET_MAX,
  GOAL_TITLE_MAX_LENGTH,
  GOAL_UNIT_MAX_LENGTH,
  GOAL_YEAR_MAX,
  GOAL_YEAR_MIN,
  type GoalPeriodKind,
  type GoalSourceKind,
  type GoalStatus,
} from "./goal-constants";
import { GOAL_ERRORS } from "./goals-copy";

/** Far above any real list; bounds the work a single request can ask for. */
export const MAX_GOALS_IN_ORDER = 500;

/** The title as stored: like names (NFC, collapsed whitespace, trimmed). */
export const normalizeGoalTitle = normalizeName;

const title = z
  .string({ error: GOAL_ERRORS.titleRequired })
  // A cheap cap before normalizing: an absurdly long string is refused without the work.
  .max(GOAL_TITLE_MAX_LENGTH * 4, GOAL_ERRORS.titleTooLong)
  .transform(normalizeGoalTitle)
  .pipe(
    z
      .string()
      .min(1, GOAL_ERRORS.titleRequired)
      .max(GOAL_TITLE_MAX_LENGTH, GOAL_ERRORS.titleTooLong)
      .refine((value) => !hasInvisibleCharacters(value), GOAL_ERRORS.titleInvisible),
  );

/** Notes keep their line breaks; blank or missing is none. */
const notes = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z
    .string({ error: GOAL_ERRORS.notesTooLong })
    .max(GOAL_NOTES_MAX_LENGTH * 2, GOAL_ERRORS.notesTooLong)
    .transform((value) => value.normalize("NFC").trim())
    .pipe(
      z
        .string()
        .max(GOAL_NOTES_MAX_LENGTH, GOAL_ERRORS.notesTooLong)
        .refine(
          (value) => !hasInvisibleCharacters(value.replace(/[\n\r\t]/g, "")),
          GOAL_ERRORS.notesInvisible,
        ),
    )
    .nullable()
    .default(null),
);

/** Ids are uuids: anything else can't be a goal (and never reaches Postgres). */
const id = z.uuid({ error: GOAL_ERRORS.notFound });

/** An optional area: "", null or missing is none. */
const areaId = z.preprocess(
  (value) => (value === "" || value === undefined ? null : value),
  z.uuid({ error: GOAL_ERRORS.area }).nullable(),
);

const target = z
  .number({ error: GOAL_ERRORS.targetInvalid })
  .int(GOAL_ERRORS.targetInvalid)
  .min(1, GOAL_ERRORS.targetInvalid)
  .max(GOAL_TARGET_MAX, GOAL_ERRORS.targetInvalid);

const unit = z
  .string({ error: GOAL_ERRORS.unitRequired })
  .max(GOAL_UNIT_MAX_LENGTH * 4, GOAL_ERRORS.unitTooLong)
  .transform(normalizeName)
  .pipe(
    z
      .string()
      .min(1, GOAL_ERRORS.unitRequired)
      .max(GOAL_UNIT_MAX_LENGTH, GOAL_ERRORS.unitTooLong)
      .refine((value) => !hasInvisibleCharacters(value), GOAL_ERRORS.unitInvisible),
  );

/** "" or missing quarter is none. */
const quarter = z.preprocess(
  (value) => (value === "" || value === undefined ? null : value),
  z.number({ error: GOAL_ERRORS.period }).int(GOAL_ERRORS.period).min(1).max(4).nullable(),
);

/** The period: a year, or a year and a quarter (1–4) exactly when it is a quarter. */
const periodShape = {
  periodKind: z.enum(GOAL_PERIOD_KINDS, { error: GOAL_ERRORS.period }),
  year: z
    .number({ error: GOAL_ERRORS.period })
    .int(GOAL_ERRORS.period)
    .min(GOAL_YEAR_MIN, GOAL_ERRORS.period)
    .max(GOAL_YEAR_MAX, GOAL_ERRORS.period),
  quarter,
};

function refinePeriod(
  value: { periodKind: GoalPeriodKind; quarter: number | null },
  context: z.RefinementCtx,
) {
  if ((value.periodKind === "quarter") !== (value.quarter !== null)) {
    context.addIssue({ code: "custom", path: ["quarter"], message: GOAL_ERRORS.period });
  }
}

const sourceError = { error: GOAL_ERRORS.source };

const manualShape = { sourceKind: z.literal("manual", sourceError), target, unit };
const habitShape = {
  sourceKind: z.literal("habit", sourceError),
  habitId: z.uuid({ error: GOAL_ERRORS.source }),
  target,
};
// A project's target is its percentage: fixed at 100 whatever is sent.
const projectShape = {
  sourceKind: z.literal("project", sourceError),
  projectId: z.uuid({ error: GOAL_ERRORS.source }),
  target: z
    .literal(GOAL_PROJECT_TARGET, { error: GOAL_ERRORS.targetInvalid })
    .default(GOAL_PROJECT_TARGET),
};

const common = { title, notes, areaId };

/**
 * Creating a goal: its period, one source with exactly its own fields (habit → habitId and a
 * number of days; project → projectId; manual → a target and a unit) and optionally an area and
 * notes.
 */
export const createGoalInputSchema = z.discriminatedUnion("sourceKind", [
  z.object({ ...periodShape, ...common, ...manualShape }).superRefine(refinePeriod),
  z.object({ ...periodShape, ...common, ...habitShape }).superRefine(refinePeriod),
  z.object({ ...periodShape, ...common, ...projectShape }).superRefine(refinePeriod),
]);

export type CreateGoalInput = z.output<typeof createGoalInputSchema>;

/** The fields of the create form that can carry an error, in the order the form shows them. */
export const CREATE_GOAL_FIELDS = [
  "title",
  "periodKind",
  "sourceKind",
  "target",
  "unit",
  "areaId",
  "notes",
] as const;
export type CreateGoalField = (typeof CREATE_GOAL_FIELDS)[number];

/**
 * Editing a goal: its title, notes, area and what its source asks (target and unit). The period
 * and the source never change in an edit (SPEC-goals: changing the source resets the reading;
 * G2 decides how), so `sourceKind` must be the goal's own.
 */
export const updateGoalInputSchema = z.discriminatedUnion("sourceKind", [
  z.object({ id, ...common, ...manualShape }),
  z.object({ id, ...common, ...habitShape }),
  z.object({ id, ...common, ...projectShape }),
]);

export type UpdateGoalInput = z.output<typeof updateGoalInputSchema>;

export const goalIdInputSchema = z.object({ id });

/** Delete, restore, archive, mark achieved and reopen all take just the id. */
export type GoalIdInput = z.output<typeof goalIdInputSchema>;

/** "Reactivar" at the end of the order, or the archive's "Deshacer" back in its place. */
export const unarchiveGoalInputSchema = z.object({
  id,
  position: z.enum(["end", "original"]).default("end"),
});
export type UnarchiveGoalInput = z.output<typeof unarchiveGoalInputSchema>;

/**
 * Reorder: every non-archived goal's id, in the new order, without repeats. The server also
 * checks that they are exactly those goals (`planReorder`): a stale or tampered list is refused.
 */
export const reorderGoalsInputSchema = z.object({
  ids: z
    .array(z.uuid({ error: GOAL_ERRORS.order }), { error: GOAL_ERRORS.order })
    .min(1, GOAL_ERRORS.order)
    .max(MAX_GOALS_IN_ORDER, GOAL_ERRORS.order)
    .refine((ids) => new Set(ids).size === ids.length, GOAL_ERRORS.order),
});

/** One manual entry: `+N`, or a negative number to correct. Never zero. */
export const addEntryInputSchema = z.object({
  goalId: id,
  delta: z
    .number({ error: GOAL_ERRORS.deltaInvalid })
    .int(GOAL_ERRORS.deltaInvalid)
    .min(-GOAL_DELTA_MAX, GOAL_ERRORS.deltaInvalid)
    .max(GOAL_DELTA_MAX, GOAL_ERRORS.deltaInvalid)
    .refine((value) => value !== 0, GOAL_ERRORS.deltaInvalid),
});
export type AddEntryInput = z.output<typeof addEntryInputSchema>;

/** The undo of an entry carries the id of the exact entry it created. */
export const undoEntryInputSchema = z.object({
  goalId: id,
  entryId: z.uuid({ error: GOAL_ERRORS.entryNotFound }),
});
export type UndoEntryInput = z.output<typeof undoEntryInputSchema>;

/** A life area as a goal shows it (it may be archived since). */
export type GoalAreaSummary = {
  id: string;
  slug: string;
  name: string;
  icon: AreaIconName;
  color: AreaColor;
};

/** What the screens get of a goal: its rules, its area and what its source read (G1: the sum). */
export type GoalItem = {
  id: string;
  title: string;
  notes: string | null;
  periodKind: GoalPeriodKind;
  year: number;
  quarter: number | null;
  sourceKind: GoalSourceKind;
  habitId: string | null;
  projectId: string | null;
  target: number;
  unit: string | null;
  status: GoalStatus;
  /** ISO instant, or null while it is not achieved. */
  achievedAt: string | null;
  position: number;
  area: GoalAreaSummary | null;
  /** The sum of a manual goal's entries (0 for the other sources: G2 reads them elsewhere). */
  sum: number;
};

/** One row of a manual goal's history. */
export type GoalEntryItem = {
  id: string;
  delta: number;
  /** The Lima day it was logged, YYYY-MM-DD. */
  entryDate: string;
  /** ISO instant. */
  createdAt: string;
};

/** What the "Meta eliminada · Deshacer" notice needs of a deleted goal. */
export type DeletedGoal = { id: string; title: string };
