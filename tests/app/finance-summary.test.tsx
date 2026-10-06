// F3 of `finance` against a fake server: the month's summary on "Mes" (the total with NumberFlow
// and reduced motion, USD without a rate and "Fijar tipo de cambio", the category bars as text and
// as a filter with focus and announcements, the methods, recurring and one-off), the month's
// arrows and the "Pendiente de pagar" strip. Made-up names and amounts only.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { deleteExpense } from "@/modules/finance/actions";
import type { FinanceCatalog } from "@/modules/finance/catalog-input";
import { FinanceScreen } from "@/modules/finance/components/finance-screen";
import { FinanceViews } from "@/modules/finance/components/finance-views";
import { MonthView } from "@/modules/finance/components/month-view";
import { FinanceSettings } from "@/modules/finance/components/settings-sheet";
import type { ExpenseItem } from "@/modules/finance/expense-input";
import type { MonthPending } from "@/modules/finance/summary";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => router,
}));
// NumberFlow's custom element doesn't run in jsdom: record what it gets instead.
const numberFlow = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }));
vi.mock("@number-flow/react", () => ({
  default: (props: { value: number } & Record<string, unknown>) => {
    numberFlow.props.push(props);
    return <span data-number-flow="">{props.value}</span>;
  },
}));
vi.mock("@/modules/finance/actions", () => ({
  createExpense: vi.fn(),
  editExpense: vi.fn(),
  deleteExpense: vi.fn(),
  restoreExpense: vi.fn(),
}));
vi.mock("@/modules/finance/catalog-actions", () => ({
  readFinanceCatalog: vi.fn(),
  createCategory: vi.fn(),
  renameCategory: vi.fn(),
  createPaymentMethod: vi.fn(),
  updatePaymentMethod: vi.fn(),
  reorderCategories: vi.fn(),
  reorderPaymentMethods: vi.fn(),
  archiveCategory: vi.fn(),
  archivePaymentMethod: vi.fn(),
  unarchiveCategory: vi.fn(),
  unarchivePaymentMethod: vi.fn(),
  setExchangeRate: vi.fn(),
}));

const TODAY = "2026-10-05";
const COMIDA = { id: "11111111-1111-4111-8111-111111111111", name: "Comida" };
const CASA = { id: "11111111-1111-4111-8111-222222222222", name: "Casa" };
const EFECTIVO = { id: "22222222-2222-4222-8222-222222222222", name: "Efectivo" };
const CATALOG: FinanceCatalog = {
  categories: [
    { ...COMIDA, sortOrder: 0 },
    { ...CASA, sortOrder: 1 },
  ],
  methods: [{ ...EFECTIVO, currency: "PEN", sortOrder: 0 }],
  archivedCategories: [],
  archivedMethods: [],
  usdToPenE4: 37_500,
  lastPaymentMethodId: null,
};

let serial = 0;
function expense(values: Partial<ExpenseItem> = {}): ExpenseItem {
  serial += 1;
  return {
    id: `33333333-3333-4333-8333-${String(serial).padStart(12, "0")}`,
    description: null,
    amountCents: 1000,
    currency: "PEN",
    exchangeRateE4: null,
    spentOn: TODAY,
    category: null,
    paymentMethod: null,
    recurringPaymentId: null,
    ...values,
  };
}

const announcer = () => document.querySelector("[data-screen-announcer]");

type RenderOptions = {
  month?: string;
  catalog?: FinanceCatalog;
  pending?: MonthPending | null;
};

function renderMonth(expenses: ExpenseItem[], options: RenderOptions = {}) {
  const { month = "2026-10", catalog = CATALOG, pending = null } = options;
  const tree = (rows: ExpenseItem[], shownMonth: string) => (
    <FinanceScreen today={TODAY} catalog={catalog}>
      <FinanceSettings />
      <FinanceViews
        initialView="month"
        month={<MonthView month={shownMonth} expenses={rows} pending={pending} />}
        payments={<p>Pagos</p>}
      />
    </FinanceScreen>
  );
  const result = render(tree(expenses, month));
  return {
    ...result,
    rerenderWith: (rows: ExpenseItem[], next: string) => result.rerender(tree(rows, next)),
  };
}

