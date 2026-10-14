// Small helpers shared by the parsers: text that is safe to store and days that can be real.

/** Control characters (NUL included: Postgres refuses it) become spaces; runs of spaces collapse. */
export function cleanText(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A `YYYY-MM-DD` the owner could have spent on: 2000 to 2100 (Postgres also refuses year 0000). */
export function isPlausibleDay(day: string): boolean {
  const year = Number(day.slice(0, 4));
  return year >= 2000 && year <= 2100;
}
