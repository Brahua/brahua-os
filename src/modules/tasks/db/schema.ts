import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
// `tasks` depends on `core` and `projects` (CAPABILITY-MAP): a task may sit in a life area, or in
// a project (and one of its milestones).
import { lifeAreas } from "@/modules/core/db/schema";
import { projectMilestones, projects } from "@/modules/projects/db/schema";
import {
  INTERVAL_RECURRENCE_KINDS,
  MONTH_DAY_MAX,
  RECURRENCE_INTERVAL_MAX,
  RECURRENCE_KINDS,
  TASK_NOTES_MAX_LENGTH,
  TASK_PRIORITIES,
  TASK_TAG_NAME_MAX_LENGTH,
  TASK_TITLE_MAX_LENGTH,
} from "../task-constants";

export { RECURRENCE_KINDS, TASK_PRIORITIES } from "../task-constants";

/** `'a', 'b', …` for an IN list. Only for these compile-time constants, never for user input. */
const sqlList = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value.replace(/'/g, "''")}'`).join(", "));

/** A compile-time number inside a CHECK (never user input). */
const n = (value: number) => sql.raw(String(value));

// Defense in depth behind the Zod schemas (SPEC-tasks, like projects): raw SQL, scripts or a bug
// can't store an unknown priority or rule, an empty or too long text, a task with both its own
// area and a project (the project's area is the task's), a milestone without a project, a next
// action that isn't a pending task of a project, or a recurrence rule that is incomplete or mixes
// fields of two rules. A NULL optional column passes (a CHECK only fails on false).

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(), // 1–200, normalized like names
    notes: text("notes"), // ≤ 20 000, Markdown (rendered sanitized)
    priority: text("priority", { enum: TASK_PRIORITIES }).notNull().default("medium"),
    dueDate: date("due_date"), // a day in Lima (YYYY-MM-DD)
    // Optional wall-clock time in Lima (no zone, minute precision), only with `due_date`.
    dueTime: time("due_time"),
    doneAt: timestamp("done_at", { withTimezone: true }),
    // Only when there is no project: with one, the area is the project's (read through it).
    lifeAreaId: uuid("life_area_id").references(() => lifeAreas.id, { onDelete: "restrict" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "restrict" }),
    milestoneId: uuid("milestone_id").references(() => projectMilestones.id, {
      onDelete: "restrict",
    }),
    isNextAction: boolean("is_next_action").notNull().default(false),
    recurrenceKind: text("recurrence_kind", { enum: RECURRENCE_KINDS }),
    recurrenceInterval: integer("recurrence_interval"), // N for every_*
    recurrenceWeekdays: integer("recurrence_weekdays").array(), // ISO 1–7, ascending, for weekdays
    recurrenceMonthDay: integer("recurrence_month_day"), // 1–31 for month_day (clamped to month end)
    // The previous occurrence of a recurring task: undoing its completion removes this one (T3).
    spawnedFromId: uuid("spawned_from_id").references((): AnyPgColumn => tasks.id, {
      onDelete: "restrict",
    }),
    // Soft delete: no physical deletes. Left out of every view, kept in `pnpm db:export`.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      // Stamped by the database clock on every Drizzle update. Raw SQL updates must set it themselves.
      .$onUpdate(() => sql`now()`),
  },
  (table) => [
    check("tasks_priority_check", sql`${table.priority} in (${sqlList(TASK_PRIORITIES)})`),
    check(
      "tasks_title_length_check",
      sql`char_length(${table.title}) between 1 and ${n(TASK_TITLE_MAX_LENGTH)}`,
    ),
    check(
      "tasks_notes_length_check",
      sql`char_length(${table.notes}) between 1 and ${n(TASK_NOTES_MAX_LENGTH)}`,
    ),
    // The project's area is the task's: never both.
    check(
      "tasks_area_or_project_check",
      sql`${table.lifeAreaId} is null or ${table.projectId} is null`,
    ),
    check(
      "tasks_milestone_project_check",
      sql`${table.milestoneId} is null or ${table.projectId} is not null`,
    ),
    // Only a pending task of a project can be its next action.
    check(
      "tasks_next_action_check",
      sql`not ${table.isNextAction} or (${table.projectId} is not null and ${table.doneAt} is null)`,
    ),
    // A time only makes sense on a day, and it is HH:MM (no seconds, never 24:00).
    check(
      "tasks_due_time_check",
      sql`${table.dueTime} is null or (
        ${table.dueDate} is not null
        and ${table.dueTime} >= time '00:00'
        and ${table.dueTime} < time '24:00'
        and extract(second from ${table.dueTime}) = 0
      )`,
    ),
    check("tasks_spawned_from_check", sql`${table.spawnedFromId} <> ${table.id}`),
    check(
      "tasks_recurrence_kind_check",
      sql`${table.recurrenceKind} in (${sqlList(RECURRENCE_KINDS)})`,
    ),
    // Each rule has exactly its own field: N (1–365) for every_*, ISO weekdays for weekdays
    // (1–7, strictly ascending, so never repeated), the day of the month (1–31) for month_day;
    // no rule, no fields. Wrapped in coalesce(…, false): a CHECK passes on NULL, and a missing
    // field would turn a branch into NULL instead of false.
    check(
      "tasks_recurrence_check",
      sql`coalesce((
        ${table.recurrenceKind} is null
        and ${table.recurrenceInterval} is null
        and ${table.recurrenceWeekdays} is null
        and ${table.recurrenceMonthDay} is null
      ) or (
        ${table.recurrenceKind} in (${sqlList(INTERVAL_RECURRENCE_KINDS)})
        and ${table.recurrenceInterval} between 1 and ${n(RECURRENCE_INTERVAL_MAX)}
        and ${table.recurrenceWeekdays} is null
        and ${table.recurrenceMonthDay} is null
      ) or (
        ${table.recurrenceKind} = 'weekdays'
        and ${table.recurrenceInterval} is null
        and ${table.recurrenceMonthDay} is null
        and array_ndims(${table.recurrenceWeekdays}) = 1
        and array_lower(${table.recurrenceWeekdays}, 1) = 1
        and cardinality(${table.recurrenceWeekdays}) between 1 and 7
        and array_position(${table.recurrenceWeekdays}, null) is null
        and ${table.recurrenceWeekdays} <@ array[1, 2, 3, 4, 5, 6, 7]
        and (cardinality(${table.recurrenceWeekdays}) < 2 or ${table.recurrenceWeekdays}[1] < ${table.recurrenceWeekdays}[2])
        and (cardinality(${table.recurrenceWeekdays}) < 3 or ${table.recurrenceWeekdays}[2] < ${table.recurrenceWeekdays}[3])
        and (cardinality(${table.recurrenceWeekdays}) < 4 or ${table.recurrenceWeekdays}[3] < ${table.recurrenceWeekdays}[4])
        and (cardinality(${table.recurrenceWeekdays}) < 5 or ${table.recurrenceWeekdays}[4] < ${table.recurrenceWeekdays}[5])
        and (cardinality(${table.recurrenceWeekdays}) < 6 or ${table.recurrenceWeekdays}[5] < ${table.recurrenceWeekdays}[6])
        and (cardinality(${table.recurrenceWeekdays}) < 7 or ${table.recurrenceWeekdays}[6] < ${table.recurrenceWeekdays}[7])
      ) or (
        ${table.recurrenceKind} = 'month_day'
        and ${table.recurrenceInterval} is null
        and ${table.recurrenceWeekdays} is null
        and ${table.recurrenceMonthDay} between 1 and ${n(MONTH_DAY_MAX)}
      ), false)`,
    ),
    // One next action per project (SPEC-tasks "Próxima acción").
    uniqueIndex("tasks_next_action_unique")
      .on(table.projectId)
      .where(sql`${table.isNextAction} and ${table.deletedAt} is null`),
    // "Hoy" and "Próximas" (T2) and `today`: pending tasks by due date.
    index("tasks_due_date_idx")
      .on(table.dueDate)
      .where(sql`${table.doneAt} is null and ${table.deletedAt} is null`),
    index("tasks_project_id_idx").on(table.projectId),
    index("tasks_life_area_id_idx").on(table.lifeAreaId),
    // The FK's restrict check when a milestone row is deleted (milestones are soft-deleted, but
    // a cascade from a project would look here).
    index("tasks_milestone_id_idx").on(table.milestoneId),
    // Recurrence (T3): a completion spawns at most one live occurrence (defense in depth behind
    // the done_at guard: a double tap or a re-completion never leaves two).
    uniqueIndex("tasks_spawned_from_unique")
      .on(table.spawnedFromId)
      .where(sql`${table.deletedAt} is null`),
    // "The occurrence this one spawned" (undo) and the self-FK's restrict check, deleted rows too.
    index("tasks_spawned_from_id_idx").on(table.spawnedFromId),
  ],
);

/** Free tags (T4): created when typed, lowercase, 1–30 characters, no duplicates. */
export const taskTags = pgTable(
  "task_tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "task_tags_name_check",
      sql`char_length(${table.name}) between 1 and ${n(TASK_TAG_NAME_MAX_LENGTH)} and ${table.name} = lower(${table.name})`,
    ),
  ],
);

export const taskTagLinks = pgTable(
  "task_tag_links",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => taskTags.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.taskId, table.tagId] }),
    // "Tasks with this tag" (the filter) and the FK's cascade.
    index("task_tag_links_tag_id_idx").on(table.tagId),
  ],
);

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type TaskTag = typeof taskTags.$inferSelect;
export type TaskTagLink = typeof taskTagLinks.$inferSelect;