beforeEach(() => {
  window.matchMedia = vi.fn((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-05T15:00:00.000Z"));
  router.push.mockReset();
  vi.mocked(deleteExpense).mockReset();
  numberFlow.props = [];
  return () => vi.useRealTimers();
});

describe("the month's total", () => {
  test("NumberFlow in PEN, respecting reduced motion; screen readers get one string", () => {
    renderMonth([
      expense({ amountCents: 1250 }),
      expense({ currency: "USD", amountCents: 9500, exchangeRateE4: 37_500 }),
    ]);
    const props = numberFlow.props.at(-1);
    expect(props).toMatchObject({
      value: (1250 + 35_625) / 100,
      locales: "es-PE",
      respectMotionPreference: true,
      format: { style: "currency", currency: "PEN", minimumFractionDigits: 2 },
    });
    // The animated digits are hidden; the spoken total is read instead.
    const flow = document.querySelector("[data-number-flow]");
    expect(flow?.closest("[aria-hidden]")).not.toBeNull();
    expect(screen.getByText("Total del mes: 368.75 soles")).toHaveClass("sr-only");
  });

  test("USD without a rate is shown apart; with no rate set, Ajustes opens from there", async () => {
    const user = userEvent.setup();
    renderMonth([expense({ amountCents: 500 }), expense({ currency: "USD", amountCents: 9500 })], {
      catalog: { ...CATALOG, usdToPenE4: null },
    });
    const line = document.querySelector("[data-month-unconverted]") as HTMLElement;
    expect(line).toHaveTextContent("+ USD 95.00 sin convertir");
    expect(within(line).getByText("y 95 dólares sin convertir")).toHaveClass("sr-only");
    const setRate = within(line).getByRole("button", { name: "Fijar tipo de cambio" });
    await user.click(setRate);
    const sheet = await screen.findByRole("dialog", { name: "Ajustes de Finanzas" });
    expect(within(sheet).getByRole("textbox", { name: "Soles por 1 dólar" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(setRate).toHaveFocus());
  });

  test("with a rate set, the unconverted line has no button (editing adopts the rate)", () => {
    renderMonth([expense({ currency: "USD", amountCents: 9500 })]);
    const line = document.querySelector("[data-month-unconverted]") as HTMLElement;
    expect(within(line).queryByRole("button")).toBeNull();
  });

  test("an empty month: S/ 0.00, no blocks, the calm empty state", () => {
    renderMonth([]);
    expect(numberFlow.props.at(-1)).toMatchObject({ value: 0 });
    expect(document.querySelector("[data-month-summary]")).toBeNull();
    expect(screen.getByText("Sin gastos este mes")).toBeInTheDocument();
  });

  test("a delete takes its amount out of the total at once (optimistic)", async () => {
    const user = userEvent.setup();
    const cafe = expense({ description: "Café", amountCents: 1250 });
    vi.mocked(deleteExpense).mockImplementation(() => new Promise(() => {}));
    renderMonth([cafe, expense({ amountCents: 500 })]);
    expect(numberFlow.props.at(-1)).toMatchObject({ value: 17.5 });
    await user.click(screen.getByRole("button", { name: /^Editar Café/ }));
    await user.click(screen.getByRole("button", { name: "Eliminar gasto" }));
    await waitFor(() => expect(numberFlow.props.at(-1)).toMatchObject({ value: 5 }));
  });
});

describe("Por categoría", () => {
  const rows = () => [
    expense({ description: "Mercado", amountCents: 6000, category: COMIDA }),
    expense({ description: "Café", amountCents: 2000, category: COMIDA, spentOn: "2026-10-04" }),
    expense({ description: "Luz", amountCents: 2000, category: CASA }),
    expense({ description: "Varios", amountCents: 5000 }),
  ];

  test("each bar reads as text (name, spoken amount, percentage); the bar itself is decorative", () => {
    renderMonth(rows());
    const list = screen.getByRole("list", { name: "Por categoría" });
    const bars = within(list).getAllByRole("button");
    expect(bars.map((bar) => bar.getAttribute("aria-label"))).toEqual([
      "Comida, 80 soles, 54 por ciento",
      "Casa, 20 soles, 13 por ciento",
      "Sin categoría, 50 soles, 33 por ciento",
    ]);
    for (const bar of bars) {
      expect(bar).toHaveAttribute("aria-pressed", "false");
      expect(bar.querySelector(".bo-summary-bar")).toHaveAttribute("aria-hidden", "true");
    }
    expect(bars[0]).toHaveTextContent("Comida");
    expect(bars[0]).toHaveTextContent("54%");
    expect(bars[0].querySelector(".bo-summary-bar__fill")).toHaveStyle({ width: "53.33%" });
  });

  test("a bar filters the list (toggle), says so, and Quitar filtro brings focus back to it", async () => {
    const user = userEvent.setup();
    renderMonth(rows());
    const comida = screen.getByRole("button", { name: /^Comida, 80 soles/ });
    await user.click(comida);
    expect(comida).toHaveAttribute("aria-pressed", "true");
    expect(comida).toHaveFocus();
    expect(screen.getByRole("button", { name: /^Editar Mercado/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Editar Café/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Editar Luz/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Editar Varios/ })).toBeNull();
    expect(document.querySelector("[data-month-filter]")).toHaveTextContent(
      "Solo Comida · 2 gastos",
    );
    await waitFor(() =>
      expect(announcer()).toHaveTextContent("Lista filtrada por Comida: 2 gastos."),
    );

    // Another bar moves the filter; the same bar again takes it off.
    const none = screen.getByRole("button", { name: /^Sin categoría/ });
    await user.click(none);
    expect(comida).toHaveAttribute("aria-pressed", "false");
    expect(screen.getAllByRole("button", { name: /^Editar / })).toHaveLength(1);
    await user.click(none);
    expect(screen.getAllByRole("button", { name: /^Editar / })).toHaveLength(4);
    await waitFor(() => expect(announcer()).toHaveTextContent("Sin filtro: 4 gastos del mes."));

    // "Quitar filtro" goes away: focus returns to the bar that set the filter.
    await user.click(screen.getByRole("button", { name: /^Casa/ }));
    await user.click(screen.getByRole("button", { name: "Quitar filtro" }));
    expect(screen.queryByRole("button", { name: "Quitar filtro" })).toBeNull();
    expect(screen.getByRole("button", { name: /^Casa/ })).toHaveFocus();
    expect(screen.getByRole("button", { name: /^Casa/ })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getAllByRole("button", { name: /^Editar / })).toHaveLength(4);
  });

  test("the filter stays with its month: another month shows the whole list", async () => {
    const user = userEvent.setup();
    const { rerenderWith } = renderMonth(rows());
    await user.click(screen.getByRole("button", { name: /^Casa/ }));
    rerenderWith(
      [
        expense({ description: "Pan", category: COMIDA, spentOn: "2026-09-10" }),
        expense({ description: "Agua", category: CASA, spentOn: "2026-09-09" }),
      ],
      "2026-09",
    );
    expect(screen.queryByRole("button", { name: "Quitar filtro" })).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Editar / })).toHaveLength(2);
  });
});

describe("Por medio de pago, recurrente y suelto", () => {
  test("compact rows with each method's amount, Sin medio de pago last; recurring vs one-off", () => {
    renderMonth([
      expense({ amountCents: 1000, paymentMethod: EFECTIVO, recurringPaymentId: "r-1" }),
      expense({ amountCents: 300 }),
      expense({ currency: "USD", amountCents: 100 }),
    ]);
    const methods = screen.getByRole("list", { name: "Por medio de pago" });
    expect(
      within(methods)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      expect.stringContaining("Efectivo, 10 soles"),
      expect.stringContaining("Sin medio de pago, 3 soles, y 1 dólar sin convertir"),
    ]);
    const split = screen.getByRole("region", { name: "Recurrente y suelto" });
    const recurring = split.querySelector('[data-split="recurring"]') as HTMLElement;
    const oneOff = split.querySelector('[data-split="one-off"]') as HTMLElement;
    expect(within(recurring).getByText("10 soles")).toHaveClass("sr-only");
    expect(within(oneOff).getByText("3 soles, y 1 dólar sin convertir")).toHaveClass("sr-only");
  });
});

