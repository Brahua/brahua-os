// User-facing copy of a habit's frequency (H2, Spanish). Its own file so H3 and H4 never touch
// the same lines (HANDOFF "Cómo funciona habits" → "Slots").
import {
  HABIT_WEEKDAYS_MAX,
  HABIT_WEEKLY_TARGET_MAX,
  type HabitFrequency,
} from "./habit-constants";

export const FREQUENCY_ERRORS = {
  frequency: "Elige con qué frecuencia lo haces.",
  weeklyTarget: `Elige cuántas veces por semana: de 1 a ${HABIT_WEEKLY_TARGET_MAX}.`,
  weekdaysNone: "Elige al menos un día.",
  weekdaysAll: "Todos los días es «Diaria»: elígela en Frecuencia.",
  weekdaysInvalid: `Elige de 1 a ${HABIT_WEEKDAYS_MAX} días de la semana.`,
} as const;

/** ISO weekdays, Monday first. */
export const ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/** ISO weekday names, capitalized (the day keys' accessible names, the summary's first day). */
export const WEEKDAY_NAMES: Record<number, string> = {
  1: "Lunes",
  2: "Martes",
  3: "Miércoles",
  4: "Jueves",
  5: "Viernes",
  6: "Sábado",
  7: "Domingo",
};

/**
 * The day keys' visible labels: the first letters of each name, so the accessible name ("Lunes")
 * starts with what is seen (WCAG 2.5.3, Label in Name).
 */
export const WEEKDAY_SHORT: Record<number, string> = {
  1: "Lu",
  2: "Ma",
  3: "Mi",
  4: "Ju",
  5: "Vi",
  6: "Sá",
  7: "Do",
};

/** "a", "a y b", "a, b y c". */
function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

export const FREQUENCY_COPY = {
  label: "Frecuencia",
  options: {
    daily: "Diaria",
    weekly_count: "Por semana",
    weekdays: "Días fijos",
  } satisfies Record<HabitFrequency, string>,
  weeklyTargetLabel: "Veces por semana",
  weeklyTargetHelp: "Cualquier día de la semana cuenta.",
  weekdaysLabel: "Días",
  weekdaysHelp: "Aparece en «Hoy» solo esos días; los demás no cuentan.",

  // The summary ("Cada día · Sí o no")
  daily: "Cada día",
  timesAWeek: (times: number) => (times === 1 ? "1 vez por semana" : `${times} veces por semana`),
  /** "Lunes, miércoles y viernes": the first day capitalized, the rest lowercase. */
  weekdays: (days: readonly number[]) => {
    const names = days.map((day, index) =>
      index === 0 ? WEEKDAY_NAMES[day] : WEEKDAY_NAMES[day].toLowerCase(),
    );
    return listOf(names);
  },
  pickTimes: "Elige cuántas veces",
  pickDays: "Elige los días",

  // The pad (weekly_count)
  weekProgress: (done: number, quota: number) => `${done} de ${quota} esta semana`,
} as const;
