// What `goals` offers other modules (W1 of `weekly-review`, SPEC-weekly-review "Contratos"),
// server-only. Until now `goals` only had queries for its own screens; this file is the contract:
//
// - getGoalsWeekReview(weekStart, now): the goals in the works with their reading and pace, the
//   ones achieved within the week and the entries logged within it (`selectGoalsWeekReview`, the
//   same reads as /goals: `selectVisibleGoals` and `readGoal`).
// - getWeeklyObjectiveForWeek(weekStart) / setWeeklyObjectiveForWeek(weekStart, text): the weekly
//   objective of /goals through the existing domain (`upsertWeeklyObjective`, under the week's
//   lock `(5000, hashtext('goals:weekly:' || weekStart))`): one source of truth, no copy.
//
// Like the other contracts, every function checks the owner (redirects to /login without one) and
// the `select…` variants take the database and trust their caller (integration tests).
import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { requireOwner } from "@/lib/auth";
import { getDb, type Database } from "@/lib/db";
import { ownerDateKey } from "@/lib/time";
import { goalEntries, goals } from "./db/schema";
import { readGoal, unitOf } from "./goal-text";
import type { GoalSourceKind } from "./goal-constants";
import { selectVisibleGoals } from "./goals";
import { periodOf, periodPhase } from "./pace";
import { goalPath } from "./routes";
import { revalidateWeeklyObjective } from "./revalidate";
import { getWeeklyObjective } from "./queries";
import { upsertWeeklyObjective } from "./weekly";
import {
  setWeeklyObjectiveInputSchema,
  type WeeklyObjectiveChange,
  type WeeklyObjectiveItem,
} from "./weekly-input";

export type { WeeklyObjectiveChange, WeeklyObjectiveItem } from "./weekly-input";

/** How a goal stands against its pace, as a state the ritual can phrase. */
export type GoalPaceState =
  | "done"
  | "upcoming"
  | "past"
  | "ahead"
  | "on"
  | "next-step"
  /** A project goal has no pace (its date is the project's own). */
  | "none"
  /** Its habit or project no longer exists. */
  | "unavailable";

/** A goal in the works as the review shows it. */
export type GoalWeekReviewItem = {
  id: string;
  title: string;
  href: string;
  sourceKind: GoalSourceKind;
  /** What counts toward the target, the target and the unit shown after them. */
  value: number | null;
  target: number;
  unit: string;
  /** "5 de 12 libros", "34 de 40 días", "62 %" (null when the source is unavailable). */
  count: string | null;
  /** 0–1, for the bar. */
  ratio: number;
  paceState: GoalPaceState;
  /** The next step ("~3 por semana") when `paceState` is `next-step`. */
  perWeekNeeded: number | null;
  /** The pace sentence («Para llegar: ~3 libros por semana»), or null when there is none. */
  line: string | null;
};

export type GoalAchievedInWeek = { id: string; title: string; href: string; achievedAt: string };

/** What was logged on a manual goal within the week. */
export type GoalEntriesInWeek = {
  goalId: string;
  title: string;
  unit: string;
  /** Entries not undone, by the Lima day logged. */
  count: number;
  /** The sum of their deltas. */
  total: number;
};

export type GoalsWeekReview = {
  /** The Monday of the week read. */
  weekStart: string;
  /**
   * The goals in the works: active, not deleted, whose year or quarter is going on today (Lima).
   * Their reading and pace are as of today, the same as /goals (decisión autónoma para revisar con
   * el owner: the pace is a next step from now, not a photo of that week).
   */
  active: GoalWeekReviewItem[];
  /** Goals achieved within the week (their `achieved_at` on one of its Lima days). */
  achieved: GoalAchievedInWeek[];
  /** Entries logged within the week (by `entry_date`), per goal. */
  entries: GoalEntriesInWeek[];
};

const DAY_MS = 86_400_000;

