// User-facing copy of H3 (kind, measure, quantities and habits to avoid). Spanish, never guilt:
// a relapse is logged plainly, never in red, never "fallaste" (docs/principios-ux.md). Client-safe.
import { HABIT_UNIT_MAX_LENGTH } from "./habit-constants";

// Plain digits (no locale grouping): the same on the server and the client, and short on a pad.
const formatNumber = (value: number) => String(value);

export const MEASURE_ERRORS = {
  kind: "Elige si es un hábito a cumplir o a evitar.",
  measure: "Elige cómo se mide: sí o no, o una cantidad.",
  goalRequired: "Escribe la meta del día.",
  goalInvalid: "La meta es un número entero desde 1.",
  goalTooBig: "La meta puede ser hasta 10 000.",
  unitRequired: "Escribe la unidad (por ejemplo, «vasos» o «min»).",
  unitTooLong: `Usa ${HABIT_UNIT_MAX_LENGTH} caracteres como máximo.`,
  unitInvisible: "Quita los caracteres invisibles o de control de la unidad.",
  stepInvalid: "El paso es un número entero desde 1.",
  stepTooBig: "El paso no puede ser mayor que la meta.",
  avoidMeasure: "Un hábito a evitar se registra con sí o no.",
  avoidDaily: "Un hábito a evitar es diario.",
  quantityInvalid: "La cantidad es un número entero de 0 a 99 999.",
  deltaInvalid: "Esa cantidad no es válida.",
  notQuantity: "Este hábito se registra con sí o no, no con una cantidad.",
} as const;

export const MEASURE_COPY = {
  // The form (H3 slot "Tipo y Medición")
  kindLabel: "Tipo",
  kindBuild: "A cumplir",
  kindAvoid: "A evitar",
  measureLabel: "Medición",
  measureCheck: "Sí/No",
  measureQuantity: "Cantidad",
  avoidNote:
    "Un hábito a evitar se registra con sí o no, cada día: con un toque anotas una recaída y se cuentan los días sin ella.",
  goalLabel: "Meta del día",
  unitLabel: "Unidad",
  unitHelp: "Por ejemplo, «vasos», «min» o «páginas».",
  stepLabel: "Paso",
  stepHelp: "Lo que suma cada toque.",
  goalEditHelp: "Cuenta desde hoy: los días pasados conservan su meta.",
  editCheckNote:
    "Se registra con sí o no. La medición no cambia: para medir una cantidad, archívalo y crea otro.",
  editQuantityNote:
    "Se registra con una cantidad. La medición no cambia, pero sí la meta, el paso y la unidad.",
  severalTimes: "Varias veces al día",
  severalTimesHelp: "Para algo que haces más de una vez al día: cada toque suma 1.",
  summaryCheck: "Sí o no",
  summaryAvoid: "A evitar",
  /** "8 vasos", "30 min, de 5 en 5"; what is missing reads as "…". */
  summaryQuantity: (goal: number | null, unit: string | null, step: number | null) =>
    `${goal === null ? "…" : formatNumber(goal)} ${unit ?? "…"}${
      step === null ? "" : `, de ${formatNumber(step)} en ${formatNumber(step)}`
    }`,

  // The pad
  /** "3/8 VASOS": the pad's status line (mono, uppercase). */
  padQuantity: (quantity: number, target: number, unit: string) =>
    `${formatNumber(quantity)}/${formatNumber(target)} ${unit}`.toLocaleUpperCase("es-PE"),
  /** The quantity pad's description: what is logged and what a tap does. */
  padQuantityHelp: (quantity: number, target: number, unit: string, step: number) =>
    `${formatNumber(quantity)} de ${formatNumber(target)} ${unit}. Suma ${formatNumber(step)} cada vez.`,
  padClean: "SIN RECAÍDAS HOY",
  padSlipped: "RECAÍDA REGISTRADA HOY",
  /** The avoid pad's name: what a tap does, with the habit's (visible) name. */
  padAvoidName: (name: string) => `Registrar recaída: ${name}`,
  padAvoidHelp: (slipped: boolean) =>
    slipped ? "Recaída registrada hoy. Actívalo de nuevo para quitarla." : "Sin recaídas hoy.",

  // Logging a quantity
  addedTitle: "Sumado",
  reachedTitle: "Meta cumplida",
  /** "«Agua»: 4 de 8 vasos hoy. 2 de 3 hoy." */
  added: (name: string, quantity: number, target: number, unit: string, count: string) =>
    `«${name}»: ${formatNumber(quantity)} de ${formatNumber(target)} ${unit} hoy. ${count}.`,
  addedAgain: (name: string, quantity: number, target: number, unit: string) =>
    `«${name}» volvió a ${formatNumber(quantity)} de ${formatNumber(target)} ${unit}.`,
  notAdded: "No se pudo sumar.",

  // A habit to avoid
  slipTitle: "Recaída registrada",
  /** No guilt: it is noted, and the day goes on. */
  slip: (name: string, count: string) =>
    `Anotaste una recaída en «${name}». Cada día es un nuevo comienzo. ${count}.`,
  unslipTitle: "Recaída quitada",
  unslip: (name: string, count: string) => `«${name}» quedó sin recaídas hoy. ${count}.`,
  slipAgain: (name: string) => `La recaída en «${name}» volvió a quedar registrada.`,
  unslipAgain: (name: string) => `«${name}» volvió a quedar sin recaídas hoy.`,

  // "Ajustar el día" (options sheet and its sheet)
  adjustDay: "Ajustar el día",
  adjustHelp: "Escribe la cantidad exacta de hoy, o resta lo que sumaste de más.",
  adjustTitle: (name: string) => `Ajustar «${name}»`,
  quantityLabel: (unit: string) => `Cantidad (${unit})`,
  quantityGoal: (target: number, unit: string) => `Meta del día: ${formatNumber(target)} ${unit}.`,
  decrease: (step: number) => `Restar ${formatNumber(step)}`,
  increase: (step: number) => `Sumar ${formatNumber(step)}`,
  /** Said after −/+ ("4 vasos"). */
  nudged: (quantity: number, unit: string) => `${formatNumber(quantity)} ${unit}`,
  save: "Guardar",
  cancel: "Cancelar",
  adjustedTitle: "Ajustado",
  adjusted: (name: string, quantity: number, target: number, unit: string) =>
    `«${name}» quedó en ${formatNumber(quantity)} de ${formatNumber(target)} ${unit} hoy.`,
  notAdjusted: "No se pudo ajustar.",
} as const;
