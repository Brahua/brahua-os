// F1 of `finance` against a fake server: the expense sheet (decimal keyboard, Enter saves with the
// defaults, ready for the next one with its in-sheet "Deshacer", errors on their field), the quick
// capture's "Gasto", /finance "Mes" (the list by day, edit, delete with "Deshacer") and "Ajustes".
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import FinancePage from "@/app/(app)/finance/page";
import { fail, INVALID_FIELDS_MESSAGE, ok, type ActionResult } from "@/lib/action-result";
import { requireOwner } from "@/lib/auth";
import {
  createExpense,
  deleteExpense,
  editExpense,
  restoreExpense,
} from "@/modules/finance/actions";
import {
  createCategory,
  readFinanceCatalog,
  reorderCategories,
  setExchangeRate,
} from "@/modules/finance/catalog-actions";
import type { FinanceCatalog } from "@/modules/finance/catalog-input";
import { ExpenseCaptureSheet } from "@/modules/finance/components/expense-capture-sheet";
import { ExpenseSheet } from "@/modules/finance/components/expense-sheet";
import { FinanceScreen } from "@/modules/finance/components/finance-screen";
import { MonthView } from "@/modules/finance/components/month-view";
import { SettingsSheet } from "@/modules/finance/components/settings-sheet";
import type { ExpenseItem } from "@/modules/finance/expense-input";
import { CATALOG_ERRORS, EXPENSE_ERRORS } from "@/modules/finance/finance-copy";
import { getPaymentsView } from "@/modules/finance/payment-queries";
import { getFinanceCatalog, listMonthExpenses } from "@/modules/finance/queries";

const cookieJar = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (cookieJar.value ? { value: cookieJar.value } : undefined) }),
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/lib/auth", () => ({ requireOwner: vi.fn() }));
// The month's total (F3): NumberFlow's custom element doesn't run in jsdom.
vi.mock("@number-flow/react", () => ({ default: ({ value }: { value: number }) => <>{value}</> }));
vi.mock("@/modules/finance/queries", () => ({
  getFinanceCatalog: vi.fn(),
  listMonthExpenses: vi.fn(),
}));
vi.mock("@/modules/finance/payment-queries", () => ({
  getPaymentsView: vi.fn(),
  getDeletedRecurringName: vi.fn(),
}));
vi.mock("@/modules/finance/payment-actions", () => ({}));
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
const COMIDA = { id: "11111111-1111-4111-8111-111111111111", name: "Comida", sortOrder: 0 };
const CASA = { id: "11111111-1111-4111-8111-222222222222", name: "Casa", sortOrder: 1 };
const DEBITO = {
  id: "22222222-2222-4222-8222-111111111111",
  name: "Débito dólares",
  currency: "USD" as const,
  sortOrder: 0,
};
const EFECTIVO = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Efectivo",
  currency: "PEN" as const,
  sortOrder: 1,
};
const CATALOG: FinanceCatalog = {
  categories: [COMIDA, CASA],
  methods: [DEBITO, EFECTIVO],
  archivedCategories: [],
  archivedMethods: [],
  usdToPenE4: 37_500,
  lastPaymentMethodId: EFECTIVO.id,
};

let serial = 0;
function expense(values: Partial<ExpenseItem> = {}): ExpenseItem {
  serial += 1;
  return {
    id: `33333333-3333-4333-8333-${String(serial).padStart(12, "0")}`,
    description: null,
    amountCents: 1250,
    currency: "PEN",
    exchangeRateE4: null,
    spentOn: TODAY,
    category: null,
    paymentMethod: null,
    recurringPaymentId: null,
    ...values,
  };
}

/** The amount field and the rest, by their labels. */
/** "Monto en soles" or "Monto en dólares": the label says the currency. */
const amountField = () => screen.getByRole("textbox", { name: /^Monto en/ });

