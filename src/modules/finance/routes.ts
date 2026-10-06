// URLs and URL parameters of the finance screens. Client-safe.

export const FINANCE_PATH = "/finance";

/** F2: a recurring payment's page. */
export const recurringPaymentPath = (id: string) => `${FINANCE_PATH}/payments/${id}`;

/** `?mes=YYYY-MM` picks the month of "Mes" (F3 adds the arrows; none: the current month). */
export const MONTH_PARAM = "mes";

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/**
 * The month of a `?mes=` value: a real YYYY-MM from 2000 on and never after the current one
 * (SPEC-finance: "no más allá del mes actual"); anything else is the current month.
 */
export function parseMonth(value: string | string[] | undefined, currentMonth: string): string {
  if (typeof value !== "string" || !MONTH.test(value)) return currentMonth;
  if (value < "2000-01" || value > currentMonth) return currentMonth;
  return value;
}

/** The view switch of /finance ("Mes · Pagos"), remembered per device in this cookie. */
export const FINANCE_VIEWS = ["month", "payments"] as const;
export type FinanceView = (typeof FINANCE_VIEWS)[number];
export const FINANCE_VIEW_COOKIE = "bo_finance_view";

/** The remembered view; anything unknown (or none) is "Mes". */
export function parseFinanceView(value: string | undefined): FinanceView {
  return value === "payments" ? "payments" : "month";
}

/** The cookie that remembers the view for a year (client-side; `secure` on HTTPS). */
export function financeViewCookie(view: FinanceView, secure: boolean): string {
  return `${FINANCE_VIEW_COOKIE}=${view}; Path=/; Max-Age=31536000; SameSite=Lax${secure ? "; Secure" : ""}`;
}
