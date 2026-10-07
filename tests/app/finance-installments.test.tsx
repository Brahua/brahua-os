// Installments (polish → installments) against a fake server: the "Termina después de N pagos"
// field of the "Pago recurrente" sheet (monthly only, refused N shown on its field), "Cuota 3 de 6"
// in Pendientes, Este mes and the payment's page, and the last installment's notice ("Se archiva
// solo") whose "Deshacer" hands back the archive's stamp.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { INVALID_FIELDS_MESSAGE, ok } from "@/lib/action-result";
import type { FinanceCatalog } from "@/modules/finance/catalog-input";
import { FinanceScreen } from "@/modules/finance/components/finance-screen";
import { PaymentsView } from "@/modules/finance/components/payments-view";
import { RecurringDetail } from "@/modules/finance/components/recurring-detail";
import {
  createRecurringPayment,
  editRecurringPayment,
  markPaid,
  skipPeriod,
  undoPaid,
  undoSkipped,
} from "@/modules/finance/payment-actions";
import { RECURRING_ERRORS } from "@/modules/finance/payments-copy";
import { buildPaymentsView } from "@/modules/finance/payments-view";
import type { RecurringItem, SettlementItem } from "@/modules/finance/recurring-input";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => router,
}));
vi.mock("@/modules/finance/payment-actions", () => ({
  createRecurringPayment: vi.fn(),
  editRecurringPayment: vi.fn(),
  archiveRecurringPayment: vi.fn(),
  unarchiveRecurringPayment: vi.fn(),
  deleteRecurringPayment: vi.fn(),
  restoreRecurringPayment: vi.fn(),
  markPaid: vi.fn(),
  undoPaid: vi.fn(),
  skipPeriod: vi.fn(),
  undoSkipped: vi.fn(),
}));

const TODAY = "2026-10-05";
const CATALOG: FinanceCatalog = {
  categories: [],
  methods: [],
  archivedCategories: [],
  archivedMethods: [],
  usdToPenE4: null,
  lastPaymentMethodId: null,
};

const NOTEBOOK: RecurringItem = {
  id: "55555555-5555-4555-8555-000000000001",
  name: "Notebook",
  amountCents: 25_000,
  currency: "PEN",
  category: null,
  paymentMethod: null,
  cycle: "monthly",
  weekday: null,
  dayOfMonth: 5,
  intervalMonths: null,
  anchorMonth: null,
  // Cuotas on the 5th from June: today (Oct 5) is the 5th of 6.
  startDate: "2026-06-05",
  installmentsTotal: 6,
  notes: null,
  archived: false,
};

const expense = (id: string) => ({
  id,
  description: "Notebook",
  amountCents: 25_000,
  currency: "PEN" as const,
  exchangeRateE4: null,
  spentOn: TODAY,
  category: null,
  paymentMethod: null,
  recurringPaymentId: NOTEBOOK.id,
});

/** September's installment is settled (skipped): only today's is pending. */
const lastMonth = (item: RecurringItem): SettlementItem => ({
  recurringId: item.id,
  dueOn: "2026-09-05",
  status: "skipped",
  expense: null,
});

function renderView(items: RecurringItem[]) {
  return render(
    <FinanceScreen today={TODAY} catalog={CATALOG}>
      <PaymentsView data={buildPaymentsView(items, items.map(lastMonth), TODAY)} />
    </FinanceScreen>,
  );
}

const notices = () => screen.getByRole("region", { name: "Avisos de Finanzas" });

