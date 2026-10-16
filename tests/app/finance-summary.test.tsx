// F3 of `finance` against a fake server: the month's summary on "Mes" (the total with NumberFlow
// and reduced motion, USD without a rate and "Fijar tipo de cambio", the category bars as text and
// as a filter with focus and announcements, the methods, recurring and one-off), the month's
// arrows and the "Pendiente de pagar" strip. Made-up names and amounts only.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { deleteExpense, editExpense, restoreExpense } from "@/modules/finance/actions";
import type { FinanceCatalog } from "@/modules/finance/catalog-input";
import { FinanceScreen } from "@/modules/finance/components/finance-screen";
import { FinanceViews } from "@/modules/finance/components/finance-views";
import { MonthView } from "@/modules/finance/components/month-view";
import { FinanceSettings } from "@/modules/finance/components/settings-sheet";
import type { ExpenseItem } from "@/modules/finance/expense-input";
import type { MonthPending } from "@/modules/finance/summary";
import type { FinanceSection } from "@/modules/finance/routes";
import type { PendingPeriod } from "@/modules/finance/payments-view";
import type { MonthlyTotal } from "@/modules/finance/trend";

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
    const { prefix = "", suffix = "" } = props as { prefix?: string; suffix?: string };
    return <span data-number-flow="">{`${prefix}${props.value}${suffix}`}</span>;
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

/** A delete that waits (the optimistic state shows); settled after each test. */
const hanging: ((result: ActionResult<ExpenseItem>) => void)[] = [];
const hang = () => new Promise<ActionResult<ExpenseItem>>((resolve) => hanging.push(resolve));

const announcer = () => document.querySelector("[data-screen-announcer]");
/** What the (mocked) NumberFlow shows now. */
const flowValue = () => document.querySelector("[data-number-flow]")?.textContent;

type RenderOptions = {
  month?: string;
  catalog?: FinanceCatalog;
  pending?: MonthPending | null;
  /** The section the screen opens on (default «Resumen»). */
  section?: FinanceSection;
  /** The six months `getMonthlyTotals` reads (default none: no comparison). */
  trend?: MonthlyTotal[];
  previousCumulative?: number[] | null;
  pendingPeriods?: PendingPeriod[];
};

