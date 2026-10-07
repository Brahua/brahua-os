// User-facing copy of recurring payments (F2, Spanish). Never guilt: "Venció hace 3 días" in the
// signal color, never "atrasado" or red (docs/principios-ux.md, "Lo que no haremos").
import { RECURRING_NAME_MAX_LENGTH, RECURRING_NOTES_MAX_LENGTH } from "./finance-constants";
import type { PaymentCycle } from "./finance-constants";
import { daysBetween, isoWeekday, UPCOMING_DAYS, type Schedule } from "./schedule";

/** ISO weekday names (1 = lunes), lowercase as they read inside a sentence. */
export const WEEKDAY_NAMES: Record<number, string> = {
  1: "lunes",
  2: "martes",
  3: "miércoles",
  4: "jueves",
  5: "viernes",
  6: "sábado",
  7: "domingo",
};

const WEEKDAY_SHORT: Record<number, string> = {
  1: "lun",
  2: "mar",
  3: "mié",
  4: "jue",
  5: "vie",
  6: "sáb",
  7: "dom",
};

/** Month names (1 = enero), lowercase; es-PE says "setiembre". */
export const MONTH_NAMES: Record<number, string> = {
  1: "enero",
  2: "febrero",
  3: "marzo",
  4: "abril",
  5: "mayo",
  6: "junio",
  7: "julio",
  8: "agosto",
  9: "setiembre",
  10: "octubre",
  11: "noviembre",
  12: "diciembre",
};

const MONTH_SHORT: Record<number, string> = {
  1: "ene",
  2: "feb",
  3: "mar",
  4: "abr",
  5: "may",
  6: "jun",
  7: "jul",
  8: "ago",
  9: "set",
  10: "oct",
  11: "nov",
  12: "dic",
};

export const CYCLE_LABELS: Record<PaymentCycle, string> = {
  weekly: "Semanal",
  monthly: "Mensual",
  every_n_months: "Cada N meses",
  yearly: "Anual",
};

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** "1 cuota", "6 cuotas". */
export const installmentsCount = (total: number) => (total === 1 ? "1 cuota" : `${total} cuotas`);

/** "Cuota 3 de 6": the installment a due date is. */
export const installmentLabel = (installment: { number: number; total: number }) =>
  `Cuota ${installment.number} de ${installment.total}`;

/**
 * The cycle in words: "Semanal, lunes", "Mensual, día 15", "Mensual, día 15 · 6 cuotas",
 * "Cada 3 meses, día 5", "Anual, 23 mar".
 */
export function cycleSummary(schedule: Omit<Schedule, "startDate">): string {
  switch (schedule.cycle) {
    case "weekly":
      return `Semanal, ${WEEKDAY_NAMES[schedule.weekday ?? 1]}`;
    case "monthly":
      return `Mensual, día ${schedule.dayOfMonth}${
        schedule.installmentsTotal ? ` · ${installmentsCount(schedule.installmentsTotal)}` : ""
      }`;
    case "every_n_months":
      return `Cada ${schedule.intervalMonths} meses, día ${schedule.dayOfMonth}`;
    case "yearly":
      return `Anual, ${schedule.dayOfMonth} ${MONTH_SHORT[schedule.anchorMonth ?? 1]}`;
  }
}

/** "jue 9 oct" for a YYYY-MM-DD day. */
export function shortDay(day: string): string {
  return `${WEEKDAY_SHORT[isoWeekday(day)]} ${Number(day.slice(8, 10))} ${MONTH_SHORT[Number(day.slice(5, 7))]}`;
}

/** "jueves 9 de octubre" for a YYYY-MM-DD day: a date as screen readers and sentences say it. */
export function spokenDay(day: string): string {
  return `${WEEKDAY_NAMES[isoWeekday(day)]} ${Number(day.slice(8, 10))} de ${MONTH_NAMES[Number(day.slice(5, 7))]}`;
}

/** "Jueves 9 de octubre de 2026" for a YYYY-MM-DD day. */
export function longDay(day: string): string {
  return capitalize(
    `${WEEKDAY_NAMES[isoWeekday(day)]} ${Number(day.slice(8, 10))} de ${MONTH_NAMES[Number(day.slice(5, 7))]} de ${day.slice(0, 4)}`,
  );
}

