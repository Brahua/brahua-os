// The cleaning of the home as tasks (SPEC-household "Decisiones"): a cleaning is a task of `tasks`
// tagged `limpieza` plus a zone tag (`zona: baño`). The tags are the only stable link, because
// completing a recurring task creates the next occurrence as another row that copies the tags.
// Pure and client-safe: frequencies become recurrence rules, tags become zones.
import { normalizeName } from "@/lib/text";
import type { TaskRecurrence } from "@/modules/tasks/contracts";

/** The tag that marks a task as a cleaning. */
export const CLEANING_TAG = "limpieza";
/** The prefix of a zone tag: `zona: baño`. */
export const ZONE_PREFIX = "zona: ";
/** The longest title a task takes (`tasks`: 200 characters). */
export const CLEANING_TITLE_MAX_LENGTH = 200;
/** The longest tag `tasks` takes, in characters. */
export const TAG_MAX_LENGTH = 30;
/** A zone is at most 24 characters: the tag holds 30 and the prefix takes 6. */
export const ZONE_MAX_LENGTH = 24;

/** The zones of the owner's Notion, offered as suggestions (any other name works too). */
export const SUGGESTED_ZONES = [
  "Dormitorio principal",
  "Oficina Antonella",
  "Baño",
  "Oficina Josue",
  "Cocina/Lavandería",
  "Balcón",
  "Sala/Comedor",
  "Todas",
] as const;

/** A zone name as typed: normalized text, no longer than a tag allows. */
export function normalizeZone(value: string): string {
  return normalizeName(value);
}

/** A zone's tag: lowercase, as `tasks` stores tags. */
export function zoneTagName(zone: string): string {
  return `${ZONE_PREFIX}${normalizeZone(zone).toLowerCase()}`;
}

/** The zone of a task's tags (without the prefix, lowercase), or null without one. */
export function zoneOfTags(tags: readonly string[]): string | null {
  const tag = tags.find((name) => name.startsWith(ZONE_PREFIX));
  const zone = tag?.slice(ZONE_PREFIX.length).trim();
  return zone ? zone : null;
}

/** A zone for the screen: the first letter in capitals ("dormitorio principal" → "Dormitorio…"). */
export function zoneLabel(zone: string): string {
  return zone.charAt(0).toLocaleUpperCase("es") + zone.slice(1);
}

/** How often a cleaning repeats (the Notion «Periodicidad»). */
export const FREQUENCIES = ["daily", "weekly", "biweekly", "monthly", "quarterly"] as const;
export type Frequency = (typeof FREQUENCIES)[number];

/**
 * The recurrence rule of a frequency, with `tasks`' own rules (no new ones): daily = every day,
 * weekly = some weekdays (ISO 1 = Monday … 7 = Sunday, sorted and without repeats), biweekly =
 * every 2 weeks, monthly = every month, quarterly = every 3 months. Every N counts from when the
 * cleaning is done (SPEC-tasks «Recurrencia»). `weekly` needs at least one weekday.
 */
export function recurrenceFor(
  frequency: Frequency,
  weekdays: readonly number[] = [],
): TaskRecurrence {
  const days = [...new Set(weekdays)].sort((a, b) => a - b);
  switch (frequency) {
    case "daily":
      return { kind: "every_days", interval: 1, weekdays: null, monthDay: null };
    case "weekly":
      if (days.length === 0) throw new RangeError("weekly needs at least one weekday");
      return { kind: "weekdays", interval: null, weekdays: days, monthDay: null };
    case "biweekly":
      return { kind: "every_weeks", interval: 2, weekdays: null, monthDay: null };
    case "monthly":
      return { kind: "every_months", interval: 1, weekdays: null, monthDay: null };
    case "quarterly":
      return { kind: "every_months", interval: 3, weekdays: null, monthDay: null };
  }
}

/** The frequency a stored rule came from, or null when it isn't one of the five. */
export function frequencyOf(rule: TaskRecurrence | null): Frequency | null {
  if (!rule) return null;
  if (rule.kind === "weekdays") return "weekly";
  if (rule.kind === "every_days" && rule.interval === 1) return "daily";
  if (rule.kind === "every_weeks" && rule.interval === 2) return "biweekly";
  if (rule.kind === "every_months" && rule.interval === 1) return "monthly";
  if (rule.kind === "every_months" && rule.interval === 3) return "quarterly";
  return null;
}

const DAY_MS = 86_400_000;

function parse(key: string): Date {
  return new Date(`${key}T00:00:00Z`);
}

function toKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** ISO weekday of a YYYY-MM-DD key: 1 = Monday … 7 = Sunday. */
export function isoWeekdayOf(key: string): number {
  const day = parse(key).getUTCDay();
  return day === 0 ? 7 : day;
}

/** The first day from `from` (inclusive) that is one of `weekdays` (ISO), as YYYY-MM-DD. */
export function nextWeekdayOnOrAfter(from: string, weekdays: readonly number[]): string {
  if (weekdays.length === 0) throw new RangeError("needs at least one weekday");
  const start = parse(from).getTime();
  for (let offset = 0; offset < 7; offset++) {
    const key = toKey(new Date(start + offset * DAY_MS));
    if (weekdays.includes(isoWeekdayOf(key))) return key;
  }
  throw new RangeError("unreachable");
}

/** The Sunday of the week of a day (a week runs Monday to Sunday). */
export function weekEndOf(day: string): string {
  return toKey(new Date(parse(day).getTime() + (7 - isoWeekdayOf(day)) * DAY_MS));
}