function renderMonth(expenses: ExpenseItem[], options: RenderOptions = {}) {
  const {
    month = "2026-10",
    catalog = CATALOG,
    pending = null,
    section = "mes:res",
    trend = [],
    previousCumulative = null,
    pendingPeriods = [],
  } = options;
  const tree = (rows: ExpenseItem[], shownMonth: string) => (
    <FinanceScreen today={TODAY} catalog={catalog}>
      <FinanceSettings />
      <FinanceViews
        initialSection={section}
        month={
          <MonthView
            month={shownMonth}
            expenses={rows}
            pending={pending}
            trend={trend}
            previousCumulative={previousCumulative}
            pendingPeriods={pendingPeriods}
          />
        }
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
  vi.mocked(editExpense).mockReset();
  vi.mocked(restoreExpense).mockReset();
  numberFlow.props = [];
  return async () => {
    // React entangles async transitions: one left pending would hold back every later rollback.
    await act(async () => {
      for (const settle of hanging.splice(0)) settle(ok(expense()));
    });
    vi.useRealTimers();
  };
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
    expect(flowValue()).toBe("0");
    expect(document.querySelector("[data-month-summary]")).toBeNull();
    expect(screen.getByText("Sin gastos este mes")).toBeInTheDocument();
  });

  test("a delete takes its amount out of the total at once (optimistic)", async () => {
    const user = userEvent.setup();
    const cafe = expense({ description: "Café", amountCents: 1250 });
    vi.mocked(deleteExpense).mockImplementation(hang);
    renderMonth([cafe, expense({ amountCents: 500 })], { section: "mes:gas" });
    expect(flowValue()).toBe("17.5");
    await user.click(screen.getByRole("button", { name: /^Editar Café/ }));
    await user.click(screen.getByRole("button", { name: "Eliminar gasto" }));
    await waitFor(() => expect(flowValue()).toBe("5"));
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
      expect(bar.querySelector(".bo-cat-dot")).toHaveAttribute("aria-hidden", "true");
    }
    expect(bars[0]).toHaveTextContent("Comida");
    expect(bars[0]).toHaveTextContent("54%");
  });

  test("a bar adds its category to the filters, takes you to Gastos and says what is left; the chips take them off", async () => {
    const user = userEvent.setup();
    renderMonth(rows());
    const backToSummary = () => user.click(screen.getByRole("tab", { name: "Resumen" }));
    const comida = screen.getByRole("button", { name: /^Comida, 80 soles/ });
    await user.click(comida);
    // The list lives in «Gastos»: its tab is chosen and has focus; the bar keeps its state.
    expect(screen.getByRole("tab", { name: "Gastos" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(screen.getByRole("tab", { name: "Gastos" })).toHaveFocus());
    expect(comida).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^Editar Mercado/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Editar Café/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Editar Luz/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Editar Varios/ })).toBeNull();
    // The chip, the line of what the filters leave (never the month's total) and the button count.
    expect(document.querySelector("[data-month-filter]")).toHaveTextContent("Comida");
    expect(document.querySelector("[data-filter-result]")).toHaveTextContent("2 gastos · S/ 80.00");
    expect(screen.getByRole("button", { name: "Filtros (1)" })).toBeInTheDocument();
    await waitFor(() => expect(announcer()).toHaveTextContent("2 gastos, 80 soles."));

    // Another bar adds to the filters (a set); the same bar again takes it off.
    await backToSummary();
    await user.click(screen.getByRole("button", { name: /^Casa,/ }));
    expect(comida).toHaveAttribute("aria-pressed", "true");
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /^Editar / })).toHaveLength(3),
    );
    await backToSummary();
    await user.click(screen.getByRole("button", { name: /^Casa,/ }));
    await user.click(screen.getByRole("tab", { name: "Gastos" }));
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /^Editar / })).toHaveLength(2),
    );

    // A chip's key takes its filter off; the last one hands focus to «Filtros».
    await user.click(screen.getByRole("button", { name: "Quitar filtro: Comida" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Quitar filtro: Comida" })).toBeNull(),
    );
    expect(screen.getByRole("button", { name: "Filtros" })).toHaveFocus();
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /^Editar / })).toHaveLength(4),
    );
    await waitFor(() => expect(announcer()).toHaveTextContent("Sin filtro: 4 gastos del mes."));
    await backToSummary();
    expect(screen.getByRole("button", { name: /^Casa,/ })).toHaveAttribute("aria-pressed", "false");
  });

  test("the filter stays with its month: another month shows the whole list", async () => {
    const user = userEvent.setup();
    const { rerenderWith } = renderMonth(rows());
    await user.click(screen.getByRole("button", { name: /^Casa,/ }));
    rerenderWith(
      [
        expense({ description: "Pan", category: COMIDA, spentOn: "2026-09-10" }),
        expense({ description: "Agua", category: CASA, spentOn: "2026-09-09" }),
      ],
      "2026-09",
    );
    // The chip leaves with its exit animation (150 ms): gone a moment later.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Quitar filtro" })).toBeNull());
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /^Editar / })).toHaveLength(2),
    );
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
  test("nothing without pending payments (null or a count of 0)", () => {
    renderMonth([]);
    expect(document.querySelector("[data-month-pending]")).toBeNull();
  });

  test("the strip with amount and count; it shows «Gastos» (where they are paid) and focus goes to its tab", async () => {
    const user = userEvent.setup();
    renderMonth([], {
      pending: {
        count: 2,
        totalPenCents: 125_000,
        unconvertedUsdCents: 9500,
        variableCount: 0,
        nextDueOn: "2026-10-18",
      },
    });
    const strip = screen.getByRole("button", {
      name: /^Pendiente de pagar: 1,250 soles, y 95 dólares sin convertir, próximo .+, 2\ pagos\. Ver pendientes$/,
    });
    expect(strip).toHaveTextContent("2 pagos");
    // The PEN figure rolls (mocked here as its raw value); the rest of the line is plain text.
    expect(strip).toHaveTextContent("+ USD 95.00 sin convertir");
    await user.click(strip);
    const tab = screen.getByRole("tab", { name: "Gastos" });
    expect(tab).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(tab).toHaveFocus());
    expect(document.cookie).toContain("bo_finance_view=mes:gas");
  });

  test("one payment, singular", () => {
    renderMonth([], {
      pending: {
        count: 1,
        totalPenCents: 5000,
        unconvertedUsdCents: 0,
        variableCount: 0,
        nextDueOn: "2026-10-18",
      },
    });
    expect(
      screen.getByRole("button", {
        name: /^Pendiente de pagar: 50 soles, próximo .+, 1\ pago\. Ver pendientes$/,
      }),
    ).toBeInTheDocument();
  });

  test("variable payments are counted apart, never as S/ 0.00", () => {
    const { rerender } = render(
      <FinanceScreen today={TODAY} catalog={CATALOG}>
        <MonthView
          month="2026-10"
          expenses={[]}
          pending={{
            count: 3,
            totalPenCents: 5000,
            unconvertedUsdCents: 0,
            variableCount: 2,
            nextDueOn: "2026-10-18",
          }}
        />
      </FinanceScreen>,
    );
    const mixed = screen.getByRole("button", {
      name: /^Pendiente de pagar: 50 soles, y 2 de monto variable, próximo .+, 3\ pagos\. Ver pendientes$/,
    });
    expect(mixed).toHaveTextContent("+ 2 de monto variable");
    rerender(
      <FinanceScreen today={TODAY} catalog={CATALOG}>
        <MonthView
          month="2026-10"
          expenses={[]}
          pending={{
            count: 1,
            totalPenCents: 0,
            unconvertedUsdCents: 0,
            variableCount: 1,
            nextDueOn: "2026-10-18",
          }}
        />
      </FinanceScreen>,
    );
    const onlyVariable = screen.getByRole("button", {
      name: /^Pendiente de pagar: 1 de monto variable, próximo .+, 1\ pago\. Ver pendientes$/,
    });
    expect(onlyVariable).not.toHaveTextContent("S/");
    rerender(
      <FinanceScreen today={TODAY} catalog={CATALOG}>
        <MonthView
          month="2026-10"
          expenses={[]}
          pending={{
            count: 0,
            totalPenCents: 0,
            unconvertedUsdCents: 0,
            variableCount: 0,
            nextDueOn: "2026-10-18",
          }}
        />
      </FinanceScreen>,
    );
    expect(document.querySelector("[data-month-pending]")).toBeNull();
  });
});

