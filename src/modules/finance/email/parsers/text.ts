// Small helpers shared by the parsers: text that is safe to store and days that can be real.

/**
 * Gmail's plain body marks what is bold in the HTML with asterisks (`*PARAMOUNT+*`): the markers around
 * a value are not part of it. Only the ends are trimmed; one inside (`DLC*helphbomaxcom`) stays.
 */
export function stripBoldMarkers(value: string): string {
  return value.replace(/^[\s*]+|[\s*]+$/g, "");
}

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

const MONTHS: Record<string, string> = {
  enero: "01",
  febrero: "02",
  marzo: "03",
  abril: "04",
  mayo: "05",
  junio: "06",
  julio: "07",
  agosto: "08",
  septiembre: "09",
  setiembre: "09",
  octubre: "10",
  noviembre: "11",
  diciembre: "12",
};

const SPANISH_DAY = /(\d{1,2})\s+(?:de\s+)?([a-záéíóú]+),?\s+(?:de\s+)?(\d{4})/i;

/**
 * The day of a Spanish long date: «14 de octubre de 2026 - 12:10 AM», «11 de Octubre de 2026»,
 * «12 octubre 2026 - 07:36 p. m.», «04 octubre, 2026 09:51», «14 de octubre, 2026 02:04». Only the day
 * is read (the banks already write Lima's clock, so the time never moves it). Null for anything else.
 */
export function parseSpanishDay(raw: string): string | null {
  const match = SPANISH_DAY.exec(raw);
  if (!match) return null;
  const month = MONTHS[match[2].toLowerCase()];
  if (!month) return null;
  const day = `${match[3]}-${month}-${match[1].padStart(2, "0")}`;
  // A calendar check (31 de febrero must not pass): the date round-trips through UTC.
  if (new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) return null;
  return isPlausibleDay(day) ? day : null;
}

/**
 * The day written after `label` (a regex for «Fecha y hora»…), whatever separates them: a pipe, a
 * tab, a line break or nothing (Gmail's plain body flattens an HTML table in its own way and the
 * layout is not ours to count on). Without the label, the first Spanish date of the text.
 */
export function dayAfter(text: string, label: RegExp): string | null {
  const match = label.exec(text);
  if (match) {
    const near = parseSpanishDay(
      text.slice(match.index + match[0].length, match.index + match[0].length + 120),
    );
    if (near) return near;
  }
  return parseSpanishDay(text);
}
