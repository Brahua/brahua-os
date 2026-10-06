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
    renderMonth([cafe, expense({ amountCents: 500 })]);
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

describe("the summary follows deletes, undo and the filter", () => {
  const notices = () => screen.getByRole("region", { name: "Avisos de Finanzas" });
  const barLabels = () =>
    within(screen.getByRole("list", { name: "Por categoría" }))
      .getAllByRole("button")
      .map((bar) => bar.getAttribute("aria-label"));

  test("a refused delete rolls the total and the bars back", async () => {
    const user = userEvent.setup();
    const cafe = expense({ description: "Café", amountCents: 1250, category: COMIDA });
    const pan = expense({ description: "Pan", amountCents: 500, category: CASA });
    vi.mocked(deleteExpense).mockResolvedValue(fail("Este gasto ya no existe (se eliminó)."));
    renderMonth([cafe, pan]);
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
    const { rerenderWith } = renderMonth([cafe, pan]);
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

  test("deleting the last expense of the filtered category takes the filter away, said", async () => {
    const user = userEvent.setup();
    const cafe = expense({ description: "Café", category: COMIDA });
    const pan = expense({ description: "Pan", category: CASA });
    vi.mocked(deleteExpense).mockImplementation(hang);
    renderMonth([cafe, pan]);
    await user.click(screen.getByRole("button", { name: /^Comida,/ }));
    expect(screen.queryByRole("button", { name: /^Editar Pan/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: /^Editar Café/ }));
    await user.click(screen.getByRole("button", { name: "Eliminar gasto" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Quitar filtro" })).toBeNull());
    expect(screen.getByRole("button", { name: /^Editar Pan/ })).toBeInTheDocument();
    await waitFor(() =>
      expect(announcer()).toHaveTextContent(
        "Ya no quedan gastos de Comida este mes: se quitó el filtro.",
      ),
    );
  });

  test("a new expense of another category takes the filter away; one of the same keeps it", async () => {
    const user = userEvent.setup();
    const cafe = expense({ description: "Café", category: COMIDA });
    const pan = expense({ description: "Pan", category: CASA });
    const { rerenderWith } = renderMonth([cafe, pan]);
    await user.click(screen.getByRole("button", { name: /^Comida,/ }));
    // Positive control: a new one in the filtered category keeps the filter.
    const mercado = expense({ description: "Mercado", category: COMIDA });
    rerenderWith([mercado, cafe, pan], "2026-10");
    expect(screen.getByRole("button", { name: "Quitar filtro" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Editar / })).toHaveLength(2);
    // A new one elsewhere (the sheet or the quick capture): the whole month shows, said once.
    const agua = expense({ description: "Agua", category: CASA });
    rerenderWith([agua, mercado, cafe, pan], "2026-10");
    expect(screen.queryByRole("button", { name: "Quitar filtro" })).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Editar / })).toHaveLength(4);
    await waitFor(() =>
      expect(announcer()).toHaveTextContent(
        "Se quitó el filtro de Comida para mostrar el gasto nuevo: 4 gastos del mes.",
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
    expect(screen.getByRole("button", { name: "Quitar filtro" })).toBeInTheDocument();
  });

  test("each bar is described by the hint; a bar with nothing in PEN draws no fill", () => {
    renderMonth([
      expense({ amountCents: 500, category: CASA }),
      expense({ currency: "USD", amountCents: 900, category: COMIDA }),
    ]);
    const casa = screen.getByRole("button", { name: /^Casa,/ });
    const comida = screen.getByRole("button", { name: /^Comida,/ });
    expect(casa).toHaveAccessibleDescription("Toca una categoría para ver solo sus gastos.");
    expect(screen.getByRole("list", { name: "Por categoría" })).not.toHaveAttribute(
      "aria-describedby",
    );
    expect(casa.querySelector(".bo-summary-bar__fill")).not.toBeNull();
    expect(comida.querySelector(".bo-summary-bar")).not.toBeNull();
    expect(comida.querySelector(".bo-summary-bar__fill")).toBeNull();
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