export type DueState = {
  kind: "overdue" | "today" | "soon" | "later";
  /** Days to the due date (overdue: days since it). */
  days: number;
  /** What the row shows: "Vence el jue 9". */
  label: string;
  /** The same in words, for screen readers: "Vence el jueves 9". */
  spoken: string;
};

/**
 * A due date as the lists say it, by Lima's day: "Venció hace 3 días", "Venció ayer", "Vence
 * hoy", "Vence mañana", "Vence el jue 9" (within a week) or "Vence el 23 mar"; `spoken` says the
 * short ones in full ("Vence el jueves 9", "Vence el 23 de marzo").
 */
export function dueState(dueOn: string, today: string): DueState {
  const left = daysBetween(today, dueOn);
  const plain = (kind: DueState["kind"], days: number, text: string): DueState => ({
    kind,
    days,
    label: text,
    spoken: text,
  });
  if (left < -1) return plain("overdue", -left, `Venció hace ${-left} días`);
  if (left === -1) return plain("overdue", 1, "Venció ayer");
  if (left === 0) return plain("today", 0, "Vence hoy");
  if (left === 1) return plain("soon", 1, "Vence mañana");
  const day = Number(dueOn.slice(8, 10));
  const weekday = isoWeekday(dueOn);
  if (left <= UPCOMING_DAYS) {
    return {
      kind: "soon",
      days: left,
      label: `Vence el ${WEEKDAY_SHORT[weekday]} ${day}`,
      spoken: `Vence el ${WEEKDAY_NAMES[weekday]} ${day}`,
    };
  }
  const month = Number(dueOn.slice(5, 7));
  return {
    kind: "later",
    days: left,
    label: `Vence el ${day} ${MONTH_SHORT[month]}`,
    spoken: `Vence el ${day} de ${MONTH_NAMES[month]}`,
  };
}

/** Overdue and due today call for attention: the signal color with a LED (never red). */
export const isUrgent = (state: DueState) => state.kind === "overdue" || state.kind === "today";

