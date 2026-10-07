// Natural-language capture ("polish → capture-nl-dates"): a deterministic Spanish parser for the
// text typed in a quick capture, shared by the capture sheets and (with `reminders`) the Telegram
// bot. PURE: no DOM, no `Intl`, no process clock and no time zone of the host. It receives the
// instant (`now`) and reads the owner's day in America/Lima by arithmetic (Lima is a fixed UTC-5
// since 1994: no daylight saving), so a server in UTC and a phone agree. No dependencies, no AI.
//
// Contract (documented in docs/HANDOFF.md):
//   parseTaskText(text, now, { skipDate? }) -> { title, dueDate, dueTime, interpreted }
//   parseExpenseText(text)                  -> { description, amountCents, currency, interpreted }
// Neither throws. When nothing is interpreted, the title/description is the text trimmed with
// single spaces, and every other field is null.
//
// Rules against false positives (ante la duda, no interpretar):
//  - Only tokens at the START or the END of the text are read (never in the middle), at most one
//    date and one time per text; if they would leave the title empty, nothing is interpreted.
//  - A bare number is not a time or a date ("comprar 3 pilas"): a time needs a colon ("16:30"),
//    am/pm ("10am") or "a las"; a date needs a name ("mañana", "vie"), a month ("15 oct"), a
//    slash ("15/10") or "en N días". "el 15" alone only counts in a short text (≤ 5 words).

export type NaturalCurrency = "PEN" | "USD";

export type TaskTextResult = {
  /** The text without what was interpreted (never empty: if all of it were a date, it stays). */
  title: string;
  /** YYYY-MM-DD (Lima), or null. With `skipDate`, always null. */
  dueDate: string | null;
  /** HH:MM (24 h), or null. Valid for `createTask` only together with a date. */
  dueTime: string | null;
  /** The raw pieces taken out of the text, in the order they were found. */
  interpreted: string[];
};

export type ExpenseTextResult = {
  description: string;
  /** Whole cents (never a float), 1 … 100 000 000, or null. */
  amountCents: number | null;
  /** The currency the text carried ("S/", "USD", "$" = USD), or null: the method's default. */
  currency: NaturalCurrency | null;
  interpreted: string[];
};

// ---------------------------------------------------------------------------------------------
// Lima calendar by arithmetic

const LIMA_OFFSET_MS = -5 * 60 * 60 * 1000;

type Day = { y: number; m: number; d: number };
type Today = Day & { dow: number; minutes: number };

function limaNow(now: Date): Today {
  const shifted = new Date(now.getTime() + LIMA_OFFSET_MS);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth() + 1,
    d: shifted.getUTCDate(),
    dow: shifted.getUTCDay(),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

const pad = (value: number, width = 2) => String(value).padStart(width, "0");
const keyOf = ({ y, m, d }: Day) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

function addDays({ y, m, d }: Day, days: number): Day {
  const moved = new Date(Date.UTC(y, m - 1, d + days));
  return { y: moved.getUTCFullYear(), m: moved.getUTCMonth() + 1, d: moved.getUTCDate() };
}

const compareDays = (a: Day, b: Day) => a.y - b.y || a.m - b.m || a.d - b.d;

// ---------------------------------------------------------------------------------------------
// Words

/** Lowercase, no accents ("Mañana" → "manana"), no trailing punctuation, "p.m." → "pm". */
function normalizeWord(word: string): string {
  const plain = word
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.,;:!?]+$/, "");
  return /^[ap]\.m$/.test(plain) ? plain.replace(".", "") : plain;
}

const MAX_PHRASE_WORDS = 5;
/** Left hanging when a date goes: "pilas para mañana" → "pilas". */
const DANGLING = new Set(["para", "el", "este", "proximo", "en", "a", "de"]);

function cleanTitle(words: string[], dropDangling: boolean): string {
  const kept = [...words];
  if (dropDangling) {
    while (kept.length > 1 && DANGLING.has(normalizeWord(kept[kept.length - 1]!))) kept.pop();
  }
  return kept
    .join(" ")
    .replace(/[\s,;:-]+$/, "")
    .trim();
}

const splitWords = (text: string) => text.split(/\s+/).filter(Boolean);

// ---------------------------------------------------------------------------------------------
// Task text: dates and times

const WEEKDAYS: Record<string, number> = {
  domingo: 0,
  dom: 0,
  lunes: 1,
  lun: 1,
  martes: 2, // "mar" is left out on purpose: it is also "sea"
  miercoles: 3,
  mie: 3,
  jueves: 4,
  jue: 4,
  viernes: 5,
  vie: 5,
  sabado: 6,
  sab: 6,
};

