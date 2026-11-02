// How a track's page shows its sessions (L2): days, times and the weeks they group in. Pure and
// client-safe; every function takes its day or instant explicitly.
import { OWNER_TIME_ZONE, ownerDateKey } from "@/lib/time";
import { shortDay } from "./learning-copy";
import { addDays, isoWeekday, sessionWeek } from "./pace";
import type { SessionItem } from "./sessions-input";

const WEEKDAYS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

const CLOCK = new Intl.DateTimeFormat("es-PE", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: OWNER_TIME_ZONE,
});

/** «lun 2 nov» for a YYYY-MM-DD day (the year only when it isn't `today`'s). */
export function dayLabel(day: string, today?: string): string {
  return `${WEEKDAYS[isoWeekday(day) - 1]} ${shortDay(day, today)}`;
}

/** «Hoy», «Ayer» or «sáb 31 oct». */
export function relativeDay(day: string, today: string): string {
  if (day === today) return "Hoy";
  if (day === addDays(today, -1)) return "Ayer";
  return dayLabel(day, today);
}

/** The Lima time of an instant: «19:05». */
export function clockTime(instant: string): string {
  return CLOCK.format(new Date(instant));
}

/** The Lima day a session started on. */
export function sessionDay(session: Pick<SessionItem, "startedAt">): string {
  return ownerDateKey(new Date(session.startedAt));
}

export type SessionWeek = { weekStart: string; minutes: number; sessions: SessionItem[] };

/**
 * Sessions (newest first) grouped by the Lima week they started in, newest week first, each with
 * its total. Keeps the order of the sessions inside a week.
 */
export function groupByWeek(sessions: readonly SessionItem[]): SessionWeek[] {
  const weeks = new Map<string, SessionWeek>();
  for (const session of sessions) {
    const weekStart = sessionWeek(session.startedAt);
    const week = weeks.get(weekStart) ?? { weekStart, minutes: 0, sessions: [] };
    week.minutes += session.minutes;
    week.sessions.push(session);
    weeks.set(weekStart, week);
  }
  return [...weeks.values()].sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1));
}