export const PAYMENTS_COPY = {
  // Sections of "Pagos"
  pendingHeading: "Pendientes",
  pendingEmpty: "Nada pendiente: no hay pagos vencidos ni que venzan en los próximos 7 días.",
  monthHeading: (month: string) => `Este mes · ${month}`,
  monthEmpty: "Ningún pago recurrente activo.",
  allHeading: "Todos",
  allEmpty: "Todavía no hay pagos recurrentes. Crea el primero con «Nuevo pago recurrente».",
  archivedHeading: (count: number) => `Archivados (${count})`,
  newPayment: "Nuevo pago recurrente",
  variable: "Monto variable",
  noMethod: "Sin medio de pago",
  nextDue: (label: string) => `Próximo: ${label}`,
  nextDueSpoken: (day: string) => `próximo vencimiento el ${day}`,
  dueSpoken: (day: string) => `vence el ${day}`,

  // "Este mes" statuses
  statusPaid: (amount: string) => `Pagado · ${amount}`,
  statusPaidSpoken: (amount: string) => `pagado, ${amount}`,
  statusPaidNow: "Pagado",
  statusPending: "Pendiente",
  statusSkipped: "Omitido",
  statusNotThisMonth: "No toca este mes",

  // Pending row
  pay: "Pagado",
  payNamed: (name: string, due: string) => `Pagado: ${name}, ${due}`,
  payWithAmount: (name: string, due: string) => `Pagado, con monto: ${name}, ${due}`,
  moreActions: (name: string) => `Más acciones de ${name}`,

  // "Pagado…" sheet
  paySheetTitle: (name: string) => `Registrar pago de ${name}`,
  /** The period, in the tense of its due date: "venció el…" or "vence el…". */
  paySheetDescription: (day: string, past: boolean) =>
    past ? `Período que venció el ${day}.` : `Período que vence el ${day}.`,
  amountLabel: (currency: "PEN" | "USD") =>
    currency === "USD" ? "Monto pagado en dólares" : "Monto pagado en soles",
  dateLabel: "Fecha del pago",
  dateHelp: "El gasto cuenta en el mes de esta fecha.",
  methodLabel: "Medio de pago",
  confirmPay: "Registrar pago",
  paying: "Registrando…",
  skip: "Omitir este período",
  skipHelp: "Sale de pendientes sin registrar gasto. Puedes deshacerlo.",
  close: "Cerrar",

  // Notices
  paidTitle: "Pago registrado",
  paidText: (name: string, amount: string) => `${name} · ${amount}`,
  skippedTitle: "Período omitido",
  skippedText: (name: string, due: string) => `${name} · ${due}`,
  undo: "Deshacer",
  /** The last installment closed the payment: said in the notice of the pay or the skip. */
  lastInstallmentText: (name: string) => `Última cuota de «${name}». Se archiva solo.`,
  undonePaid: (name: string) => `Se quitó el pago de ${name}: vuelve a pendientes.`,
  undonePaidReopened: (name: string) =>
    `Se quitó el pago de ${name}: vuelve a pendientes y el pago se reactivó.`,
  undonePaidArchived: (name: string) =>
    `Se quitó el pago de ${name}. El pago sigue archivado: reactívalo para verlo en pendientes.`,
  undoneSkipArchived: (name: string) =>
    `${name} vuelve a sus cuotas, pero el pago sigue archivado: reactívalo para verlo en pendientes.`,
  undoneSkip: (name: string) => `${name} vuelve a pendientes.`,
  undoneSkipReopened: (name: string) => `${name} vuelve a pendientes y el pago se reactivó.`,
  notPaid: "No se pudo registrar el pago.",
  notSkipped: "No se pudo omitir el período.",
  notUndone: "No se pudo deshacer.",
  notSavedTitle: "Sin guardar",
  checkConnection: "Revisa tu conexión e inténtalo de nuevo.",

  // Recurring sheet
  newTitle: "Nuevo pago recurrente",
  editTitle: "Editar pago recurrente",
  nameLabel: "Nombre",
  nameHelp: "Por ejemplo, «Internet» o «Seguro».",
  dueLegend: "Vencimiento",
  cycleLabel: "Ciclo",
  weekdayLabel: "Día de la semana",
  dayOfMonthLabel: "Día del mes",
  dayOfMonthHelp: "Del 29 al 31: en los meses más cortos, el último día.",
  intervalLabel: "Cada cuántos meses",
  intervalOption: (n: number) => `Cada ${n} meses`,
  anchorLabel: "Desde el mes",
  yearMonthLabel: "Mes",
  installmentsLabel: "Termina después de N pagos (opcional)",
  installmentsHelp:
    "Para una compra en cuotas. Vacío: no termina. Al pagar la última, el pago se archiva solo.",
  endedLabel: "Terminado",
  noMoreDues: "Ya no quedan vencimientos: se agotaron las cuotas.",
  amountFieldLabel: (currency: "PEN" | "USD") =>
    currency === "USD" ? "Monto previsto en dólares" : "Monto previsto en soles",
  amountHelp: "Con punto o coma para los decimales.",
  variableLabel: "Monto variable",
  variableHelp: "Al pagarlo, la hoja pide el monto (luz, agua…).",
  currencyLabel: "Moneda",
  currencyPEN: "Soles",
  currencyUSD: "Dólares",
  categoryLabel: "Categoría",
  noCategory: "Sin categoría",
  startLabel: "Desde",
  startHelp: "El primer vencimiento que cuenta es el primero desde esta fecha.",
  notesLabel: "Notas (opcional)",
  save: "Guardar",
  saving: "Guardando…",
  savingStatus: "Guardando el pago recurrente…",
  created: (name: string) => `Se creó «${name}».`,
  saved: (name: string) => `Se guardó «${name}».`,

  // Page
  pageTitle: (name: string) => `${name} · Finanzas · brahua-os`,
  backToPayments: "Volver a Finanzas",
  facts: "Datos",
  cycleFact: "Ciclo",
  amountFact: "Monto",
  methodFact: "Medio de pago",
  categoryFact: "Categoría",
  startFact: "Desde",
  notesFact: "Notas",
  archivedBadge: "Archivado",
  nextHeading: "Próximos vencimientos",
  historyHeading: "Historial",
  historyEmpty: "Todavía no hay períodos pagados ni omitidos.",
  historyPaid: (amount: string, day: string) => `Pagado ${amount} el ${day}`,
  historyPaidSpoken: (amount: string, day: string) => `Pagado, ${amount}, el ${day}`,
  historyDueSpoken: (day: string) => `período que vencía el ${day}`,
  historySkipped: "Omitido",
  historyDue: (day: string) => `Vencía el ${day}`,
  edit: "Editar",
  archive: "Archivar",
  archiveHelp: "Deja de aparecer en pendientes. Sus pagos pasados siguen en el resumen.",
  reactivate: "Reactivar",
  delete: "Eliminar",
  deleteHelp: "Sus gastos pasados se quedan, con su nombre. Puedes deshacerlo desde el aviso.",
  archivedNotice: (name: string) => `Se archivó «${name}».`,
  reactivatedNotice: (name: string) => `Se reactivó «${name}».`,
  deletedTitle: "Pago recurrente eliminado",
  restored: (name: string) => `«${name}» volvió.`,
  notFoundTitle: "Pago no encontrado · brahua-os",
  notFoundLcd: "SIN PAGO",
  notFoundHeading: "Este pago recurrente no existe",
  notFoundText: "Puede que se haya eliminado. Vuelve a Finanzas para ver los demás.",
  viewPayment: "Ver el pago recurrente",
} as const;