const MONTHS: Record<string, number> = {
  enero: 1,
  ene: 1,
  febrero: 2,
  feb: 2,
  marzo: 3, // no "mar"
  abril: 4,
  abr: 4,
  mayo: 5,
  may: 5,
  junio: 6,
  jun: 6,
  julio: 7,
  jul: 7,
  agosto: 8,
  ago: 8,
  septiembre: 9,
  setiembre: 9,
  sept: 9,
  sep: 9,
  set: 9,
  octubre: 10,
  oct: 10,
  noviembre: 11,
  nov: 11,
  diciembre: 12,
  dic: 12,
};
const MONTH_NAMES = Object.keys(MONTHS).join("|");
const WEEKDAY_NAMES = Object.keys(WEEKDAYS).join("|");

type DateSpec =
  | { kind: "offset"; days: number }
  | { kind: "weekday"; dow: number }
  | { kind: "monthDay"; day: number }
  | { kind: "fullDate"; day: number; month: number; year: number | null };

type Piece = { kind: "date"; spec: DateSpec } | { kind: "time"; minutes: number };

const MAX_OFFSET_DAYS = 730;

function matchTime(phrase: string): Piece | null {
  let hour: number;
  let minute: number;
  let meridiem: string | undefined;
  const prefixed = /^a (las|la) (\d{1,2})(?::([0-5]\d))?(?: ?(am|pm))?$/.exec(phrase);
  const clock = /^(\d{1,2}):([0-5]\d)(?: ?(am|pm))?$/.exec(phrase);
  const meridian = /^(\d{1,2}) ?(am|pm)$/.exec(phrase);
  if (prefixed) {
    // "a la 1" is the only singular.
    if (prefixed[1] === "la" && prefixed[2] !== "1") return null;
    hour = Number(prefixed[2]);
    minute = Number(prefixed[3] ?? 0);
    meridiem = prefixed[4];
  } else if (clock) {
    hour = Number(clock[1]);
    minute = Number(clock[2]);
    meridiem = clock[3];
  } else if (meridian) {
    hour = Number(meridian[1]);
    minute = 0;
    meridiem = meridian[2];
  } else {
    return null;
  }
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem === "pm" ? 12 : 0);
  } else if (hour > 23) {
    return null;
  }
  return { kind: "time", minutes: hour * 60 + minute };
}

/** The 29th of February is valid (some year has it); the 31st of April is not. */
function validDayMonth(day: number, month: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(2024, month);
}

function matchDate(phrase: string, totalWords: number): Piece | null {
  const date = (spec: DateSpec): Piece => ({ kind: "date", spec });
  if (phrase === "hoy") return date({ kind: "offset", days: 0 });
  if (phrase === "manana") return date({ kind: "offset", days: 1 });
  if (phrase === "pasado manana") return date({ kind: "offset", days: 2 });

  const weekday = new RegExp(`^(?:(?:el|este|proximo) )?(${WEEKDAY_NAMES})$`).exec(phrase);
  if (weekday) return date({ kind: "weekday", dow: WEEKDAYS[weekday[1]!]! });

  const relative = /^en (\d{1,3}) (dias?|semanas?)$/.exec(phrase);
  if (relative) {
    const count = Number(relative[1]) * (relative[2]!.startsWith("semana") ? 7 : 1);
    return count >= 1 && count <= MAX_OFFSET_DAYS ? date({ kind: "offset", days: count }) : null;
  }

  const named = new RegExp(
    `^(?:el )?(\\d{1,2})(?: de)? (${MONTH_NAMES})(?: (?:de )?(\\d{4}))?$`,
  ).exec(phrase);
  if (named) {
    const month = MONTHS[named[2]!]!;
    const day = Number(named[1]);
    if (!validDayMonth(day, month)) return null;
    return date({ kind: "fullDate", day, month, year: named[3] ? Number(named[3]) : null });
  }

  const slashed = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?$/.exec(phrase);
  if (slashed) {
    const day = Number(slashed[1]);
    const month = Number(slashed[2]);
    if (!validDayMonth(day, month)) return null;
    const year = slashed[3] ? Number(slashed[3]) + (slashed[3].length === 2 ? 2000 : 0) : null;
    return date({ kind: "fullDate", day, month, year });
  }

  // "el 15" alone: only in a short text, never inside a long title.
  const bare = /^el (\d{1,2})$/.exec(phrase);
  if (bare && totalWords <= MAX_PHRASE_WORDS) {
    const day = Number(bare[1]);
    return day >= 1 && day <= 31 ? date({ kind: "monthDay", day }) : null;
  }
  return null;
}

