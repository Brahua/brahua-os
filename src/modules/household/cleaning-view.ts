// How the cleaning is laid out (SPEC-household "Pantallas"): the same pending cleanings grouped by
// zone or by day, each with its frequency in words and when it comes up. Pure and client-safe;
// every day is a YYYY-MM-DD key in Lima (the page passes today's), so nothing depends on the host's
// time zone.
import type { TaggedTask } from "@/modules/tasks/contracts";
import { frequencyOf, SUGGESTED_ZONES, weekEndOf, zoneLabel, zoneOfTags } from "./cleaning";
import { CLEANING_COPY as COPY, WEEKDAY_NAMES } from "./cleaning-copy";

/** A pending cleaning as the screen reads it. */
export type CleaningItem = {
  id: string;
  title: string;
  /** A day in Lima, or null when the task has no date. */
  dueDate: string | null;
  /** The zone, lowercase, or null. */
  zone: string | null;
  /** «Cada semana, lunes», or null when the rule isn't one of the five frequencies. */
  frequency: string | null;
};

const dayName = new Intl.DateTimeFormat("es", { weekday: "long", day: "numeric", timeZone: "UTC" });

/** A day as «lunes 12». */
export function dayLabel(key: string): string {
  return dayName.format(new Date(`${key}T00:00:00Z`));
}

/** The frequency of a rule in words («Cada semana, lunes y jueves»), or null. */
export function frequencyText(rule: TaggedTask["recurrence"]): string | null {
  const frequency = frequencyOf(rule);
  if (!frequency) return null;
  if (frequency === "weekly" && rule?.weekdays) {
    const names = rule.weekdays.map((day) => WEEKDAY_NAMES[day - 1]);
    const list =
      names.length > 1 ? `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}` : names[0];
    return COPY.weeklyOn(list);
  }
  return COPY.frequencies[frequency];
}

export function toCleaningItem(task: TaggedTask): CleaningItem {
  return {
    id: task.id,
    title: task.title,
    dueDate: task.dueDate,
    zone: zoneOfTags(task.tags),
    frequency: frequencyText(task.recurrence),
  };
}

/** When a cleaning comes up: «toca hoy», «toca mañana», «toca el jueves 16», «desde el lunes 12». */
export function whenText(dueDate: string | null, today: string): string | null {
  if (dueDate === null) return null;
  if (dueDate === today) return COPY.dueToday;
  if (dueDate < today) return COPY.since(dayLabel(dueDate));
  const tomorrow = new Date(new Date(`${today}T00:00:00Z`).getTime() + 86_400_000)
    .toISOString()
    .slice(0, 10);
  return dueDate === tomorrow ? COPY.dueTomorrow : COPY.dueOn(dayLabel(dueDate));
}

/** Soonest date first, no date last, then by title (the same order the contract returns). */
function byDue(a: CleaningItem, b: CleaningItem): number {
  if (a.dueDate !== b.dueDate) {
    if (a.dueDate === null) return 1;
    if (b.dueDate === null) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  return a.title.localeCompare(b.title, "es");
}

export type ZoneGroup = {
  /** Lowercase zone, or null for «Sin zona». */
  zone: string | null;
  label: string;
  items: CleaningItem[];
  /** How many come up by this week's Sunday (the ones overdue included: nothing is hidden). */
  dueThisWeek: number;
};

/** The suggested zones first, in the owner's order; then any other by name; «Sin zona» last. */
function zoneRank(zone: string | null): [number, string] {
  if (zone === null) return [2, ""];
  const index = SUGGESTED_ZONES.findIndex((name) => name.toLocaleLowerCase("es") === zone);
  return index === -1 ? [1, zone] : [0, String(index).padStart(3, "0")];
}

export function groupByZone(items: readonly CleaningItem[], today: string): ZoneGroup[] {
  const weekEnd = weekEndOf(today);
  const groups = new Map<string | null, CleaningItem[]>();
  for (const item of items) groups.set(item.zone, [...(groups.get(item.zone) ?? []), item]);
  return [...groups.entries()]
    .sort(([a], [b]) => {
      const [rankA, keyA] = zoneRank(a);
      const [rankB, keyB] = zoneRank(b);
      return rankA - rankB || keyA.localeCompare(keyB, "es");
    })
    .map(([zone, list]) => ({
      zone,
      label: zone === null ? COPY.noZone : zoneLabel(zone),
      items: [...list].sort(byDue),
      dueThisWeek: list.filter((item) => item.dueDate !== null && item.dueDate <= weekEnd).length,
    }));
}

export type DayGroup =
  | { kind: "before"; label: string; items: CleaningItem[] }
  | { kind: "day"; day: string; label: string; items: CleaningItem[] }
  | { kind: "later"; label: string; items: CleaningItem[] }
  | { kind: "none"; label: string; items: CleaningItem[] };

/**
 * «De antes» (before today), then each day with something from today to this week's Sunday, then
 * «Más adelante» (after it) and «Sin fecha». A day with nothing is left out.
 */
export function groupByDay(items: readonly CleaningItem[], today: string): DayGroup[] {
  const weekEnd = weekEndOf(today);
  const sorted = [...items].sort(byDue);
  const groups: DayGroup[] = [];
  const before = sorted.filter((item) => item.dueDate !== null && item.dueDate < today);
  if (before.length) groups.push({ kind: "before", label: COPY.before, items: before });
  const days = new Map<string, CleaningItem[]>();
  for (const item of sorted) {
    if (item.dueDate !== null && item.dueDate >= today && item.dueDate <= weekEnd) {
      days.set(item.dueDate, [...(days.get(item.dueDate) ?? []), item]);
    }
  }
  for (const [day, list] of days) {
    groups.push({
      kind: "day",
      day,
      label: day === today ? `Hoy · ${dayLabel(day)}` : dayLabel(day),
      items: list,
    });
  }
  const later = sorted.filter((item) => item.dueDate !== null && item.dueDate > weekEnd);
  if (later.length) groups.push({ kind: "later", label: COPY.later, items: later });
  const none = sorted.filter((item) => item.dueDate === null);
  if (none.length) groups.push({ kind: "none", label: COPY.noDate, items: none });
  return groups;
}