export const RECURRING_ERRORS = {
  nameRequired: "Escribe el nombre.",
  nameTooLong: `Usa ${RECURRING_NAME_MAX_LENGTH} caracteres como máximo.`,
  nameInvisible: "Quita los caracteres invisibles o de control del nombre.",
  notesTooLong: `Usa ${RECURRING_NOTES_MAX_LENGTH} caracteres como máximo.`,
  notesInvisible: "Quita los caracteres invisibles o de control de las notas.",
  cycle: "Elige un ciclo.",
  weekday: "Elige un día de la semana.",
  dayOfMonth: "Elige un día del 1 al 31.",
  intervalMonths: "Elige cada cuántos meses (de 2 a 12).",
  anchorMonth: "Elige un mes.",
  installmentsRange: "Escribe un número entero de cuotas, del 1 al 120.",
  installmentsCycle: "Las cuotas solo se pueden usar con el ciclo mensual.",
  installmentsTooLow: (min: number) =>
    `Ya hay ${min} cuotas pagadas u omitidas: escribe ${min} o más.`,
  installmentsScheduleLocked:
    "Con cuotas ya pagadas u omitidas no se puede cambiar el día ni el inicio: quita las cuotas, guarda y cámbialo.",
  installmentsKeepMonthly:
    "Este pago tiene cuotas y solo puede ser mensual: quita las cuotas antes de cambiar el ciclo.",
  installmentsDone: "Ya no quedan cuotas de este pago. Sube el número de cuotas para reactivarlo.",
  startInvalid: "Esa fecha no es válida.",
  startOutOfRange: "La fecha debe estar entre 2000 y 2100.",
  amountRequired: "Escribe el monto o marca «Monto variable».",
  notFound: "Este pago recurrente ya no existe (se eliminó).",
  categoryUnavailable: "Esa categoría ya no está disponible (se archivó o no existe). Elige otra.",
  methodUnavailable:
    "Ese medio de pago ya no está disponible (se archivó o no existe). Elige otro.",
  archived: "Este pago está archivado: reactívalo primero.",
  notDue: "Ese período no está pendiente (ya no vence en esa fecha o está fuera de la ventana).",
  alreadyPaid: "Ya estaba pagado.",
  alreadySkipped: "Ese período ya estaba omitido.",
  notSettled: "Ese período ya no estaba pagado ni omitido.",
  variableNeedsAmount: "Este pago es de monto variable: escribe el monto.",
  periodTaken:
    "No se pudo restaurar: ese período del pago recurrente ya se pagó o se omitió de nuevo.",
} as const;
