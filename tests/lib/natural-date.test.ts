// polish → capture-nl-dates: the pure parser of the quick capture's text. One big table per
// parser, a single aggregated assertion each (a mismatch list reads better than the first failure).
import { describe, expect, test } from "vitest";
import { parseAmount } from "@/modules/finance/money";
import {
  formatShortDay,
  limaDayKey,
  parseExpenseText,
  parseTaskText,
  type TaskTextResult,
} from "@/lib/natural-date";
import { ownerDateKey } from "@/lib/time";

/** A Lima wall-clock instant ("2026-10-07 10:00"; Lima is UTC-5 all year). */
const lima = (stamp: string) => new Date(`${stamp.replace(" ", "T")}:00-05:00`);

const WED = "2026-10-07 10:00"; // a Wednesday
const FRI = "2026-10-09 10:00";

type Row = [text: string, now: string, expected: Partial<TaskTextResult>];

const TASK_ROWS: Row[] = [
  // Relative days
  ["pilas mañana", WED, { title: "pilas", dueDate: "2026-10-08", dueTime: null }],
  ["Pilas Mañana", WED, { title: "Pilas", dueDate: "2026-10-08" }],
  ["PILAS MAÑANA", WED, { title: "PILAS", dueDate: "2026-10-08" }],
  ["pilas manana", WED, { title: "pilas", dueDate: "2026-10-08" }],
  ["  pilas   mañana  ", WED, { title: "pilas", dueDate: "2026-10-08" }],
  ["mañana pilas", WED, { title: "pilas", dueDate: "2026-10-08" }],
  ["pilas hoy", WED, { title: "pilas", dueDate: "2026-10-07" }],
  ["pilas pasado mañana", WED, { title: "pilas", dueDate: "2026-10-09" }],
  ["pilas para mañana", WED, { title: "pilas", dueDate: "2026-10-08" }],
  ["pilas, mañana", WED, { title: "pilas", dueDate: "2026-10-08" }],
  ["pilas mañana mañana", WED, { title: "pilas mañana", dueDate: "2026-10-08" }],
  ["pagar luz en 3 días", WED, { title: "pagar luz", dueDate: "2026-10-10" }],
  ["pagar luz en 3 dias", WED, { title: "pagar luz", dueDate: "2026-10-10" }],
  ["pagar luz en 2 semanas", WED, { title: "pagar luz", dueDate: "2026-10-21" }],
  ["en 1 día pagar luz", WED, { title: "pagar luz", dueDate: "2026-10-08" }],
  ["pagar luz en 1 semana", WED, { title: "pagar luz", dueDate: "2026-10-14" }],
  // Weekdays: the next one; today's weekday without an hour waits a week
  ["dentista vie", WED, { title: "dentista", dueDate: "2026-10-09" }],
  ["dentista viernes", WED, { title: "dentista", dueDate: "2026-10-09" }],
  ["dentista el viernes", WED, { title: "dentista", dueDate: "2026-10-09" }],
  ["dentista este viernes", WED, { title: "dentista", dueDate: "2026-10-09" }],
  ["dentista VIE", WED, { title: "dentista", dueDate: "2026-10-09" }],
  ["gym lun", WED, { title: "gym", dueDate: "2026-10-12" }],
  ["gym lunes", WED, { title: "gym", dueDate: "2026-10-12" }],
  ["gym martes", WED, { title: "gym", dueDate: "2026-10-13" }],
  ["gym mié", WED, { title: "gym", dueDate: "2026-10-14" }],
  ["gym miércoles", WED, { title: "gym", dueDate: "2026-10-14" }],
  ["gym jue", WED, { title: "gym", dueDate: "2026-10-08" }],
  ["gym sáb", WED, { title: "gym", dueDate: "2026-10-10" }],
  ["gym sábado", WED, { title: "gym", dueDate: "2026-10-10" }],
  ["gym dom", WED, { title: "gym", dueDate: "2026-10-11" }],
  ["gym vie", FRI, { title: "gym", dueDate: "2026-10-16" }],
  ["gym viernes", FRI, { title: "gym", dueDate: "2026-10-16" }],
  ["gym vie 5pm", FRI, { title: "gym", dueDate: "2026-10-09", dueTime: "17:00" }],
  ["gym vie 9am", FRI, { title: "gym", dueDate: "2026-10-16", dueTime: "09:00" }],
  ["gym sáb", "2026-10-10 08:00", { title: "gym", dueDate: "2026-10-17" }],
  // "mar" is not a weekday on its own
  ["ver el mar", WED, { title: "ver el mar", dueDate: null }],
  // Day of the month and named dates
  ["llamar al banco el 15", WED, { title: "llamar al banco", dueDate: "2026-10-15" }],
  ["pagar luz el 7", WED, { title: "pagar luz", dueDate: "2026-10-07" }],
  ["pagar luz el 6", WED, { title: "pagar luz", dueDate: "2026-11-06" }],
  ["el 15 pagar luz", WED, { title: "pagar luz", dueDate: "2026-10-15" }],
  ["pagar luz 15 oct", WED, { title: "pagar luz", dueDate: "2026-10-15" }],
  ["pagar luz 15 OCT", WED, { title: "pagar luz", dueDate: "2026-10-15" }],
  ["pagar luz el 15 de octubre", WED, { title: "pagar luz", dueDate: "2026-10-15" }],
  ["pagar luz 15 de octubre", WED, { title: "pagar luz", dueDate: "2026-10-15" }],
  ["pagar luz 15/10", WED, { title: "pagar luz", dueDate: "2026-10-15" }],
  ["pagar luz 1/10", WED, { title: "pagar luz", dueDate: "2027-10-01" }],
  ["pagar luz 7 oct", WED, { title: "pagar luz", dueDate: "2026-10-07" }],
  ["pagar luz 6 oct", WED, { title: "pagar luz", dueDate: "2027-10-06" }],
  ["pagar luz 15/10/2027", WED, { title: "pagar luz", dueDate: "2027-10-15" }],
  ["pagar luz 15/10/27", WED, { title: "pagar luz", dueDate: "2027-10-15" }],
  ["pagar luz 3 set", WED, { title: "pagar luz", dueDate: "2027-09-03" }],
  ["pagar luz 3 setiembre", WED, { title: "pagar luz", dueDate: "2027-09-03" }],
  ["pagar luz 10 dic 2026", WED, { title: "pagar luz", dueDate: "2026-12-10" }],
  ["pagar luz 29 feb", WED, { title: "pagar luz", dueDate: "2028-02-29" }],
  // Impossible dates are not interpreted
  ["pagar luz 31/4", WED, { title: "pagar luz 31/4", dueDate: null }],
  ["pagar luz 30 feb", WED, { title: "pagar luz 30 feb", dueDate: null }],
  ["pagar luz 15/13", WED, { title: "pagar luz 15/13", dueDate: null }],
  ["pagar luz 0/10", WED, { title: "pagar luz 0/10", dueDate: null }],
  ["pagar luz 29 feb 2027", WED, { title: "pagar luz 29 feb 2027", dueDate: null }],
  // Hours
  ["reunión 10:30", WED, { title: "reunión", dueDate: "2026-10-07", dueTime: "10:30" }],
  ["reunión 9:30", WED, { title: "reunión", dueDate: "2026-10-08", dueTime: "09:30" }],
  ["reunión 10:00", WED, { title: "reunión", dueDate: "2026-10-08", dueTime: "10:00" }],
  ["reunión a las 11", WED, { title: "reunión", dueDate: "2026-10-07", dueTime: "11:00" }],
  ["reunión a las 9", WED, { title: "reunión", dueDate: "2026-10-08", dueTime: "09:00" }],
  ["reunión a las 11:15", WED, { title: "reunión", dueDate: "2026-10-07", dueTime: "11:15" }],
  ["a las 11 reunión", WED, { title: "reunión", dueDate: "2026-10-07", dueTime: "11:00" }],
  ["reunión a la 1", WED, { title: "reunión", dueDate: "2026-10-08", dueTime: "01:00" }],
  ["reunión a la 2", WED, { title: "reunión a la 2", dueDate: null }],
  ["reunión 4pm", WED, { title: "reunión", dueDate: "2026-10-07", dueTime: "16:00" }],
  ["reunión 4 pm", WED, { title: "reunión", dueDate: "2026-10-07", dueTime: "16:00" }],
  ["reunión 4 p.m.", WED, { title: "reunión", dueDate: "2026-10-07", dueTime: "16:00" }],
  ["reunión 4:15PM", WED, { title: "reunión", dueDate: "2026-10-07", dueTime: "16:15" }],
  ["reunión 10 pm", WED, { title: "reunión", dueDate: "2026-10-07", dueTime: "22:00" }],
  ["reunión 12am", WED, { title: "reunión", dueDate: "2026-10-08", dueTime: "00:00" }],
  ["reunión 12pm", WED, { title: "reunión", dueDate: "2026-10-07", dueTime: "12:00" }],
  ["reunión 16:30", WED, { title: "reunión", dueDate: "2026-10-07", dueTime: "16:30" }],
  ["reunión 00:15", WED, { title: "reunión", dueDate: "2026-10-08", dueTime: "00:15" }],
  ["reunión 13pm", WED, { title: "reunión 13pm", dueTime: null }],
  ["reunión 0am", WED, { title: "reunión 0am", dueTime: null }],
  ["reunión 25:00", WED, { title: "reunión 25:00", dueTime: null }],
  ["reunión 10:75", WED, { title: "reunión 10:75", dueTime: null }],
  ["reunión a las 24", WED, { title: "reunión a las 24", dueTime: null }],
  // Date and hour together
  ["dentista vie 10am", WED, { title: "dentista", dueDate: "2026-10-09", dueTime: "10:00" }],
  ["dentista mañana 10:30", WED, { title: "dentista", dueDate: "2026-10-08", dueTime: "10:30" }],
  ["dentista mié 3pm", WED, { title: "dentista", dueDate: "2026-10-07", dueTime: "15:00" }],
  ["dentista mié 9am", WED, { title: "dentista", dueDate: "2026-10-14", dueTime: "09:00" }],
  ["10am dentista mañana", WED, { title: "dentista", dueDate: "2026-10-08", dueTime: "10:00" }],
  ["mañana 10am dentista", WED, { title: "dentista", dueDate: "2026-10-08", dueTime: "10:00" }],
  ["dentista hoy 8am", WED, { title: "dentista", dueDate: "2026-10-07", dueTime: "08:00" }],
  [
    "dentista a las 10 am mañana",
    WED,
    { title: "dentista", dueDate: "2026-10-08", dueTime: "10:00" },
  ],
  ["pagar luz 15 oct 10:30", WED, { title: "pagar luz", dueDate: "2026-10-15", dueTime: "10:30" }],
  [
    "pagar luz 15/10 a las 4 pm",
    WED,
    { title: "pagar luz", dueDate: "2026-10-15", dueTime: "16:00" },
  ],
  // Month and year changes
  ["x mañana", "2026-10-31 10:00", { title: "x", dueDate: "2026-11-01" }],
  ["x en 2 días", "2026-10-31 10:00", { title: "x", dueDate: "2026-11-02" }],
  ["x el 31", "2026-10-31 10:00", { title: "x", dueDate: "2026-10-31" }],
  ["x el 30", "2026-10-31 10:00", { title: "x", dueDate: "2026-11-30" }],
  ["x el 31", "2026-11-30 10:00", { title: "x", dueDate: "2026-12-31" }],
  ["x el 30", "2027-01-31 10:00", { title: "x", dueDate: "2027-03-30" }],
  ["x el 29", "2027-02-10 10:00", { title: "x", dueDate: "2027-03-29" }],
  ["x mañana", "2026-12-31 10:00", { title: "x", dueDate: "2027-01-01" }],
  ["x en 1 semana", "2026-12-31 10:00", { title: "x", dueDate: "2027-01-07" }],
  ["x 1 ene", "2026-12-31 10:00", { title: "x", dueDate: "2027-01-01" }],
  ["x 31 dic", "2026-12-31 10:00", { title: "x", dueDate: "2026-12-31" }],
  ["x mañana", "2028-02-28 10:00", { title: "x", dueDate: "2028-02-29" }],
  ["x mañana", "2027-02-28 10:00", { title: "x", dueDate: "2027-03-01" }],
  ["x mañana", "2028-02-29 10:00", { title: "x", dueDate: "2028-03-01" }],
  ["x 29/2", "2026-10-07 10:00", { title: "x", dueDate: "2028-02-29" }],
  ["x en 30 días", "2026-01-31 10:00", { title: "x", dueDate: "2026-03-02" }],
  // Lima's day, not UTC's: 22:00 in Lima is already tomorrow in UTC
  ["x hoy", "2026-10-07 22:00", { title: "x", dueDate: "2026-10-07" }],
  ["x mañana", "2026-10-07 22:00", { title: "x", dueDate: "2026-10-08" }],
  ["x hoy", "2026-10-07 23:59", { title: "x", dueDate: "2026-10-07" }],
  ["x hoy", "2026-10-08 00:00", { title: "x", dueDate: "2026-10-08" }],
  ["x mañana", "2026-10-08 00:00", { title: "x", dueDate: "2026-10-09" }],
  ["x mañana", "2026-12-31 23:30", { title: "x", dueDate: "2027-01-01" }],
  ["x 23:59", "2026-10-07 23:58", { title: "x", dueDate: "2026-10-07", dueTime: "23:59" }],
  ["x 23:59", "2026-10-07 23:59", { title: "x", dueDate: "2026-10-08", dueTime: "23:59" }],
  ["x 00:30", "2026-10-07 23:50", { title: "x", dueDate: "2026-10-08", dueTime: "00:30" }],
  ["x 00:30", "2026-10-08 00:10", { title: "x", dueDate: "2026-10-08", dueTime: "00:30" }],
  ["x 8am", "2026-10-08 00:00", { title: "x", dueDate: "2026-10-08", dueTime: "08:00" }],
  // Not a date or an hour: the title does not change
  ["comprar 3 pilas", WED, { title: "comprar 3 pilas", dueDate: null, dueTime: null }],
  ["comprar 3 pilas mañana", WED, { title: "comprar 3 pilas", dueDate: "2026-10-08" }],
  ["comprar pilas", WED, { title: "comprar pilas", dueDate: null }],
  ["llamar mañana al banco", WED, { title: "llamar mañana al banco", dueDate: null }],
  ["revisar hoy el correo", WED, { title: "revisar hoy el correo", dueDate: null }],
  ["leer capítulo 10", WED, { title: "leer capítulo 10", dueDate: null }],
  ["llamar a las 5 amigas", WED, { title: "llamar a las 5 amigas", dueDate: null }],
  ["tarea del 15 de marzo del año pasado en el cole", WED, { dueDate: null }],
  [
    "llamar al banco para consultar la tarjeta el 15",
    WED,
    { title: "llamar al banco para consultar la tarjeta el 15", dueDate: null },
  ],
  ["  comprar   pilas  ", WED, { title: "comprar pilas", dueDate: null }],
  ["", WED, { title: "", dueDate: null }],
  ["   ", WED, { title: "", dueDate: null }],
  // The title is never empty: all-date text stays as the title
  ["mañana", WED, { title: "mañana", dueDate: null }],
  ["hoy", WED, { title: "hoy", dueDate: null }],
  ["viernes 10am", WED, { title: "viernes 10am", dueDate: null, dueTime: null }],
  ["el 15", WED, { title: "el 15", dueDate: null }],
  ["15 oct", WED, { title: "15 oct", dueDate: null }],
  ["10am", WED, { title: "10am", dueTime: null }],
  ["pasado mañana", WED, { title: "pasado mañana", dueDate: null }],
];