function matchPiece(phrase: string, totalWords: number, skipDate: boolean): Piece | null {
  return matchTime(phrase) ?? (skipDate ? null : matchDate(phrase, totalWords));
}

/** The calendar day a date phrase means, from Lima's `today`. */
function resolveDate(spec: DateSpec, today: Today, timeMinutes: number | null): Day | null {
  switch (spec.kind) {
    case "offset":
      return addDays(today, spec.days);
    case "weekday": {
      let delta = (spec.dow - today.dow + 7) % 7;
      // Today is that weekday: with an hour still ahead it is today; otherwise (decisión autónoma
      // para revisar con el owner) the same weekday of next week, never a date already past.
      if (delta === 0 && !(timeMinutes !== null && timeMinutes > today.minutes)) delta = 7;
      return addDays(today, delta);
    }
    case "monthDay": {
      // The next day with that number, today included; a month too short for it is skipped.
      for (let step = 0; step < 14; step += 1) {
        const index = today.m - 1 + step;
        const y = today.y + Math.floor(index / 12);
        const m = (index % 12) + 1;
        if (spec.day > daysInMonth(y, m)) continue;
        const candidate = { y, m, d: spec.day };
        if (compareDays(candidate, today) >= 0) return candidate;
      }
      return null;
    }
    case "fullDate": {
      if (spec.year !== null) {
        return spec.day <= daysInMonth(spec.year, spec.month)
          ? { y: spec.year, m: spec.month, d: spec.day }
          : null;
      }
      // The next time that day comes (today included); a 29th of February waits for a leap year.
      for (let year = today.y; year <= today.y + 8; year += 1) {
        if (spec.day > daysInMonth(year, spec.month)) continue;
        const candidate = { y: year, m: spec.month, d: spec.day };
        if (compareDays(candidate, today) >= 0) return candidate;
      }
      return null;
    }
  }
}

const timeKey = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

/**
 * Reads the date and hour at the edges of a task's text.
 *
 * Decisiones autónomas para revisar con el owner:
 *  - A weekday that is today moves to next week, unless an hour still ahead is also given.
 *  - An hour with no day: today if it is still ahead in Lima, otherwise tomorrow.
 *  - "el 15" / "15 oct" / "15/10": the next such day, today included.
 *  - "a las 5" is 05:00 (24 h, as typed); only "pm" makes it 17:00. The preview shows the result.
 *  - `skipDate`: date words stay in the title (the owner picked a day by hand); an hour is still
 *    read and returned with `dueDate: null`, for the caller to pair with the day it already has.
 */
export function parseTaskText(
  text: string,
  now: Date,
  options: { skipDate?: boolean } = {},
): TaskTextResult {
  const skipDate = options.skipDate ?? false;
  const words = splitWords(text);
  const none: TaskTextResult = {
    title: words.join(" "),
    dueDate: null,
    dueTime: null,
    interpreted: [],
  };
  if (words.length === 0) return none;

  const norm = words.map(normalizeWord);
  const found: { date: DateSpec | null; minutes: number | null } = { date: null, minutes: null };
  const interpreted: string[] = [];
  let lo = 0;
  let hi = words.length;

  // Tries the phrases at one edge, longest first; true when one was taken.
  const takeAt = (edge: "end" | "start"): boolean => {
    const room = Math.min(MAX_PHRASE_WORDS, hi - lo);
    for (let length = room; length >= 1; length -= 1) {
      const from = edge === "end" ? hi - length : lo;
      const to = from + length;
      const piece = matchPiece(norm.slice(from, to).join(" "), words.length, skipDate);
      if (!piece) continue;
      if (piece.kind === "date") {
        if (found.date) continue;
        found.date = piece.spec;
      } else {
        if (found.minutes !== null) continue;
        found.minutes = piece.minutes;
      }
      interpreted.push(words.slice(from, to).join(" "));
      if (edge === "end") hi = from;
      else lo = to;
      return true;
    }
    return false;
  };

  // The end first (the usual place), then the start, until nothing else is taken.
  while (takeAt("end") || takeAt("start")) {
    // Each pass takes one piece; at most one date and one hour, so this ends in two.
  }
  if (interpreted.length === 0) return none;

  const today = limaNow(now);
  let dueDate: string | null = null;
  if (found.date) {
    const day = resolveDate(found.date, today, found.minutes);
    if (!day) return none;
    dueDate = keyOf(day);
  } else if (found.minutes !== null && !skipDate) {
    dueDate = keyOf(addDays(today, found.minutes > today.minutes ? 0 : 1));
  }
  const title = cleanTitle(words.slice(lo, hi), true);
  if (title === "") return none;
  return {
    title,
    dueDate,
    dueTime: found.minutes === null ? null : timeKey(found.minutes),
    interpreted,
  };
}