beforeEach(() => {
  window.matchMedia = vi.fn((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-05T15:00:00.000Z"));
  for (const action of [
    createRecurringPayment,
    editRecurringPayment,
    markPaid,
    undoPaid,
    skipPeriod,
    undoSkipped,
  ]) {
    vi.mocked(action).mockReset();
  }
  return () => vi.useRealTimers();
});

describe("the sheet's field", () => {
  async function openNew() {
    const user = userEvent.setup();
    renderView([]);
    await user.click(screen.getByRole("button", { name: "Nuevo pago recurrente" }));
    const sheet = await screen.findByRole("dialog", { name: "Nuevo pago recurrente" });
    return { user, sheet };
  }
  const field = (sheet: HTMLElement) =>
    within(sheet).getByRole("textbox", { name: "Termina después de N pagos (opcional)" });

  test("monthly shows it (empty); the other cycles hide it", async () => {
    const { user, sheet } = await openNew();
    expect(field(sheet)).toHaveValue("");
    const cycle = within(sheet).getByRole("combobox", { name: "Ciclo" });
    for (const other of ["weekly", "every_n_months", "yearly"]) {
      await user.selectOptions(cycle, other);
      expect(
        within(sheet).queryByRole("textbox", { name: /Termina después de N pagos/ }),
      ).toBeNull();
    }
    await user.selectOptions(cycle, "monthly");
    expect(field(sheet)).toBeInTheDocument();
  });

  test("N is sent as a number; empty is sent as none", async () => {
    vi.mocked(createRecurringPayment).mockResolvedValue(ok(NOTEBOOK));
    const { user, sheet } = await openNew();
    await user.type(within(sheet).getByRole("textbox", { name: "Nombre" }), "Notebook");
    await user.type(within(sheet).getByRole("textbox", { name: "Monto previsto en soles" }), "250");
    await user.type(field(sheet), "6");
    await user.click(within(sheet).getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(createRecurringPayment).toHaveBeenCalledWith(
        expect.objectContaining({ cycle: "monthly", installmentsTotal: 6 }),
      ),
    );
  });

  test("with the field empty it is sent as none (null)", async () => {
    vi.mocked(createRecurringPayment).mockResolvedValue(
      ok({ ...NOTEBOOK, installmentsTotal: null }),
    );
    const { user, sheet } = await openNew();
    await user.type(within(sheet).getByRole("textbox", { name: "Nombre" }), "Agua");
    await user.type(within(sheet).getByRole("textbox", { name: "Monto previsto en soles" }), "40");
    await user.click(within(sheet).getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(createRecurringPayment).toHaveBeenCalledWith(
        expect.objectContaining({ cycle: "monthly", installmentsTotal: null }),
      ),
    );
  });

  test("text or 0 is refused before the server, on the field", async () => {
    const { user, sheet } = await openNew();
    await user.type(within(sheet).getByRole("textbox", { name: "Nombre" }), "Notebook");
    await user.type(within(sheet).getByRole("textbox", { name: "Monto previsto en soles" }), "250");
    await user.type(field(sheet), "seis");
    await user.click(within(sheet).getByRole("button", { name: "Guardar" }));
    expect(createRecurringPayment).not.toHaveBeenCalled();
    expect(within(sheet).getByText(RECURRING_ERRORS.installmentsRange)).toBeInTheDocument();
    await waitFor(() => expect(field(sheet)).toHaveFocus());
    // Typing again clears the error: the second message below is a new one, not the old one.
    await user.clear(field(sheet));
    await waitFor(() =>
      expect(within(sheet).queryByText(RECURRING_ERRORS.installmentsRange)).toBeNull(),
    );
    await user.type(field(sheet), "0");
    await user.click(within(sheet).getByRole("button", { name: "Guardar" }));
    expect(createRecurringPayment).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(within(sheet).getByText(RECURRING_ERRORS.installmentsRange)).toBeInTheDocument(),
    );
  });

  test("editing: N below what is settled comes back on its field with the lowest N", async () => {
    const user = userEvent.setup();
    vi.mocked(editRecurringPayment).mockResolvedValue({
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: { installmentsTotal: [RECURRING_ERRORS.installmentsTooLow(4)] },
    });
    render(
      <FinanceScreen today={TODAY} catalog={CATALOG}>
        <RecurringDetail item={NOTEBOOK} headingId="t" nextDues={[]} history={[]} />
      </FinanceScreen>,
    );
    await user.click(screen.getByRole("button", { name: "Editar" }));
    const sheet = await screen.findByRole("dialog", { name: "Editar pago recurrente" });
    expect(field(sheet)).toHaveValue("6");
    await user.clear(field(sheet));
    await user.type(field(sheet), "2");
    await user.click(within(sheet).getByRole("button", { name: "Guardar" }));
    expect(
      await within(sheet).findByText("Ya hay 4 cuotas pagadas u omitidas: escribe 4 o más."),
    ).toBeInTheDocument();
    expect(editRecurringPayment).toHaveBeenCalledWith(
      expect.objectContaining({ id: NOTEBOOK.id, installmentsTotal: 2 }),
    );
    await waitFor(() => expect(field(sheet)).toHaveFocus());
  });
});

describe("Cuota 3 de 6", () => {
  test("Pendientes and Este mes say the installment; the cycle says how many", () => {
    renderView([NOTEBOOK]);
    const pending = screen.getByRole("list", { name: "Pendientes" });
    expect(within(pending).getByText("Cuota 5 de 6")).toBeInTheDocument();
    const month = document.querySelector(`[data-month-row="${NOTEBOOK.id}"]`);
    expect(month).toHaveTextContent("Cuota 5 de 6");
    // The name is described with it for screen readers.
    expect(within(pending).getByRole("link", { name: "Notebook" })).toHaveAccessibleDescription(
      /Cuota 5 de 6/,
    );
    expect(
      within(screen.getByRole("list", { name: "Todos" })).getByRole("link", { name: /Notebook/ }),
    ).toHaveTextContent("Mensual, día 5 · 6 cuotas");
  });

  test("a payment without installments says nothing", () => {
    renderView([{ ...NOTEBOOK, installmentsTotal: null }]);
    expect(screen.queryByText(/Cuota \d+ de/)).toBeNull();
  });

  test("a plan that ended unsettled is Terminado in Archivados, with nothing to reactivate", () => {
    renderView([{ ...NOTEBOOK, startDate: "2025-01-05", installmentsTotal: 3 }]);
    expect(screen.queryByRole("list", { name: "Todos" })).toBeNull();
    expect(screen.getByText(/· Terminado/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reactivar/ })).toBeNull();
  });

  test("the payment's page: the installment of each next due date, or none left", () => {
    const { rerender } = render(
      <FinanceScreen today={TODAY} catalog={CATALOG}>
        <RecurringDetail
          item={NOTEBOOK}
          headingId="t"
          nextDues={["2026-10-05", "2026-11-05"]}
          history={[]}
        />
      </FinanceScreen>,
    );
    const next = screen.getByRole("list", { name: "Próximos vencimientos" });
    expect(next).toHaveTextContent("Cuota 5 de 6");
    expect(next).toHaveTextContent("Cuota 6 de 6");
    rerender(
      <FinanceScreen today={TODAY} catalog={CATALOG}>
        <RecurringDetail item={NOTEBOOK} headingId="t" nextDues={[]} history={[]} />
      </FinanceScreen>,
    );
    expect(screen.getByText(/Ya no quedan vencimientos/)).toBeInTheDocument();
  });
});