describe("the summary follows deletes, undo and the filter", () => {
  const notices = () => screen.getByRole("region", { name: "Avisos de Finanzas" });
  const barLabels = () =>
    // The bars live in «Resumen», which is hidden while «Gastos» shows.
    within(screen.getByRole("list", { name: "Por categoría", hidden: true }))
      .getAllByRole("button", { hidden: true })
      .map((bar) => bar.getAttribute("aria-label"));

  test("a refused delete rolls the total and the bars back", async () => {
    const user = userEvent.setup();
    const cafe = expense({ description: "Café", amountCents: 1250, category: COMIDA });
    const pan = expense({ description: "Pan", amountCents: 500, category: CASA });
    vi.mocked(deleteExpense).mockResolvedValue(fail("Este gasto ya no existe (se eliminó)."));
    renderMonth([cafe, pan], { section: "mes:gas" });
    await user.click(screen.getByRole("button", { name: /^Editar Café/ }));
    await user.click(screen.getByRole("button", { name: "Eliminar gasto" }));
    await waitFor(() => expect(within(notices()).getByText("Sin guardar")).toBeInTheDocument());
    // The notice can render before useOptimistic rolls back: the rolled-back state in waitFor.
    await waitFor(() => {
      expect(screen.getByText(/^Total del mes:/)).toHaveTextContent("Total del mes: 17.50 soles");
      expect(flowValue()).toBe("17.5");
      expect(barLabels()).toEqual([
        "Comida, 12.50 soles, 71 por ciento",
        "Casa, 5 soles, 29 por ciento",
      ]);
    });
  });

  test("Deshacer brings the total and the bars back", async () => {
    const user = userEvent.setup();
    const cafe = expense({ description: "Café", amountCents: 1250, category: COMIDA });
    const pan = expense({ description: "Pan", amountCents: 500, category: CASA });
    vi.mocked(deleteExpense).mockResolvedValue(ok(cafe));
    vi.mocked(restoreExpense).mockResolvedValue(ok(cafe));
    const { rerenderWith } = renderMonth([cafe, pan], { section: "mes:gas" });
    await user.click(screen.getByRole("button", { name: /^Editar Café/ }));
    await user.click(screen.getByRole("button", { name: "Eliminar gasto" }));
    await waitFor(() => expect(within(notices()).getByText("Gasto eliminado")).toBeInTheDocument());
    // The server's revalidation without it.
    rerenderWith([pan], "2026-10");
    await waitFor(() => expect(flowValue()).toBe("5"));
    expect(barLabels()).toEqual(["Casa, 5 soles, 100 por ciento"]);
    await user.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    await waitFor(() => expect(restoreExpense).toHaveBeenCalledWith({ id: cafe.id }));
    // And with it again, once restored.
    rerenderWith([cafe, pan], "2026-10");
    await waitFor(() => expect(flowValue()).toBe("17.5"));
    expect(barLabels()).toEqual([
      "Comida, 12.50 soles, 71 por ciento",
      "Casa, 5 soles, 29 por ciento",
    ]);
  });

  test("deleting the last expense the filters leave shows the empty state with a way out", async () => {
    const user = userEvent.setup();
    const cafe = expense({ description: "Café", category: COMIDA });
    const pan = expense({ description: "Pan", category: CASA });
    vi.mocked(deleteExpense).mockImplementation(hang);
    renderMonth([cafe, pan]);
    await user.click(screen.getByRole("button", { name: /^Comida,/ }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /^Editar Pan/ })).toBeNull());
    await user.click(screen.getByRole("button", { name: /^Editar Café/ }));
    await user.click(screen.getByRole("button", { name: "Eliminar gasto" }));
    // Nothing is cleared behind the owner's back: the list says nothing matches.
    await waitFor(() =>
      expect(document.querySelector("[data-filter-empty]")).toHaveTextContent(
        "Ningún gasto cumple los filtros.",
      ),
    );
    await user.click(screen.getByRole("button", { name: "Quitar todos" }));
    expect(await screen.findByRole("button", { name: /^Editar Pan/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filtros" })).toHaveFocus();
  });

  test("a new expense the filters would hide takes them all away, said; one that fits keeps them", async () => {
    const user = userEvent.setup();
    const cafe = expense({ description: "Café", category: COMIDA });
    const pan = expense({ description: "Pan", category: CASA });
    const { rerenderWith } = renderMonth([cafe, pan]);
    await user.click(screen.getByRole("button", { name: /^Comida,/ }));
    // Positive control: a new one in the filtered category keeps the filters.
    const mercado = expense({ description: "Mercado", category: COMIDA });
    rerenderWith([mercado, cafe, pan], "2026-10");
    expect(screen.getByRole("button", { name: "Quitar filtro: Comida" })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /^Editar / })).toHaveLength(2),
    );
    // A new one elsewhere (the sheet or the quick capture): the whole month shows, said once.
    const agua = expense({ description: "Agua", category: CASA });
    rerenderWith([agua, mercado, cafe, pan], "2026-10");
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Quitar filtro: Comida" })).toBeNull(),
    );
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /^Editar / })).toHaveLength(4),
    );
    await waitFor(() =>
      expect(announcer()).toHaveTextContent(
        "Se quitaron los filtros para mostrar el gasto nuevo: 4 gastos del mes.",
      ),
    );
  });

  test("with a filter, a delete sends focus to the next row of the filtered list", async () => {
    const user = userEvent.setup();
    const mercado = expense({ description: "Mercado", category: COMIDA });
    const luz = expense({ description: "Luz", category: CASA });
    const cafe = expense({ description: "Café", category: COMIDA, spentOn: "2026-10-04" });
    vi.mocked(deleteExpense).mockImplementation(hang);
    renderMonth([mercado, luz, cafe]);
    await user.click(screen.getByRole("button", { name: /^Comida,/ }));
    await user.click(screen.getByRole("button", { name: /^Editar Mercado/ }));
    await user.click(screen.getByRole("button", { name: "Eliminar gasto" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Editar Café/ })).toHaveFocus());
    expect(screen.queryByRole("button", { name: /^Editar Luz/ })).toBeNull();
  });

  test("with a filter, an edit returns focus to its row", async () => {
    const user = userEvent.setup();
    const mercado = expense({ description: "Mercado", category: COMIDA });
    const luz = expense({ description: "Luz", category: CASA });
    vi.mocked(editExpense).mockResolvedValue(ok({ ...mercado, amountCents: 7000 }));
    renderMonth([mercado, luz]);
    await user.click(screen.getByRole("button", { name: /^Comida,/ }));
    await user.click(screen.getByRole("button", { name: /^Editar Mercado/ }));
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Editar Mercado/ })).toHaveFocus(),
    );
    expect(screen.getByRole("button", { name: "Quitar filtro: Comida" })).toBeInTheDocument();
  });

  test("each bar is described by the hint; a bar with nothing in PEN still reads", () => {
    renderMonth([
      expense({ amountCents: 500, category: CASA }),
      expense({ currency: "USD", amountCents: 900, category: COMIDA }),
    ]);
    const casa = screen.getByRole("button", { name: /^Casa,/ });
    // The segment of the bar is named apart ("Barra, …"), so this is the list's row alone.
    expect(screen.getAllByRole("button", { name: /^Comida,/ })).toHaveLength(1);
    expect(casa).toHaveAccessibleDescription("Toca una categoría para ver solo sus gastos.");
    expect(screen.getByRole("list", { name: "Por categoría" })).not.toHaveAttribute(
      "aria-describedby",
    );
  });

  test("fast arrow clicks add up: two clicks go two months back", async () => {
    const user = userEvent.setup();
    renderMonth([]);
    const previous = screen.getByRole("button", { name: "Mes anterior, Setiembre 2026" });
    await user.click(previous);
    await act(async () => {});
    await user.click(previous);
    expect(router.push.mock.calls.map(([href]) => href)).toEqual([
      "/finance?mes=2026-09",
      "/finance?mes=2026-08",
    ]);
  });
});