beforeEach(() => {
  window.matchMedia = vi.fn((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  vi.useFakeTimers({ toFake: ["Date"] });
  // 10:00 in Lima.
  vi.setSystemTime(new Date("2026-10-05T15:00:00.000Z"));
  for (const action of [createExpense, editExpense, deleteExpense, restoreExpense]) {
    vi.mocked(action).mockReset();
  }
  vi.mocked(readFinanceCatalog).mockReset().mockResolvedValue(ok(CATALOG));
  cookieJar.value = undefined;
  return () => vi.useRealTimers();
});

describe("ExpenseSheet (new)", () => {
  function renderNew(catalog: FinanceCatalog | null = CATALOG) {
    const onSaved = vi.fn();
    render(
      <ExpenseSheet
        open
        onOpenChange={vi.fn()}
        returnFocusRef={createRef()}
        catalog={catalog}
        today={TODAY}
        onSaved={onSaved}
      />,
    );
    return { onSaved };
  }

  test("the amount has focus with the decimal keyboard; the rest waits under Más", async () => {
    renderNew();
    expect(screen.getByRole("dialog", { name: "Nuevo gasto" })).toBeInTheDocument();
    await waitFor(() => expect(amountField()).toHaveFocus());
    expect(amountField()).toHaveAttribute("inputmode", "decimal");
    expect(screen.getByRole("textbox", { name: "Descripción (opcional)" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Más" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("combobox", { name: "Categoría" })).toBeNull();
  });

  test("Enter saves with the defaults; it stays open, empty and focused, with Deshacer", async () => {
    const user = userEvent.setup();
    const saved = expense({
      amountCents: 1250,
      paymentMethod: { id: EFECTIVO.id, name: "Efectivo" },
    });
    vi.mocked(createExpense).mockResolvedValue(ok(saved));
    vi.mocked(deleteExpense).mockResolvedValue(ok(saved));
    const { onSaved } = renderNew();
    await user.type(amountField(), "12,50{Enter}");
    expect(createExpense).toHaveBeenCalledWith({
      amount: "12,50",
      description: "",
      categoryId: "",
      paymentMethodId: EFECTIVO.id,
      currency: "PEN",
    });
    await waitFor(() => expect(amountField()).toHaveValue(""));
    expect(amountField()).toHaveFocus();
    expect(onSaved).toHaveBeenCalledWith(saved);
    const confirmation = document.querySelector("[data-expense-saved]")!;
    expect(confirmation.textContent).toContain("Registrado: 12.50 soles.");
    await waitFor(() =>
      expect(document.querySelector("[data-expense-status]")).toHaveTextContent(
        "Registrado: 12.50 soles.",
      ),
    );

    await user.click(within(confirmation as HTMLElement).getByRole("button", { name: "Deshacer" }));
    expect(deleteExpense).toHaveBeenCalledWith({ id: saved.id });
    await waitFor(() => expect(document.querySelector("[data-expense-saved]")).toBeNull());
    expect(amountField()).toHaveFocus();
  });

  test("an invalid amount is refused on its field without calling the server", async () => {
    const user = userEvent.setup();
    renderNew();
    await user.type(amountField(), "0{Enter}");
    expect(createExpense).not.toHaveBeenCalled();
    expect(amountField()).toHaveAccessibleDescription(EXPENSE_ERRORS.amount.tooSmall);
    await user.clear(amountField());
    await user.type(amountField(), "12.345{Enter}");
    expect(amountField()).toHaveAccessibleDescription(EXPENSE_ERRORS.amount.decimals);
  });

  test("a refused category opens Más and shows the error on its field", async () => {
    const user = userEvent.setup();
    vi.mocked(createExpense).mockResolvedValue({
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: { categoryId: [EXPENSE_ERRORS.categoryUnavailable] },
    });
    renderNew();
    await user.click(screen.getByRole("button", { name: "Más" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Categoría" }), "Comida");
    await user.type(amountField(), "5{Enter}");
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Categoría" })).toHaveAccessibleDescription(
        EXPENSE_ERRORS.categoryUnavailable,
      ),
    );
    expect(amountField()).toHaveValue("5");
  });

  test("the currency follows the method until picked; USD shows the rate it will store", async () => {
    const user = userEvent.setup();
    vi.mocked(createExpense).mockResolvedValue(ok(expense()));
    renderNew();
    await user.click(screen.getByRole("button", { name: "Más" }));
    const method = screen.getByRole("combobox", { name: "Medio de pago" });
    expect(method).toHaveValue(EFECTIVO.id);
    expect(screen.getByRole("radio", { name: "Soles" })).toHaveAttribute("aria-checked", "true");
    await user.selectOptions(method, "Débito dólares");
    expect(screen.getByRole("radio", { name: "Dólares" })).toHaveAttribute("aria-checked", "true");
    // The currency shows next to the amount, and the help is tied to the currency picker.
    expect(screen.getByRole("textbox", { name: "Monto en dólares" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Moneda" })).toHaveAccessibleDescription(
      "Se guardará con el tipo de cambio de Ajustes: S/ 3.75 por dólar.",
    );
    expect(document.querySelector("[data-rate-help]")).toHaveTextContent(
      "Se guardará con el tipo de cambio de Ajustes: S/ 3.75 por dólar.",
    );
    // Picked by hand, it stays when the method changes.
    await user.click(screen.getByRole("radio", { name: "Soles" }));
    await user.selectOptions(method, "Débito dólares");
    expect(screen.getByRole("radio", { name: "Soles" })).toHaveAttribute("aria-checked", "true");
    await user.type(amountField(), "95{Enter}");
    expect(createExpense).toHaveBeenCalledWith(
      expect.objectContaining({ paymentMethodId: DEBITO.id, currency: "PEN" }),
    );
  });

  test("without a rate, USD says it will be summed apart", async () => {
    const user = userEvent.setup();
    renderNew({ ...CATALOG, usdToPenE4: null, lastPaymentMethodId: DEBITO.id });
    await user.click(screen.getByRole("button", { name: "Más" }));
    expect(document.querySelector("[data-rate-help]")).toHaveTextContent("sin convertir");
  });

  test("before the catalog arrives, the method, currency and date are left to the server", async () => {
    const user = userEvent.setup();
    vi.mocked(createExpense).mockResolvedValue(ok(expense()));
    renderNew(null);
    await user.type(amountField(), "3{Enter}");
    expect(createExpense).toHaveBeenCalledWith({ amount: "3", description: "", categoryId: "" });
  });

  test("a refused save keeps the amount and says why; a network failure asks to check it", async () => {
    const user = userEvent.setup();
    vi.mocked(createExpense).mockResolvedValueOnce(fail("No se pudo guardar. Inténtalo de nuevo."));
    renderNew();
    await user.type(amountField(), "7{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo guardar. Inténtalo de nuevo.",
    );
    expect(amountField()).toHaveValue("7");
    vi.mocked(createExpense).mockRejectedValueOnce(new Error("offline"));
    await user.type(amountField(), "{Enter}");
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Revisa tu conexión e inténtalo de nuevo.",
      ),
    );
    expect(amountField()).toHaveValue("7");
    expect(document.querySelector("[data-expense-saved]")).toBeNull();
  });

  test("Enter twice while saving sends one expense", async () => {
    const user = userEvent.setup();
    let answer: (result: ActionResult<ExpenseItem>) => void = () => {};
    vi.mocked(createExpense).mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    renderNew();
    await user.type(amountField(), "5{Enter}{Enter}");
    expect(createExpense).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Guardando…" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await act(async () => answer(ok(expense({ amountCents: 500 }))));
    expect(createExpense).toHaveBeenCalledTimes(1);
  });

  test("a failed Deshacer keeps the confirmation and says it couldn't undo", async () => {
    const user = userEvent.setup();
    vi.mocked(createExpense).mockResolvedValue(ok(expense()));
    vi.mocked(deleteExpense).mockResolvedValue(fail(EXPENSE_ERRORS.notFound));
    renderNew();
    await user.type(amountField(), "12.50{Enter}");
    const confirmation = await waitFor(() => document.querySelector("[data-expense-saved]")!);
    await user.click(within(confirmation as HTMLElement).getByRole("button", { name: "Deshacer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      `No se pudo deshacer. ${EXPENSE_ERRORS.notFound}`,
    );
    expect(document.querySelector("[data-expense-saved]")).not.toBeNull();
  });
});

describe("ExpenseSheet (edit)", () => {
  test("every field shows its value; an archived category stays listed; Guardar closes it", async () => {
    const user = userEvent.setup();
    const current = expense({
      description: "Claude",
      amountCents: 9500,
      currency: "USD",
      exchangeRateE4: 37_000,
      category: { id: "11111111-1111-4111-8111-999999999999", name: "Viejos" },
      paymentMethod: { id: DEBITO.id, name: DEBITO.name },
      spentOn: "2026-10-01",
    });
    vi.mocked(editExpense).mockResolvedValue(ok(current));
    const onOpenChange = vi.fn();
    const onSaved = vi.fn();
    render(
      <ExpenseSheet
        open
        onOpenChange={onOpenChange}
        expense={current}
        catalog={CATALOG}
        today={TODAY}
        onSaved={onSaved}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByRole("dialog", { name: "Editar gasto" })).toBeInTheDocument();
    expect(amountField()).toHaveValue("95");
    expect(screen.getByRole("combobox", { name: "Categoría" })).toHaveDisplayValue(
      "Viejos (archivado)",
    );
    expect(screen.getByLabelText("Fecha")).toHaveValue("2026-10-01");
    expect(document.querySelector("[data-rate-help]")).toHaveTextContent(
      "Guardado con S/ 3.70 por dólar.",
    );
    // Another amount: the current rate.
    await user.clear(amountField());
    await user.type(amountField(), "100");
    expect(document.querySelector("[data-rate-help]")).toHaveTextContent("S/ 3.75 por dólar");

    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(editExpense).toHaveBeenCalledWith({
      id: current.id,
      amount: "100",
      description: "Claude",
      categoryId: "11111111-1111-4111-8111-999999999999",
      paymentMethodId: DEBITO.id,
      currency: "USD",
      spentOn: "2026-10-01",
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onSaved).toHaveBeenCalledWith(current);
  });
});

describe("the quick capture's Gasto", () => {
  test("reads the catalog when it opens and shows the shell's switch first", async () => {
    render(
      <ExpenseCaptureSheet
        open
        onOpenChange={vi.fn()}
        returnFocusRef={createRef()}
        switcher={<div role="radiogroup" aria-label="Qué capturar" />}
      />,
    );
    expect(readFinanceCatalog).toHaveBeenCalledWith({});
    const dialog = screen.getByRole("dialog", { name: "Nuevo gasto" });
    expect(within(dialog).getByRole("radiogroup", { name: "Qué capturar" })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Más" }));
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Medio de pago" })).toHaveValue(EFECTIVO.id),
    );
  });

  test("if the catalog can't load, it says so and can still save", async () => {
    vi.mocked(readFinanceCatalog).mockRejectedValue(new Error("offline"));
    render(<ExpenseCaptureSheet open onOpenChange={vi.fn()} returnFocusRef={createRef()} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Más" }));
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Categoría" })).toHaveAccessibleDescription(
        "No se pudieron cargar las categorías y los medios. Puedes guardar igual.",
      ),
    );
  });
});

describe("/finance", () => {
  function renderMonth(expenses: ExpenseItem[]) {
    return render(
      <FinanceScreen today={TODAY} catalog={CATALOG}>
        <MonthView month="2026-10" expenses={expenses} />
      </FinanceScreen>,
    );
  }

  test("the page checks the owner, reads the month and remembers the view", async () => {
    vi.mocked(getFinanceCatalog).mockResolvedValue(CATALOG);
    vi.mocked(listMonthExpenses).mockResolvedValue([]);
    vi.mocked(getPaymentsView).mockResolvedValue({
      today: TODAY,
      pending: [],
      thisMonth: [],
      active: [],
      archived: [],
    });
    cookieJar.value = "payments";
    render(await FinancePage({ searchParams: Promise.resolve({ mes: "2026-09" }) }));
    expect(requireOwner).toHaveBeenCalled();
    expect(listMonthExpenses).toHaveBeenCalledWith("2026-09");
    expect(screen.getByRole("heading", { level: 1, name: "Finanzas" })).toBeInTheDocument();
    const tabs = screen.getByRole("tablist", { name: "Vista de Finanzas" });
    expect(within(tabs).getByRole("tab", { name: "Pagos" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(document.querySelector('[data-finance-view="month"]')).toHaveAttribute("hidden");
    // F2: "Pagos" shows its sections.
    expect(getPaymentsView).toHaveBeenCalledWith(TODAY);
    expect(screen.getByRole("heading", { level: 2, name: "Pendientes" })).toBeVisible();
    // Switching writes the cookie.
    await userEvent.setup().click(within(tabs).getByRole("tab", { name: "Mes" }));
    expect(document.cookie).toContain("bo_finance_view=month");
    expect(screen.getByRole("heading", { level: 2, name: "Setiembre 2026" })).toBeVisible();
    expect(screen.getByText("Sin gastos este mes")).toBeVisible();
  });

  test("the month's expenses by day, the most recent first, with USD converted", () => {
    renderMonth([
      expense({ description: "Café", paymentMethod: { id: EFECTIVO.id, name: "Efectivo" } }),
      expense({
        spentOn: "2026-10-04",
        currency: "USD",
        amountCents: 9500,
        exchangeRateE4: 37_500,
        category: { id: COMIDA.id, name: "Comida" },
      }),
      expense({ spentOn: "2026-10-01" }),
    ]);
    expect(screen.getByRole("heading", { level: 2, name: "Octubre 2026" })).toBeInTheDocument();
    expect(
      screen.getAllByRole("heading", { level: 4 }).map((heading) => heading.textContent),
    ).toEqual(["Hoy", "Ayer", "Jueves 1 de octubre"]);
    const today = screen.getByRole("list", { name: "Hoy" });
    expect(within(today).getByRole("button").getAttribute("aria-label")).toBe(
      "Editar Café, 12.50 soles, Efectivo",
    );
    const yesterday = screen.getByRole("list", { name: "Ayer" });
    expect(within(yesterday).getByRole("button").getAttribute("aria-label")).toBe(
      "Editar Comida, 95 dólares, unos 356.25 soles",
    );
  });

  test("delete from the edit sheet: gone at once, Deshacer brings it back", async () => {
    const user = userEvent.setup();
    const cafe = expense({ description: "Café" });
    const pan = expense({ description: "Pan" });
    // The delete waits until the test answers it: meanwhile the row is gone (optimistic).
    let answer: (result: ActionResult<ExpenseItem>) => void = () => {};
    vi.mocked(deleteExpense).mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    vi.mocked(restoreExpense).mockResolvedValue(ok(cafe));
    renderMonth([cafe, pan]);
    await user.click(screen.getByRole("button", { name: /^Editar Café/ }));
    await user.click(screen.getByRole("button", { name: "Eliminar gasto" }));
    expect(deleteExpense).toHaveBeenCalledWith({ id: cafe.id });
    await waitFor(() => expect(screen.queryByRole("button", { name: /^Editar Café/ })).toBeNull());
    // Focus goes to the next row once the sheet is gone.
    await waitFor(() => expect(screen.getByRole("button", { name: /^Editar Pan/ })).toHaveFocus());
    await act(async () => answer(ok(cafe)));
    const notices = screen.getByRole("region", { name: "Avisos de Finanzas" });
    await waitFor(() => expect(within(notices).getByText("Gasto eliminado")).toBeInTheDocument());
    await user.click(within(notices).getByRole("button", { name: "Deshacer" }));
    expect(restoreExpense).toHaveBeenCalledWith({ id: cafe.id });
  });

  test("a delete the server refuses puts the row back and says why", async () => {
    const user = userEvent.setup();
    const cafe = expense({ description: "Café" });
    vi.mocked(deleteExpense).mockResolvedValue(fail(EXPENSE_ERRORS.notFound));
    renderMonth([cafe]);
    await user.click(screen.getByRole("button", { name: /^Editar Café/ }));
    await user.click(screen.getByRole("button", { name: "Eliminar gasto" }));
    const notices = screen.getByRole("region", { name: "Avisos de Finanzas" });
    await waitFor(() => expect(within(notices).getByText("Sin guardar")).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Editar Café/ })).toBeInTheDocument(),
    );
  });
});

describe("/finance failures", () => {
  function renderMonth(expenses: ExpenseItem[]) {
    return render(
      <FinanceScreen today={TODAY} catalog={CATALOG}>
        <MonthView month="2026-10" expenses={expenses} />
      </FinanceScreen>,
    );
  }

  test("a failed restore says so", async () => {
    const user = userEvent.setup();
    const cafe = expense({ description: "Café" });
    vi.mocked(deleteExpense).mockResolvedValue(ok(cafe));
    vi.mocked(restoreExpense).mockResolvedValue(fail(EXPENSE_ERRORS.notFound));
    renderMonth([cafe]);
    await user.click(screen.getByRole("button", { name: /^Editar Café/ }));
    await user.click(screen.getByRole("button", { name: "Eliminar gasto" }));
    const notices = screen.getByRole("region", { name: "Avisos de Finanzas" });
    await waitFor(() => expect(within(notices).getByText("Gasto eliminado")).toBeInTheDocument());
    await user.click(within(notices).getByRole("button", { name: "Deshacer" }));
    expect(restoreExpense).toHaveBeenCalledWith({ id: cafe.id });
    await waitFor(() =>
      expect(within(notices).getByText(/No se pudo deshacer/)).toBeInTheDocument(),
    );
  });

  test("a refused edit keeps the sheet open with the reason", async () => {
    const user = userEvent.setup();
    const cafe = expense({ description: "Café" });
    vi.mocked(editExpense).mockResolvedValue(fail(EXPENSE_ERRORS.notFound));
    renderMonth([cafe]);
    await user.click(screen.getByRole("button", { name: /^Editar Café/ }));
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    const sheet = screen.getByRole("dialog", { name: "Editar gasto" });
    expect(await within(sheet).findByRole("alert")).toHaveTextContent(EXPENSE_ERRORS.notFound);
    expect(screen.getByRole("dialog", { name: "Editar gasto" })).toBeInTheDocument();
  });
});

describe("Ajustes", () => {
  function renderSettings() {
    render(
      <SettingsSheet
        open
        onOpenChange={vi.fn()}
        returnFocusRef={createRef()}
        initialCatalog={CATALOG}
      />,
    );
    return screen.getByRole("dialog", { name: "Ajustes de Finanzas" });
  }

  test("a new category is added and the field is ready for the next one", async () => {
    const user = userEvent.setup();
    const next = {
      ...CATALOG,
      categories: [...CATALOG.categories, { id: "x", name: "Salud", sortOrder: 2 }],
    };
    vi.mocked(createCategory).mockResolvedValue(ok(next));
    const sheet = renderSettings();
    const field = within(sheet).getByRole("textbox", { name: "Nueva categoría" });
    await user.type(field, "Salud{Enter}");
    expect(createCategory).toHaveBeenCalledWith({ name: "Salud" });
    const list = within(sheet).getByRole("list", { name: "Categorías" });
    await waitFor(() => expect(within(list).getByText("Salud")).toBeInTheDocument());
    expect(field).toHaveValue("");
    expect(field).toHaveFocus();
  });

  test("a taken name shows on the field", async () => {
    const user = userEvent.setup();
    vi.mocked(createCategory).mockResolvedValue({
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: { name: [CATALOG_ERRORS.categoryTaken] },
    });
    const sheet = renderSettings();
    const field = within(sheet).getByRole("textbox", { name: "Nueva categoría" });
    await user.type(field, "comida{Enter}");
    await waitFor(() => expect(field).toHaveAccessibleDescription(CATALOG_ERRORS.categoryTaken));
    expect(field).toHaveValue("comida");
  });

  test("move up and down: the first can't go up; the order sent is the whole list", async () => {
    const user = userEvent.setup();
    vi.mocked(reorderCategories).mockResolvedValue(ok({ ...CATALOG, categories: [CASA, COMIDA] }));
    const sheet = renderSettings();
    expect(within(sheet).getByRole("button", { name: "Subir «Comida»" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await user.click(within(sheet).getByRole("button", { name: "Subir «Comida»" }));
    expect(reorderCategories).not.toHaveBeenCalled();
    await user.click(within(sheet).getByRole("button", { name: "Bajar «Comida»" }));
    expect(reorderCategories).toHaveBeenCalledWith({ ids: [CASA.id, COMIDA.id] });
    const list = within(sheet).getByRole("list", { name: "Categorías" });
    await waitFor(() =>
      expect(
        within(list)
          .getAllByRole("listitem")
          .map((item) => item.textContent),
      ).toEqual(["Casa", "Comida"]),
    );
  });

  test("Esc inside an inline edit cancels the edit, not the sheet", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <SettingsSheet
        open
        onOpenChange={onOpenChange}
        returnFocusRef={createRef()}
        initialCatalog={CATALOG}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Editar «Comida»" }));
    const name = await screen.findByRole("textbox", { name: "Nombre" });
    await waitFor(() => expect(name).toHaveFocus());
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Editar «Comida»" })).toHaveFocus(),
    );
    expect(screen.queryByRole("textbox", { name: "Nombre" })).toBeNull();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    // Positive control: Esc outside an edit closes the sheet.
    await user.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test("the rate: validated in the form, then saved", async () => {
    const user = userEvent.setup();
    vi.mocked(setExchangeRate).mockResolvedValue(ok({ ...CATALOG, usdToPenE4: 38_000 }));
    const sheet = renderSettings();
    const field = within(sheet).getByRole("textbox", { name: "Soles por 1 dólar" });
    expect(field).toHaveValue("3.75");
    await user.clear(field);
    await user.type(field, "12");
    await user.click(within(sheet).getByRole("button", { name: "Guardar tipo de cambio" }));
    expect(setExchangeRate).not.toHaveBeenCalled();
    expect(field).toHaveAccessibleDescription("Debe estar entre 1 y 10 soles por dólar.");
    await user.clear(field);
    await user.type(field, "3,8");
    await user.click(within(sheet).getByRole("button", { name: "Guardar tipo de cambio" }));
    expect(setExchangeRate).toHaveBeenCalledWith({ rate: "3,8" });
    await waitFor(() => expect(field).toHaveValue("3.8"));
    await act(async () => {});
  });
});
