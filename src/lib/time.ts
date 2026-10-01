// Time zone helpers (SPEC-core "Fechas"): the server runs in UTC, but the owner's day is
// America/Lima. Every helper takes the instant explicitly, so nothing depends on the host's
// time zone and tests can pass fixed dates.

export const OWNER_TIME_ZONE = "America/Lima";
const LOCALE = "es-PE";

const HOUR_FORMAT = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  hourCycle: "h23",
  timeZone: OWNER_TIME_ZONE,
});

const LONG_DATE_FORMAT = new Intl.DateTimeFormat(LOCALE, {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: OWNER_TIME_ZONE,
});

// en-CA formats as YYYY-MM-DD.
const DATE_KEY_FORMAT = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: OWNER_TIME_ZONE,
});

/** Hour of the day (0–23) in Lima. */
export function ownerHour(date: Date): number {
  const hour = HOUR_FORMAT.formatToParts(date).find((part) => part.type === "hour");
  return Number(hour?.value);
}

export type Greeting = "Buenos días" | "Buenas tardes" | "Buenas noches";

/** Días from 05:00, tardes from 12:00, noches from 19:00 (Lima time). */
export function greetingFor(date: Date): Greeting {
  const hour = ownerHour(date);
  if (hour >= 5 && hour < 12) return "Buenos días";
  if (hour >= 12 && hour < 19) return "Buenas tardes";
  return "Buenas noches";
}

/** "Miércoles, 30 de setiembre" in Lima time. */
export function formatLongDate(date: Date): string {
  const text = LONG_DATE_FORMAT.format(date);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const DAY_FORMATS = {
  // "3 de octubre de 2026"
  long: { day: "numeric", month: "long", year: "numeric" },
  // "3 oct. 2026"
  short: { day: "numeric", month: "short", year: "numeric" },
} as const satisfies Record<string, Intl.DateTimeFormatOptions>;

export type DayFormat = keyof typeof DAY_FORMATS;

const OWNER_DAY_FORMAT = {
  long: new Intl.DateTimeFormat(LOCALE, { ...DAY_FORMATS.long, timeZone: OWNER_TIME_ZONE }),
  short: new Intl.DateTimeFormat(LOCALE, { ...DAY_FORMATS.short, timeZone: OWNER_TIME_ZONE }),
};

// A YYYY-MM-DD day has no time zone: read and written as UTC so it never shifts.
const DATE_KEY_DAY_FORMAT = {
  long: new Intl.DateTimeFormat(LOCALE, { ...DAY_FORMATS.long, timeZone: "UTC" }),
  short: new Intl.DateTimeFormat(LOCALE, { ...DAY_FORMATS.short, timeZone: "UTC" }),
};

/** The day of an instant in Lima: "3 de octubre de 2026" (long) or "3 oct. 2026" (short). */
export function formatOwnerDay(date: Date, format: DayFormat = "long"): string {
  return OWNER_DAY_FORMAT[format].format(date);
}

/** A YYYY-MM-DD day (e.g. a project's due date) as "3 de octubre de 2026" or "3 oct. 2026". */
export function formatDateKey(key: string, format: DayFormat = "long"): string {
  return DATE_KEY_DAY_FORMAT[format].format(new Date(`${key}T00:00:00Z`));
}

/** Calendar day in Lima as YYYY-MM-DD, for `<time dateTime>` and as a day key. */
export function ownerDateKey(date: Date): string {
  return DATE_KEY_FORMAT.format(date);
}