describe("the month's arrows", () => {
  test("previous goes to ?mes=; next stays aria-disabled on the current month", async () => {
    const user = userEvent.setup();
    renderMonth([]);
    await user.click(screen.getByRole("button", { name: "Mes anterior, Setiembre 2026" }));
    expect(router.push).toHaveBeenCalledWith("/finance?mes=2026-09", { scroll: false });
    const next = screen.getByRole("button", { name: "Mes siguiente: este es el mes actual" });
    expect(next).toHaveAttribute("aria-disabled", "true");
    expect(next).not.toBeDisabled();
    router.push.mockClear();
    await user.click(next);
    expect(router.push).not.toHaveBeenCalled();
  });

  test("from a past month, next goes back to plain /finance for the current one", async () => {
    const user = userEvent.setup();
    renderMonth([], { month: "2026-09" });
    await user.click(screen.getByRole("button", { name: "Mes siguiente, Octubre 2026" }));
    expect(router.push).toHaveBeenCalledWith("/finance", { scroll: false });
  });

  test("January 2000 has no previous month", () => {
    renderMonth([], { month: "2000-01" });
    expect(
      screen.getByRole("button", { name: "Mes anterior: no hay meses antes de 2000" }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  test("another month arriving is announced with its total; focus stays on the arrow", async () => {
    const user = userEvent.setup();
    const { rerenderWith } = renderMonth([]);
    const previous = screen.getByRole("button", { name: "Mes anterior, Setiembre 2026" });
    await user.click(previous);
    rerenderWith([expense({ amountCents: 4200, spentOn: "2026-09-20" })], "2026-09");
    await waitFor(() =>
      expect(announcer()).toHaveTextContent("Setiembre 2026: 42 soles en total."),
    );
    expect(screen.getByRole("heading", { level: 2, name: "Setiembre 2026" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mes anterior, Agosto 2026" })).toHaveFocus();
  });
});

describe("Pendiente de pagar", () => {
  test("nothing without pending payments (null: F2 not wired yet)", () => {
    renderMonth([]);
    expect(document.querySelector("[data-month-pending]")).toBeNull();
  });

  test("the strip with amount and count; it shows Pagos and focus goes to its tab", async () => {
    const user = userEvent.setup();
    renderMonth([], { pending: { count: 2, totalPenCents: 125_000, unconvertedUsdCents: 9500 } });
    const strip = screen.getByRole("button", {
      name: "Pendiente de pagar: 1,250 soles, y 95 dólares sin convertir, 2 pagos. Ver en Pagos",
    });
    expect(strip).toHaveTextContent("2 pagos");
    expect(strip).toHaveTextContent("S/ 1,250.00 + USD 95.00 sin convertir");
    await user.click(strip);
    const tab = screen.getByRole("tab", { name: "Pagos" });
    expect(tab).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(tab).toHaveFocus());
    expect(document.cookie).toContain("bo_finance_view=payments");
  });

  test("one payment, singular", () => {
    renderMonth([], { pending: { count: 1, totalPenCents: 5000, unconvertedUsdCents: 0 } });
    expect(
      screen.getByRole("button", { name: "Pendiente de pagar: 50 soles, 1 pago. Ver en Pagos" }),
    ).toBeInTheDocument();
  });
});