// ---------------------------------------------------------------------------------------------
// Short day for the preview

const SHORT_WEEKDAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"] as const;
const SHORT_MONTHS = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "set",
  "oct",
  "nov",
  "dic",
] as const;

/**
 * "vie 10 oct" for a YYYY-MM-DD day; with the year when it is not `todayKey`'s ("vie 15 ene 2027").
 * By arithmetic, like the parser (no `Intl`).
 */
export function formatShortDay(key: string, todayKey: string): string {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const year = String(y) === todayKey.slice(0, 4) ? "" : ` ${y}`;
  return `${SHORT_WEEKDAYS[dow]} ${d} ${SHORT_MONTHS[m - 1]}${year}`;
}

/** Lima's day of an instant as YYYY-MM-DD, by arithmetic (the parser's own "today"). */
export function limaDayKey(now: Date): string {
  return keyOf(limaNow(now));
}

// ---------------------------------------------------------------------------------------------
// Expense text: amount and currency

const MAX_AMOUNT_CENTS = 100_000_000;

const AMOUNT_PATTERN =
  /^(?:(s\/\.?|us\$|usd|\$|pen)\s?)?(\d{1,7})(?:[.,](\d{1,2}))?(?:\s?(usd|pen|soles|sol|dolares|dolar))?$/;

type AmountPiece = { cents: number; currency: NaturalCurrency | null; decimals: boolean };

function currencyOf(marker: string): NaturalCurrency {
  // Decisión autónoma para revisar con el owner: "$" is USD (in Peru, soles are "S/").
  return marker.startsWith("s/") || marker === "pen" || marker.startsWith("sol") ? "PEN" : "USD";
}

function matchAmount(phrase: string): AmountPiece | null {
  const match = AMOUNT_PATTERN.exec(phrase);
  if (!match) return null;
  const [, prefix, whole, fraction = "", suffix] = match;
  if (prefix && suffix) return null;
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (cents < 1 || cents > MAX_AMOUNT_CENTS) return null;
  const marker = prefix ?? suffix;
  return { cents, currency: marker ? currencyOf(marker) : null, decimals: fraction !== "" };
}

/**
 * The amount of an expense typed as text: "12.50 café", "café 12,50", "S/ 12 taxi", "USD 95 claude",
 * "$20 almuerzo", "taxi 15 soles". Only at the start or the end of the text, one amount, whole
 * cents by integer arithmetic. The best candidate wins: one with a currency, then one with
 * decimals, then a bare integer at the end, then at the start. "1,250" (3 decimals) is not read.
 * The description may be empty ("12.50" alone): an expense's description is optional.
 */
export function parseExpenseText(text: string): ExpenseTextResult {
  const words = splitWords(text);
  const none: ExpenseTextResult = {
    description: words.join(" "),
    amountCents: null,
    currency: null,
    interpreted: [],
  };
  if (words.length === 0) return none;
  const norm = words.map(normalizeWord);

  type Candidate = { piece: AmountPiece; from: number; to: number; rank: number };
  const candidates: Candidate[] = [];
  const consider = (from: number, to: number, atEnd: boolean) => {
    const piece = matchAmount(norm.slice(from, to).join(" "));
    if (!piece) return;
    const rank = piece.currency ? 4 : piece.decimals ? 3 : atEnd ? 2 : 1;
    candidates.push({ piece, from, to, rank });
  };
  for (let length = Math.min(3, words.length); length >= 1; length -= 1) {
    consider(words.length - length, words.length, true);
  }
  for (let length = Math.min(3, words.length); length >= 1; length -= 1) {
    consider(0, length, false);
  }
  // Highest rank; on a tie the first found (longer phrases come first at each edge).
  let best: Candidate | undefined;
  for (const candidate of candidates) if (!best || candidate.rank > best.rank) best = candidate;
  if (!best) return none;

  const rest = [...words.slice(0, best.from), ...words.slice(best.to)];
  return {
    description: cleanTitle(rest, false),
    amountCents: best.piece.cents,
    currency: best.piece.currency,
    interpreted: [words.slice(best.from, best.to).join(" ")],
  };
}