function addDays(day: string, days: number): string {
  return new Date(new Date(`${day}T00:00:00Z`).getTime() + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** The Monday of the week of a real day. */
function mondayOfDay(day: string): string {
  return addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
}

function assertDay(value: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value
  ) {
    throw new RangeError("weekStart must be a day as YYYY-MM-DD");
  }
}

/**
 * The goals review of the week of `weekStart` (any day of it; the result names its Monday) as of
 * `now`. Reading the goals achieves, once, the habit and project goals whose source reached the
 * target (what /goals does on every read). Trusts its caller (see getGoalsWeekReview).
 */
export async function selectGoalsWeekReview(
  db: Database,
  weekStart: string,
  now: Date,
): Promise<GoalsWeekReview> {
  assertDay(weekStart);
  const monday = mondayOfDay(weekStart);
  const sunday = addDays(monday, 6);
  const today = ownerDateKey(now);
  const items = await selectVisibleGoals(db, now);
  const active = items
    .filter((goal) => goal.status === "active" && periodPhase(periodOf(goal), today) === "current")
    .map((goal): GoalWeekReviewItem => {
      const reading = readGoal(goal, today);
      const base = {
        id: goal.id,
        title: goal.title,
        href: goalPath(goal.id),
        sourceKind: goal.sourceKind,
        target: goal.target,
        unit: unitOf(goal),
      };
      if (reading.kind === "unavailable") {
        return {
          ...base,
          value: null,
          count: null,
          ratio: 0,
          paceState: "unavailable",
          perWeekNeeded: null,
          line: reading.line,
        };
      }
      return {
        ...base,
        value: reading.value,
        count: reading.count,
        ratio: reading.ratio,
        paceState: reading.pace?.kind ?? "none",
        perWeekNeeded: reading.pace?.kind === "next-step" ? reading.pace.perWeekNeeded : null,
        line: reading.line,
      };
    });
  const achieved = items
    .filter(
      (goal) =>
        goal.status === "achieved" &&
        goal.achievedAt !== null &&
        ownerDateKey(new Date(goal.achievedAt)) >= monday &&
        ownerDateKey(new Date(goal.achievedAt)) <= sunday,
    )
    .map((goal): GoalAchievedInWeek => ({
      id: goal.id,
      title: goal.title,
      href: goalPath(goal.id),
      achievedAt: goal.achievedAt as string,
    }));
  const rows = await db
    .select({
      goalId: goals.id,
      title: goals.title,
      unit: goals.unit,
      count: sql<number>`count(*)::int`.mapWith(Number),
      total: sql<number>`coalesce(sum(${goalEntries.delta}), 0)::int`.mapWith(Number),
    })
    .from(goalEntries)
    .innerJoin(goals, eq(goals.id, goalEntries.goalId))
    .where(
      and(
        isNull(goals.deletedAt),
        isNull(goalEntries.deletedAt),
        sql`${goalEntries.entryDate} between ${monday}::date and ${sunday}::date`,
      ),
    )
    .groupBy(goals.id, goals.title, goals.unit, goals.position)
    .orderBy(asc(goals.position), asc(goals.id));
  return {
    weekStart: monday,
    active,
    achieved,
    entries: rows.map((row) => ({ ...row, unit: row.unit ?? "" })),
  };
}

/**
 * For `weekly-review`: the goals in the works with their pace, the ones achieved within the week
 * and the entries logged in it. Checks the owner (redirects to /login without one).
 */
export async function getGoalsWeekReview(
  weekStart: string,
  now: Date = new Date(),
): Promise<GoalsWeekReview> {
  await requireOwner();
  return selectGoalsWeekReview(getDb(), weekStart, now);
}

/**
 * For `weekly-review`: the objective of the week starting `weekStart` (a Monday), or null when
 * none was set or the value isn't a Monday. Checks the owner.
 */
export async function getWeeklyObjectiveForWeek(
  weekStart: string,
): Promise<WeeklyObjectiveItem | null> {
  return getWeeklyObjective(weekStart);
}

export type SetWeeklyObjectiveForWeekResult =
  { ok: true; change: WeeklyObjectiveChange } | { ok: false; error: string };

/**
 * For `weekly-review`: sets (or replaces) the objective of the week starting `weekStart` (a
 * Monday), the same text /goals shows, through the same domain function and week lock as the
 * `setWeeklyObjective` action. The text is normalized and validated like there (1–140); an
 * invalid week or text answers `ok: false` with the message, never throws. The change carries
 * the text it replaced. Checks the owner and revalidates /goals.
 */
export async function setWeeklyObjectiveForWeek(
  weekStart: string,
  text: string,
): Promise<SetWeeklyObjectiveForWeekResult> {
  await requireOwner();
  const parsed = setWeeklyObjectiveInputSchema.safeParse({ weekStart, text });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "" };
  const change = await upsertWeeklyObjective(getDb(), parsed.data);
  revalidateWeeklyObjective();
  return { ok: true, change };
}