describe("the last installment", () => {
  const LAST = { ...NOTEBOOK, startDate: "2026-05-05", installmentsTotal: 6 }; // Oct 5 is the 6th

  test("the notice says it archives itself; Deshacer hands back the stamp", async () => {
    const user = userEvent.setup();
    vi.mocked(markPaid).mockResolvedValue(
      ok({
        dueOn: TODAY,
        name: "Notebook",
        closedStamp: "2026-10-05T15:00:00.123456Z",
        expense: expense("e-last"),
      }),
    );
    vi.mocked(undoPaid).mockResolvedValue(
      ok({ dueOn: TODAY, reopened: true, stillArchived: false }),
    );
    renderView([LAST]);
    expect(screen.getByText("Cuota 6 de 6")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Pagado: Notebook,/ }));
    expect(
      await within(notices()).findByText("Última cuota de «Notebook». Se archiva solo."),
    ).toBeVisible();
    await user.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    await waitFor(() =>
      expect(undoPaid).toHaveBeenCalledWith({
        id: LAST.id,
        dueOn: TODAY,
        expenseId: "e-last",
        reopenStamp: "2026-10-05T15:00:00.123456Z",
      }),
    );
  });

  test("a pay that did not close the payment keeps the usual notice and no stamp", async () => {
    const user = userEvent.setup();
    vi.mocked(markPaid).mockResolvedValue(
      ok({ dueOn: TODAY, name: "Notebook", closedStamp: null, expense: expense("e-5") }),
    );
    vi.mocked(undoPaid).mockResolvedValue(
      ok({ dueOn: TODAY, reopened: false, stillArchived: false }),
    );
    renderView([NOTEBOOK]);
    await user.click(screen.getByRole("button", { name: /^Pagado: Notebook,/ }));
    expect(await within(notices()).findByText("Notebook · 250 soles")).toBeVisible();
    await user.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    await waitFor(() =>
      expect(undoPaid).toHaveBeenCalledWith({ id: NOTEBOOK.id, dueOn: TODAY, expenseId: "e-5" }),
    );
  });

  test("skipping the last one closes it too, and says so", async () => {
    const user = userEvent.setup();
    vi.mocked(skipPeriod).mockResolvedValue(
      ok({ dueOn: TODAY, name: "Notebook", closedStamp: "2026-10-05T15:00:00.654321Z" }),
    );
    vi.mocked(undoSkipped).mockResolvedValue(
      ok({ dueOn: TODAY, reopened: true, stillArchived: false }),
    );
    renderView([LAST]);
    await user.click(screen.getByRole("button", { name: "Más acciones de Notebook" }));
    const sheet = await screen.findByRole("dialog", { name: "Registrar pago de Notebook" });
    await user.click(within(sheet).getByRole("button", { name: "Omitir este período" }));
    expect(
      await within(notices()).findByText("Última cuota de «Notebook». Se archiva solo."),
    ).toBeVisible();
    await user.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    await waitFor(() =>
      expect(undoSkipped).toHaveBeenCalledWith({
        id: LAST.id,
        dueOn: TODAY,
        reopenStamp: "2026-10-05T15:00:00.654321Z",
      }),
    );
  });
});