describe("parseTaskText", () => {
  test("the table of cases (Lima's day, midnight, month and year changes, false positives)", () => {
    const mismatches: string[] = [];
    for (const [text, nowStamp, expected] of TASK_ROWS) {
      const actual = parseTaskText(text, lima(nowStamp));
      for (const key of Object.keys(expected) as (keyof TaskTextResult)[]) {
        if (JSON.stringify(actual[key]) !== JSON.stringify(expected[key])) {
          mismatches.push(
            `${JSON.stringify(text)} @ ${nowStamp} · ${key}: ${JSON.stringify(actual[key])} ≠ ${JSON.stringify(expected[key])}`,
          );
        }
      }
    }
    expect(mismatches).toEqual([]);
  }, 20_000);

  test("it reports what it took out of the text, and nothing when it took nothing", () => {
    expect(parseTaskText("dentista vie 10am", lima(WED)).interpreted).toEqual(["10am", "vie"]);
    expect(parseTaskText("comprar 3 pilas", lima(WED)).interpreted).toEqual([]);
  });

  test("skipDate: the date words stay in the title; an hour is still read, with no date", () => {
    const now = lima(WED);
    expect(parseTaskText("pilas mañana", now, { skipDate: true })).toMatchObject({
      title: "pilas mañana",
      dueDate: null,
      dueTime: null,
    });
    expect(parseTaskText("pilas mañana 10am", now, { skipDate: true })).toMatchObject({
      title: "pilas mañana",
      dueDate: null,
      dueTime: "10:00",
    });
  });

  test("it does not read the process clock or time zone: the same instant gives the same answer", () => {
    const now = lima("2026-10-07 22:30");
    const first = parseTaskText("x mañana 8am", now);
    const second = parseTaskText("x mañana 8am", new Date(now.getTime()));
    expect(first).toEqual(second);
    expect(first).toMatchObject({ dueDate: "2026-10-08", dueTime: "08:00" });
  });

  test("Lima's day by arithmetic equals the Intl day of the app, across four years", () => {
    const mismatches: string[] = [];
    const start = Date.UTC(2026, 0, 1);
    for (let step = 0; step < 4 * 366 * 8; step += 1) {
      const instant = new Date(start + step * 3 * 60 * 60 * 1000);
      if (limaDayKey(instant) !== ownerDateKey(instant)) mismatches.push(instant.toISOString());
    }
    expect(mismatches).toEqual([]);
  }, 30_000);
});

