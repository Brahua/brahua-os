import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
// `projects` depends on `core` (CAPABILITY-MAP): every project belongs to a life area.
import { lifeAreas } from "@/modules/core/db/schema";
import {
  MILESTONE_TITLE_MAX_LENGTH,
  PROJECT_LINK_LABEL_MAX_LENGTH,
  PROJECT_LINK_URL_MAX_LENGTH,
  PROJECT_NAME_MAX_LENGTH,
  PROJECT_NOTES_MAX_LENGTH,
  PROJECT_OBJECTIVE_MAX_LENGTH,
  PROJECT_PRIORITIES,
  PROJECT_STATUSES,
} from "../project-constants";

export { PROJECT_PRIORITIES, PROJECT_STATUSES } from "../project-constants";

/** `'a', 'b', …` for an IN list. Only for these compile-time constants, never for user input. */
const sqlList = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value.replace(/'/g, "''")}'`).join(", "));

/** A compile-time number inside a CHECK (never user input). */
const n = (value: number) => sql.raw(String(value));

// Defense in depth behind the Zod schemas (SPEC-projects, like C5): raw SQL, scripts or a bug
// can't store an unknown status or priority, an empty or too long text, a due date before the
// start, a completion date on a project that isn't done, a link that isn't http(s), or a project
// that blocks itself. A NULL optional column passes (a CHECK only fails on false).

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(), // 1–80, normalized like area names
    objective: text("objective"), // ≤ 280: "what done looks like"
    notes: text("notes"), // ≤ 20 000, Markdown (rendered sanitized)
    status: text("status", { enum: PROJECT_STATUSES }).notNull().default("idea"),
    priority: text("priority", { enum: PROJECT_PRIORITIES }).notNull().default("medium"),
    // A project keeps its area if the area is archived later; areas are never deleted.
    lifeAreaId: uuid("life_area_id")
      .notNull()
      .references(() => lifeAreas.id, { onDelete: "restrict" }),
    startDate: date("start_date"), // a day in Lima, no time (YYYY-MM-DD)
    dueDate: date("due_date"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    // Soft delete: no physical deletes. Left out of every list, kept in `pnpm db:export`.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      // Stamped by the database clock on every Drizzle update. Raw SQL updates must set it themselves.
      .$onUpdate(() => sql`now()`),
  },
  (table) => [
    check("projects_status_check", sql`${table.status} in (${sqlList(PROJECT_STATUSES)})`),
    check("projects_priority_check", sql`${table.priority} in (${sqlList(PROJECT_PRIORITIES)})`),
    check(
      "projects_name_length_check",
      sql`char_length(${table.name}) between 1 and ${n(PROJECT_NAME_MAX_LENGTH)}`,
    ),
    check(
      "projects_objective_length_check",
      sql`char_length(${table.objective}) between 1 and ${n(PROJECT_OBJECTIVE_MAX_LENGTH)}`,
    ),
    check(
      "projects_notes_length_check",
      sql`char_length(${table.notes}) between 1 and ${n(PROJECT_NOTES_MAX_LENGTH)}`,
    ),
    check("projects_dates_check", sql`${table.dueDate} >= ${table.startDate}`),
    // Done ⇔ a completion date: moving to done stamps it, leaving done clears it.
    check(
      "projects_completed_at_check",
      sql`(${table.status} = 'done') = (${table.completedAt} is not null)`,
    ),
    index("projects_status_idx")
      .on(table.status)
      .where(sql`${table.deletedAt} is null`),
    index("projects_life_area_id_idx").on(table.lifeAreaId),
  ],
);

export const projectMilestones = pgTable(
  "project_milestones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(), // 1–120
    dueDate: date("due_date"),
    doneAt: timestamp("done_at", { withTimezone: true }),
    sortOrder: integer("sort_order").notNull(),
  },
  (table) => [
    check(
      "project_milestones_title_length_check",
      sql`char_length(${table.title}) between 1 and ${n(MILESTONE_TITLE_MAX_LENGTH)}`,
    ),
    check("project_milestones_sort_order_check", sql`${table.sortOrder} >= 0`),
    index("project_milestones_project_order_idx").on(table.projectId, table.sortOrder),
  ],
);

export const projectLinks = pgTable(
  "project_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    url: text("url").notNull(), // http(s) only, ≤ 2048
    label: text("label"), // ≤ 80
    sortOrder: integer("sort_order").notNull(),
  },
  (table) => [
    check(
      "project_links_url_check",
      sql`char_length(${table.url}) <= ${n(PROJECT_LINK_URL_MAX_LENGTH)} and ${table.url} ~* '^https?://[^[:space:]]+$'`,
    ),
    check(
      "project_links_label_length_check",
      sql`char_length(${table.label}) between 1 and ${n(PROJECT_LINK_LABEL_MAX_LENGTH)}`,
    ),
    check("project_links_sort_order_check", sql`${table.sortOrder} >= 0`),
    index("project_links_project_order_idx").on(table.projectId, table.sortOrder),
  ],
);

/** "Bloqueado por": `projectId` is blocked by `blockedById` (many to many, no self-reference). */
export const projectDependencies = pgTable(
  "project_dependencies",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    blockedById: uuid("blocked_by_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.blockedById] }),
    check("project_dependencies_self_check", sql`${table.projectId} <> ${table.blockedById}`),
    // The reverse lookup ("what does this project block?") and the FK's cascade.
    index("project_dependencies_blocked_by_id_idx").on(table.blockedById),
  ],
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type ProjectMilestone = typeof projectMilestones.$inferSelect;
export type ProjectLink = typeof projectLinks.$inferSelect;
export type ProjectDependency = typeof projectDependencies.$inferSelect;
