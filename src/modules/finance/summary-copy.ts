// Copy of the month's summary (F3, SPEC-finance "Resumen"). Only the data: no comparisons, no
// "gastaste más", no red (docs/principios-ux.md, "Lo que no haremos").
import { formatMoney, spokenMoney } from "./money";

const PERCENT = new Intl.NumberFormat("es-PE", { style: "percent", maximumFractionDigits: 0 });

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export const SUMMARY_COPY = {
  // Header and its arrows
  previousMonth: (month: string) => `Mes anterior, ${month}`,
  nextMonth: (month: string) => `Mes siguiente, ${month}`,
  /** The next arrow on the current month (it stays focusable, aria-disabled). */
  noNextMonth: "Mes siguiente: este es el mes actual",
  noPreviousMonth: "Mes anterior: no hay meses antes de 2000",
  totalLabel: "Total del mes",
  /** Said after the arrows bring another month. */
  monthShown: (month: string, total: string) => `${month}: ${total} en total.`,

  // Context line under the total (finance-motion M2): neutral, never red or green.
  spent: "Gastado",
  dayOf: (day: number, total: number) => `Día ${day} de ${total}`,
  /** `samePoint`: the month is still going, so it is compared up to today's day number. */
  deltaVs: (percent: number, direction: "up" | "down" | "same", samePoint: boolean) => {
    const base = samePoint ? "mes anterior al mismo punto del mes" : "mes anterior";
    if (direction === "same") return `Igual que el ${base}`;
    return `${direction === "up" ? "+" : "−"}${percent} % vs. ${base}`;
  },
  deltaSpoken: (percent: number, direction: "up" | "down" | "same", samePoint: boolean) => {
    const base = samePoint ? "el mes anterior al mismo punto del mes" : "el mes anterior";
    if (direction === "same") return `Igual que ${base}`;
    return `${percent} por ciento ${direction === "up" ? "más" : "menos"} que ${base}`;
  },
  /** USD without a rate is left out of the comparison: said when there is any. */
  deltaExcludesUsd: "La comparación no incluye dólares sin convertir.",
  /** A segment of the stacked bar: the same toggle as its row in the list, named as the bar. */
  segmentLabel: (name: string, amount: string) => `Barra, ${name}: ${amount}`,
  dayTotalSpoken: (amount: string) => `Total del día: ${amount}`,
  nextPayment: (day: string) => `próximo ${day}`,

  // USD without a rate
  unconverted: (usd: string) => `+ ${usd} sin convertir`,
  unconvertedSpoken: (usd: string) => `y ${usd} sin convertir`,
  setRate: "Fijar tipo de cambio",

  // "Pendiente de pagar" (F2's recurring payments due this month)
  pendingTitle: "Pendiente de pagar",
  pendingCount: (count: number) => plural(count, "pago", "pagos"),
  pendingLabel: (amount: string, count: number) =>
    `Pendiente de pagar: ${amount}, ${plural(count, "pago", "pagos")}. Ver pendientes`,
  /** Payments without an amount: counted, never summed ("+ 1 de monto variable"). */
  pendingVariable: (count: number, afterAmount: boolean) =>
    `${afterAmount ? "+ " : ""}${count} de monto variable`,
  pendingVariableSpoken: (count: number, afterAmount: boolean) =>
    `${afterAmount ? "y " : ""}${count} de monto variable`,

  // Blocks
  byCategory: "Por categoría",
  byMethod: "Por medio de pago",
  split: "Recurrente y suelto",
  /** The one card with the methods and the recurring / one-off split. */
  mixHeading: "Cómo se pagó",
  recurring: "Recurrente",
  oneOff: "Suelto",
  uncategorized: "Sin categoría",
  noMethod: "Sin medio de pago",
  /** The bars filter the list: said once under the heading. */
  categoryHint: "Toca una categoría para ver solo sus gastos.",
  smallPercent: "< 1%",
  percent: (value: number) => PERCENT.format(value / 100),
  spokenPercent: (value: number | null) =>
    value === null ? null : value === 0 ? "menos de 1 por ciento" : `${value} por ciento`,

  // The list and its filter
  listHeading: "Gastos del mes",
  filteredBy: (name: string) => `Solo ${name}`,
  expenses: (count: number) => plural(count, "gasto", "gastos"),
  clearFilter: "Quitar filtro",
  filterOn: (name: string, count: number) =>
    `Lista filtrada por ${name}: ${plural(count, "gasto", "gastos")}.`,
  filterOff: (count: number) => `Sin filtro: ${plural(count, "gasto", "gastos")} del mes.`,
  /** Said when the filter goes away because its category has nothing left this month. */
  emptyFiltered: (name: string) => `Ya no quedan gastos de ${name} este mes: se quitó el filtro.`,
  /** Said when an expense of another category arrives while the list is filtered. */
  filterClearedByNew: (name: string, count: number) =>
    `Se quitó el filtro de ${name} para mostrar el gasto nuevo: ${plural(count, "gasto", "gastos")} del mes.`,
} as const;

/** "S/ 1,250.00" plus, if any, the unconverted USD: what a total shows. */
export function moneyTotalText(penCents: number, unconvertedUsdCents: number): string {
  const pen = formatMoney(penCents, "PEN");
  return unconvertedUsdCents > 0
    ? `${pen} ${SUMMARY_COPY.unconverted(formatMoney(unconvertedUsdCents, "USD"))}`
    : pen;
}

/** "1,250 soles" plus ", y 95 dólares sin convertir": a total for screen readers. */
export function spokenTotal(penCents: number, unconvertedUsdCents: number): string {
  const pen = spokenMoney(penCents, "PEN");
  return unconvertedUsdCents > 0
    ? `${pen}, ${SUMMARY_COPY.unconvertedSpoken(spokenMoney(unconvertedUsdCents, "USD"))}`
    : pen;
}

/** "58%", "< 1%" or nothing (no PEN). */
export function percentText(percent: number | null): string | null {
  if (percent === null) return null;
  return percent === 0 ? SUMMARY_COPY.smallPercent : SUMMARY_COPY.percent(percent);
}