describe("formatShortDay", () => {
  test("weekday, day and month, with the year only when it is another one", () => {
    expect(formatShortDay("2026-10-09", "2026-10-07")).toBe("vie 9 oct");
    expect(formatShortDay("2026-10-10", "2026-10-07")).toBe("sáb 10 oct");
    expect(formatShortDay("2027-01-15", "2026-12-20")).toBe("vie 15 ene 2027");
  });
});

type ExpenseRow = [
  text: string,
  expected: { description?: string; amountCents: number | null; currency?: "PEN" | "USD" | null },
];

const EXPENSE_ROWS: ExpenseRow[] = [
  ["12.50 café", { description: "café", amountCents: 1250, currency: null }],
  ["café 12,50", { description: "café", amountCents: 1250, currency: null }],
  ["café 12.5", { description: "café", amountCents: 1250 }],
  ["café 12", { description: "café", amountCents: 1200 }],
  ["12 café", { description: "café", amountCents: 1200 }],
  ["  12,50   café  con leche ", { description: "café con leche", amountCents: 1250 }],
  ["S/ 12 taxi", { description: "taxi", amountCents: 1200, currency: "PEN" }],
  ["s/12.50 taxi", { description: "taxi", amountCents: 1250, currency: "PEN" }],
  ["S/. 12,50 taxi", { description: "taxi", amountCents: 1250, currency: "PEN" }],
  ["taxi S/ 8", { description: "taxi", amountCents: 800, currency: "PEN" }],
  ["USD 95 claude", { description: "claude", amountCents: 9500, currency: "USD" }],
  ["usd 95.99 claude", { description: "claude", amountCents: 9599, currency: "USD" }],
  ["claude 95 usd", { description: "claude", amountCents: 9500, currency: "USD" }],
  ["$20 almuerzo", { description: "almuerzo", amountCents: 2000, currency: "USD" }],
  ["$ 20 almuerzo", { description: "almuerzo", amountCents: 2000, currency: "USD" }],
  ["almuerzo $20.5", { description: "almuerzo", amountCents: 2050, currency: "USD" }],
  ["taxi 15 soles", { description: "taxi", amountCents: 1500, currency: "PEN" }],
  ["taxi 1 sol", { description: "taxi", amountCents: 100, currency: "PEN" }],
  ["almuerzo 20 dólares", { description: "almuerzo", amountCents: 2000, currency: "USD" }],
  ["3 cafés 12.50", { description: "3 cafés", amountCents: 1250 }],
  ["12.50", { description: "", amountCents: 1250 }],
  ["0.01 propina", { description: "propina", amountCents: 1 }],
  ["1000000 casa", { description: "casa", amountCents: 100_000_000 }],
  ["1000001 casa", { description: "1000001 casa", amountCents: null }],
  // Not an amount
  ["café", { description: "café", amountCents: null, currency: null }],
  ["", { description: "", amountCents: null }],
  ["0 café", { description: "0 café", amountCents: null }],
  ["café 1,250", { description: "café 1,250", amountCents: null }],
  ["café 12.505", { description: "café 12.505", amountCents: null }],
  ["café 10000001", { description: "café 10000001", amountCents: null }],
  ["café 12 y 5 propina", { description: "café 12 y 5 propina", amountCents: null }],
  ["S/ USD 12 café", { description: "S/ USD 12 café", amountCents: null }],
];

describe("parseExpenseText", () => {
  test("the table of cases", () => {
    const mismatches: string[] = [];
    for (const [text, expected] of EXPENSE_ROWS) {
      const actual = parseExpenseText(text);
      for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
        if (actual[key] !== expected[key]) {
          mismatches.push(
            `${JSON.stringify(text)} · ${key}: ${JSON.stringify(actual[key])} ≠ ${JSON.stringify(expected[key])}`,
          );
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  test("cents agree with finance's parseAmount for every typed shape", () => {
    const mismatches: string[] = [];
    for (let whole = 0; whole <= 400; whole += 1) {
      for (const fraction of ["", "5", "05", "50", "99"]) {
        for (const separator of [".", ","]) {
          const typed = fraction ? `${whole}${separator}${fraction}` : String(whole);
          const reference = parseAmount(typed);
          const parsed = parseExpenseText(`${typed} café`);
          const expected = reference.ok ? reference.value : null;
          if (parsed.amountCents !== expected) {
            mismatches.push(`${typed}: ${parsed.amountCents} ≠ ${expected}`);
          }
        }
      }
    }
    expect(mismatches).toEqual([]);
  }, 20_000);
});
