// URLs and URL parameters of the finance screens. Client-safe.

export const FINANCE_PATH = "/finance";

/** F2: a recurring payment's page. */
export const recurringPaymentPath = (id: string) => `${FINANCE_PATH}/payments/${id}`;

/** `?mes=YYYY-MM` picks the month of "Mes" (its arrows set it; none: the current month). */
export const MONTH_PARAM = "mes";

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/**
 * The month of a `?mes=` value: a real YYYY-MM from 2000 on and never after the current one
 * (SPEC-finance: "no más allá del mes actual"); anything else is the current month.
 */
export function parseMonth(value: string | string[] | undefined, currentMonth: string): string {
  if (typeof value !== "string" || !MONTH.test(value)) return currentMonth;
  if (value < FIRST_MONTH || value > currentMonth) return currentMonth;
  return value;
}

/** The first month "Mes" goes back to (expenses are dated from 2000 on). */
export const FIRST_MONTH = "2000-01";

/** Months since year 0: orders months and tells which way a change of month goes. */
export function monthOrder(month: string): number {
  return Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7));
}

/** `month` (YYYY-MM) moved by `delta` months: shiftMonth("2026-01", -1) is "2025-12". */
export function shiftMonth(month: string, delta: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const index = year * 12 + (monthNumber - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** The URL of "Mes" for `month`: plain /finance for the current one, else `?mes=YYYY-MM`. */
export function monthHref(month: string, currentMonth: string): string {
  return month === currentMonth ? FINANCE_PATH : `${FINANCE_PATH}?${MONTH_PARAM}=${month}`;
}

/**
 * The four sections of /finance (Resumen · Gastos under "Mes", Pendientes · Pagados under
 * "Pagos"), remembered per device in this cookie.
 */
export const FINANCE_SECTIONS = ["mes:res", "mes:gas", "pagos:pen", "pagos:pag"] as const;
export type FinanceSection = (typeof FINANCE_SECTIONS)[number];
export const FINANCE_VIEW_COOKIE = "bo_finance_view";

/** The group a section belongs to. */
export const sectionGroup = (section: FinanceSection): "month" | "payments" =>
  section.startsWith("mes") ? "month" : "payments";

/**
 * The remembered section. The two values the cookie held before (`mes`, `pagos`; also spelled
 * `month`, `payments`) still work and open the first section of their group; anything unknown is
 * "Resumen".
 */
export function parseFinanceSection(value: string | undefined): FinanceSection {
  if (value === "payments" || value === "pagos") return "pagos:pen";
  return FINANCE_SECTIONS.find((section) => section === value) ?? "mes:res";
}

/** The cookie that remembers the section for a year (client-side; `secure` on HTTPS). */
export function financeViewCookie(section: FinanceSection, secure: boolean): string {
  return `${FINANCE_VIEW_COOKIE}=${section}; Path=/; Max-Age=31536000; SameSite=Lax${secure ? "; Secure" : ""}`;
}
