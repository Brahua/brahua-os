// Times of a session as the screens write and read them, in Lima (UTC−5 all year, no daylight
// saving: SPEC-core "Fechas"). Client-safe and pure.

const LIMA_OFFSET_MS = -5 * 60 * 60 * 1000;

/** An instant as a `datetime-local` value in Lima: «2026-11-04T18:05». */
export function toLimaInput(instant: string | number): string {
  const ms = typeof instant === "number" ? instant : Date.parse(instant);
  return new Date(ms + LIMA_OFFSET_MS).toISOString().slice(0, 16);
}

/** A `datetime-local` value in Lima as an instant (ms), or NaN. */
export function fromLimaInput(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return Number.NaN;
  return Date.parse(`${value}:00-05:00`);
}

const TIME = new Intl.DateTimeFormat("es-PE", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "America/Lima",
});

const DAY = new Intl.DateTimeFormat("es-PE", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "America/Lima",
});

/** «18:05». */
export function formatTimeOfDay(iso: string): string {
  return TIME.format(new Date(iso));
}

/** «mié., 4 nov.». */
export function formatSessionDay(iso: string): string {
  return DAY.format(new Date(iso));
}

/** Whole minutes between two instants (never negative). */
export function minutesBetween(fromIso: string, to: string | number): number {
  const end = typeof to === "number" ? to : Date.parse(to);
  return Math.max(0, Math.floor((end - Date.parse(fromIso)) / 60_000));
}

/** «52 min», «1 h 5 min», «2 h». */
export function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** The running time as a clock: «4:05» under an hour, «1:02:03» from there. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}