describe("the three sections (finance-motion M2)", () => {
  const SEPT = (uptoDayPenCents: number, unconvertedUsdCents = 0): MonthlyTotal[] => [
    { month: "2026-09", penCents: 99_999, uptoDayPenCents, unconvertedUsdCents },
  ];

  test("the control has three tabs; choosing one shows only its panel and remembers it", async () => {
    const user = userEvent.setup();
    renderMonth([expense({ description: "Café" })]);
    const tabs = within(screen.getByRole("tablist", { name: "Vista de Finanzas" }));
    expect(tabs.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Resumen",
      "Gastos",
      "Recurrentes",
    ]);
    expect(document.querySelector('[data-finance-view="mes:gas"]')).toHaveAttribute("hidden");
    await user.click(tabs.getByRole("tab", { name: "Gastos" }));
    expect(document.querySelector('[data-finance-view="mes:res"]')).toHaveAttribute("hidden");
    expect(document.querySelector('[data-finance-view="mes:gas"]')).not.toHaveAttribute("hidden");
    expect(document.cookie).toContain("bo_finance_view=mes:gas");
    // Month's header belongs to both of its sections, not to Recurrentes.
    expect(document.querySelector("[data-finance-month]")).not.toHaveAttribute("hidden");
    await user.click(tabs.getByRole("tab", { name: "Recurrentes" }));
    expect(document.querySelector("[data-finance-month]")).toHaveAttribute("hidden");
  });

  test("the context line: neutral delta at the same point of the month, and Día n de m", () => {
    // Today is the 5th: 12.50 spent by then against 10.00 by the 5th of September: +25 %.
    renderMonth([expense({ amountCents: 1250 })], { trend: SEPT(1000) });
    const context = document.querySelector("[data-month-context]");
    expect(context).toHaveTextContent("+25 % vs. mes anterior al mismo punto del mes");
    expect(context).toHaveTextContent("Día 5 de 31");
    expect(document.querySelector("[data-month-delta]")).toHaveAttribute("data-month-delta", "up");
    expect(screen.getByText(/25 por ciento más que el mes anterior/)).toBeInTheDocument();
  });

  test("a delete moves the delta at once (the current side reads the optimistic list)", async () => {
    const user = userEvent.setup();
    vi.mocked(deleteExpense).mockImplementation(hang);
    renderMonth(
      [expense({ description: "Café", amountCents: 1250 }), expense({ amountCents: 500 })],
      {
        section: "mes:gas",
        trend: SEPT(1000),
      },
    );
    expect(document.querySelector("[data-month-delta]")).toHaveTextContent("+75 %");
    await user.click(screen.getByRole("button", { name: /^Editar Café/ }));
    await user.click(screen.getByRole("button", { name: "Eliminar gasto" }));
    await waitFor(() =>
      expect(document.querySelector("[data-month-delta]")).toHaveTextContent("−50 %"),
    );
  });

  test("no comparison without a previous month or with nothing spent by then", () => {
    const { unmount } = renderMonth([expense()]);
    expect(document.querySelector("[data-month-delta]")).toBeNull();
    // The day is still said while the month is current.
    expect(document.querySelector("[data-month-day]")).toHaveTextContent("Día 5 de 31");
    unmount();
    renderMonth([expense()], { trend: SEPT(0) });
    expect(document.querySelector("[data-month-delta]")).toBeNull();
  });

  test("unconverted USD is left out of the comparison and the line says so", () => {
    renderMonth([expense({ amountCents: 1000 })], { trend: SEPT(1000, 500) });
    expect(document.querySelector("[data-month-context]")).toHaveTextContent(
      "La comparación no incluye dólares sin convertir.",
    );
  });

  test("another month is compared whole and has no «Día n de m»", () => {
    renderMonth([expense({ spentOn: "2026-09-10", amountCents: 500 })], {
      month: "2026-09",
      trend: [{ month: "2026-08", penCents: 1000, uptoDayPenCents: 1000, unconvertedUsdCents: 0 }],
    });
    const context = document.querySelector("[data-month-context]");
    expect(context).toHaveTextContent("−50 % vs. mes anterior");
    expect(context).not.toHaveTextContent("al mismo punto");
    expect(document.querySelector("[data-month-day]")).toBeNull();
  });

  test("«Gastado» repeats the total and counts the expenses", () => {
    renderMonth([expense({ amountCents: 1250 }), expense({ amountCents: 500 })]);
    const card = document.querySelector("[data-spent-card]");
    expect(card).toHaveAccessibleName("Gastado: 17.50 soles, 2 gastos");
  });

  test("the donut: one toggle per category with PEN, by keyboard, same state as its row; the middle follows", async () => {
    const user = userEvent.setup();
    renderMonth([
      expense({ amountCents: 6000, category: COMIDA }),
      expense({ amountCents: 2000, category: CASA }),
      expense({ currency: "USD", amountCents: 900, exchangeRateE4: null, category: null }),
    ]);
    const donut = screen.getByRole("group", { name: "Distribución por categoría" });
    const segments = within(donut).getAllByRole("button");
    // The USD without a rate has no PEN: no slice, only its row (and the note under the donut).
    expect(segments.map((segment) => segment.getAttribute("aria-label"))).toEqual([
      "Comida: 60 soles, 75 por ciento del mes",
      "Casa: 20 soles, 25 por ciento del mes",
    ]);
    expect(document.querySelector("[data-donut-usd]")).toHaveTextContent(
      "no suma al total ni a los %",
    );
    // The middle says the month until a slice is pointed at, then the slice, then the month again.
    const center = () => document.querySelector(".bo-donut__center") as HTMLElement;
    expect(center()).toHaveTextContent("Total del mes");
    await user.hover(segments[1]);
    expect(center()).toHaveTextContent("Casa");
    expect(center()).toHaveTextContent("25 % del mes");
    await user.unhover(segments[1]);
    expect(center()).toHaveTextContent("Total del mes");
    // Keyboard: arrows walk the slices in a circle; Enter toggles the filter and goes to «Gastos».
    segments[0].focus();
    await user.keyboard("{ArrowLeft}");
    expect(segments[1]).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(segments[0]).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("tab", { name: "Gastos" })).toHaveAttribute("aria-selected", "true");
    expect(segments[0]).toHaveAttribute("aria-pressed", "true");
    expect(segments[1]).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: /^Comida, 60 soles/, hidden: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("«Otros · N» stands for the smallest categories: it filters by all of them, and again takes them off", async () => {
    const user = userEvent.setup();
    const names = [
      "Uno",
      "Dos",
      "Tres",
      "Cuatro",
      "Cinco",
      "Seis",
      "Siete",
      "Ocho",
      "Nueve",
      "Diez",
    ];
    renderMonth(
      names.map((name, index) =>
        expense({
          description: name,
          amountCents: 10_000 - index * 500,
          category: {
            id: `44444444-4444-4444-8444-${String(index).padStart(12, "0")}`,
            name: `Cat ${name}`,
          },
        }),
      ),
    );
    const donut = screen.getByRole("group", { name: "Distribución por categoría" });
    const slices = within(donut).getAllByRole("button");
    expect(slices).toHaveLength(8);
    const others = slices.at(-1)!;
    expect(others.getAttribute("aria-label")).toMatch(/^Otros · 3 categorías: /);
    await user.click(others);
    expect(others).toHaveAttribute("aria-pressed", "true");
    // Three categories are in the filters: three chips (the 3 smallest) and three rows.
    await waitFor(() => expect(document.querySelectorAll("[data-chip]")).toHaveLength(3));
    await user.click(screen.getByRole("tab", { name: "Resumen" }));
    await user.click(others);
    expect(others).toHaveAttribute("aria-pressed", "false");
    await waitFor(() => expect(document.querySelectorAll("[data-chip]")).toHaveLength(0));
  });

  test("each day of «Gastos» shows its total (and says it), the list keeps its name", () => {
    renderMonth(
      [
        expense({ description: "Café", amountCents: 1250 }),
        expense({ description: "Pan", amountCents: 300 }),
        expense({ description: "Antes", amountCents: 700, spentOn: "2026-10-04" }),
      ],
      { section: "mes:gas" },
    );
    expect(document.querySelector('[data-day-total="2026-10-05"]')).toHaveTextContent(
      "S/ 15.50Total del día: 15.50 soles",
    );
    expect(document.querySelector('[data-day-total="2026-10-04"]')).toHaveTextContent("S/ 7.00");
    expect(screen.getByRole("list", { name: "Hoy" })).toBeInTheDocument();
  });

  test("one card holds «Por medio de pago» and «Recurrente y suelto»", () => {
    renderMonth([expense({ amountCents: 1000, paymentMethod: EFECTIVO })]);
    const card = document.querySelector("[data-month-mix]") as HTMLElement;
    expect(within(card).getByRole("list", { name: "Por medio de pago" })).toBeInTheDocument();
    expect(within(card).getByText("Recurrente y suelto")).toBeInTheDocument();
  });

  test("the accent is the category's slot: a dot and a slice; none is «Otros» (8)", () => {
    renderMonth([
      expense({ amountCents: 6000, category: { ...COMIDA, colorSlot: 2 } }),
      expense({ amountCents: 2000, category: CASA }),
      expense({ amountCents: 1000 }),
    ]);
    const accents = [...document.querySelectorAll<SVGElement>("[data-donut-segment]")].map(
      (segment) => segment.style.getPropertyValue("--_cat"),
    );
    expect(accents).toEqual(["var(--cat-2)", "var(--cat-8)", "var(--cat-8)"]);
    const dots = document.querySelectorAll<HTMLElement>(".bo-cat-dot");
    expect(dots[0].style.getPropertyValue("--_cat")).toBe("var(--cat-2)");
  });

  test("only a filtered list draws the 2 px line on its rows", async () => {
    const user = userEvent.setup();
    renderMonth(
      [
        expense({
          description: "Mercado",
          amountCents: 500,
          category: { ...COMIDA, colorSlot: 3 },
        }),
      ],
      { section: "mes:gas" },
    );
    const row = screen.getByRole("button", { name: /^Editar Mercado/ });
    expect(row).not.toHaveAttribute("data-accent");
    await user.click(screen.getByRole("tab", { name: "Resumen" }));
    await user.click(screen.getByRole("button", { name: /^Comida, 5 soles/ }));
    expect(screen.getByRole("button", { name: /^Editar Mercado/ })).toHaveAttribute("data-accent");
    expect(
      screen.getByRole("button", { name: /^Editar Mercado/ }).style.getPropertyValue("--_cat"),
    ).toBe("var(--cat-3)");
  });

  test("the pace chart sits between the cards and the breakdown; an empty month says so instead", () => {
    const { unmount } = renderMonth([expense({ amountCents: 1250 })], {
      previousCumulative: Array(31).fill(1000),
    });
    expect(screen.getByRole("heading", { name: "Ritmo del mes" })).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: /^Gasto acumulado del mes: 12.50 soles al día 5\./ }),
    ).toBeInTheDocument();
    expect(document.querySelector("[data-chart-empty]")).toBeNull();
    unmount();
    renderMonth([]);
    expect(document.querySelector("[data-chart-empty]")).toBeNull(); // no expenses: the month's own empty card
  });

  test("the sparkline of «Gastado» comes from the six months", () => {
    renderMonth([expense()], {
      trend: [100, 200, 300].map((penCents, i) => ({
        month: `2026-0${i + 7}`,
        penCents,
        uptoDayPenCents: penCents,
        unconvertedUsdCents: 0,
      })),
    });
    expect(document.querySelector("[data-spent-card] [data-sparkline]")).not.toBeNull();
  });

  test("«Por pagar» sits in «Gastos» above the list, only in the current month", () => {
    const period = {
      recurring: {
        id: "55555555-5555-4555-8555-000000000009",
        name: "Internet",
        amountCents: 5000,
        currency: "PEN" as const,
        category: null,
        paymentMethod: null,
        cycle: "monthly" as const,
        weekday: null,
        dayOfMonth: 5,
        intervalMonths: null,
        anchorMonth: null,
        startDate: "2026-10-01",
        installmentsTotal: null,
        notes: null,
        archived: false,
      },
      dueOn: TODAY,
    };
    const { unmount } = renderMonth([expense({ description: "Café" })], {
      section: "mes:gas",
      pendingPeriods: [period],
    });
    const block = document.querySelector("[data-pending-payments]") as HTMLElement;
    const list = screen.getByRole("heading", { name: "Gastos del mes" });
    expect(block.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(block).getByRole("button", { name: /^Pagado: Internet,/ })).toBeInTheDocument();
    unmount();
    // Another month: what is left to pay belongs to now, so the block is not there.
    renderMonth([], { month: "2026-09", section: "mes:gas", pendingPeriods: [period] });
    expect(document.querySelector("[data-pending-payments]")).toBeNull();
  });

  describe("the filters panel (finance-gastos)", () => {
    const panelRows = () => [
      expense({
        description: "Café",
        amountCents: 1250,
        category: COMIDA,
        paymentMethod: EFECTIVO,
      }),
      expense({ description: "Alquiler", amountCents: 80_000, category: CASA }),
      expense({ description: "Pan", amountCents: 300, category: COMIDA, spentOn: "2026-10-04" }),
    ];
    const editRows = () =>
      screen
        .getAllByRole("button", { name: /^Editar / })
        .map((row) => row.getAttribute("aria-label"));

    test("«Filtros» folds the panel (aria-expanded, aria-controls); text filters after a pause and says what is left", async () => {
      const user = userEvent.setup();
      renderMonth(panelRows(), { section: "mes:gas" });
      const button = screen.getByRole("button", { name: "Filtros" });
      expect(button).toHaveAttribute("aria-expanded", "false");
      const panel = document.querySelector("[data-filters-panel]") as HTMLElement;
      expect(button).toHaveAttribute("aria-controls", panel.id);
      expect(panel).toHaveAttribute("hidden");
      await user.click(button);
      expect(button).toHaveAttribute("aria-expanded", "true");
      expect(panel).not.toHaveAttribute("hidden");
      // Accents and case do not matter; the list follows after ~250 ms, not on every key.
      await user.type(screen.getByRole("searchbox", { name: /^Buscar en descripción/ }), "CAFE");
      await waitFor(() => expect(editRows()).toHaveLength(1));
      expect(editRows()[0]).toMatch(/^Editar Café/);
      expect(document.querySelector("[data-filter-result]")).toHaveTextContent(
        "1 gasto · S/ 12.50",
      );
      // The month's total did not move.
      expect(document.querySelector("[data-month-total]")).toHaveAttribute(
        "data-month-total",
        "81550",
      );
      // The chip takes the text off and the field follows.
      await user.click(screen.getByRole("button", { name: "Quitar filtro: “CAFE”" }));
      await waitFor(() => expect(editRows()).toHaveLength(3));
      expect(screen.getByRole("searchbox", { name: /^Buscar en descripción/ })).toHaveValue("");
    });

    test("payment methods and categories are sets of checkboxes; «Sin medio de pago» is one too", async () => {
      const user = userEvent.setup();
      renderMonth(panelRows(), { section: "mes:gas" });
      await user.click(screen.getByRole("button", { name: "Filtros" }));
      const methods = within(screen.getByRole("group", { name: "Medio de pago" }));
      await user.click(methods.getByRole("checkbox", { name: "Efectivo" }));
      await waitFor(() => expect(editRows()).toHaveLength(1));
      await user.click(methods.getByRole("checkbox", { name: "Sin medio de pago" }));
      await waitFor(() => expect(editRows()).toHaveLength(3));
      const categories = within(screen.getByRole("group", { name: "Categoría" }));
      await user.click(categories.getByRole("checkbox", { name: "Casa" }));
      await waitFor(() => expect(editRows()).toHaveLength(1));
      expect(editRows()[0]).toMatch(/^Editar Alquiler/);
    });

    test("sorting by amount makes the list flat and each row says its day; by date groups again", async () => {
      const user = userEvent.setup();
      renderMonth(panelRows(), { section: "mes:gas" });
      expect(screen.getAllByRole("heading", { level: 4 })).toHaveLength(2);
      await user.selectOptions(screen.getByRole("combobox", { name: "Orden" }), "highest");
      await waitFor(() => expect(screen.queryAllByRole("heading", { level: 4 })).toHaveLength(0));
      expect(editRows().map((label) => label?.split(",")[0])).toEqual([
        "Editar Alquiler",
        "Editar Café",
        "Editar Pan",
      ]);
      expect(editRows()[2]).toContain("Ayer");
      await user.selectOptions(screen.getByRole("combobox", { name: "Orden" }), "oldest");
      await waitFor(() => expect(screen.getAllByRole("heading", { level: 4 })).toHaveLength(2));
      expect(editRows()[0]).toMatch(/^Editar Pan/);
    });

    test("«Mostrar 7 días más» brings the next 7 days and goes away when nothing is left", async () => {
      const user = userEvent.setup();
      const days = Array.from({ length: 9 }, (_, index) =>
        expense({
          description: `Gasto ${index + 1}`,
          spentOn: `2026-10-${String(9 - index).padStart(2, "0")}`,
        }),
      );
      renderMonth(days, { section: "mes:gas" });
      expect(editRows()).toHaveLength(7);
      expect(screen.getByText("Mostrando 7 de 9 días")).toBeInTheDocument();
      const more = screen.getByRole("button", { name: "Mostrar 7 días más" });
      await user.click(more);
      await waitFor(() => expect(editRows()).toHaveLength(9));
      expect(screen.queryByRole("button", { name: /Mostrar 7 días más/ })).toBeNull();
      // The first new row takes focus when the button is gone.
      expect(screen.getByRole("button", { name: /^Editar Gasto 8/ })).toHaveFocus();
    });

    describe("amount, days, kind and currency", () => {
      const rows = () => [
        expense({ description: "Café", amountCents: 1250, category: COMIDA }),
        expense({ description: "Alquiler", amountCents: 80_000, recurringPaymentId: "r-1" }),
        expense({ description: "Pan", amountCents: 300, spentOn: "2026-10-04" }),
        expense({
          description: "Libro",
          amountCents: 2000,
          currency: "USD",
          exchangeRateE4: 37_500,
          spentOn: "2026-10-03",
        }),
      ];
      const open = async (user: ReturnType<typeof userEvent.setup>) => {
        renderMonth(rows(), { section: "mes:gas" });
        await user.click(screen.getByRole("button", { name: "Filtros" }));
      };

      test("a range of amount in soles converts the USD with its own rate; a wrong number says so and filters nothing", async () => {
        const user = userEvent.setup();
        await open(user);
        const min = screen.getByRole("textbox", { name: "Desde" });
        await user.type(min, "1x");
        expect(await screen.findByText(/Escribe solo el número/)).toBeInTheDocument();
        expect(editRows()).toHaveLength(4);
        await user.clear(min);
        await user.type(min, "12,50");
        await user.type(screen.getByRole("textbox", { name: "Hasta" }), "100");
        // Café 12.50, Libro USD 20 × 3.75 = 75.00; Alquiler 800 and Pan 3 are out.
        await waitFor(() => expect(editRows()).toHaveLength(2));
        expect(document.querySelector("[data-month-filter]")).toHaveTextContent(
          "S/ 12.50 – S/ 100.00",
        );
        await user.click(screen.getByRole("button", { name: /^Quitar filtro: S\/.12\.50/ }));
        await waitFor(() => expect(editRows()).toHaveLength(4));
        expect(min).toHaveValue("");
      });

      test("days are inclusive and bounded to the month; kind and currency are one choice each", async () => {
        const user = userEvent.setup();
        await open(user);
        const from = screen.getByLabelText("Desde el día");
        expect(from).toHaveAttribute("min", "2026-10-01");
        expect(from).toHaveAttribute("max", "2026-10-31");
        await user.type(from, "2026-10-04");
        await waitFor(() => expect(editRows()).toHaveLength(3));
        await user.selectOptions(screen.getByRole("combobox", { name: "Tipo" }), "recurring");
        await waitFor(() => expect(editRows()).toHaveLength(1));
        expect(editRows()[0]).toMatch(/^Editar Alquiler/);
        await user.selectOptions(screen.getByRole("combobox", { name: "Tipo" }), "all");
        await user.selectOptions(screen.getByRole("combobox", { name: "Moneda" }), "USD");
        // The USD one is on the 3rd, before the 4th: nothing is left, and the way out is there.
        await waitFor(() =>
          expect(document.querySelector("[data-filter-empty]")).toHaveTextContent("Ningún gasto"),
        );
        await user.click(
          within(document.querySelector("[data-filter-empty]") as HTMLElement).getByRole("button", {
            name: "Quitar todos",
          }),
        );
        await waitFor(() => expect(editRows()).toHaveLength(4));
        expect(screen.getByRole("button", { name: "Filtros" })).toHaveFocus();
      });
    });
  });
});
