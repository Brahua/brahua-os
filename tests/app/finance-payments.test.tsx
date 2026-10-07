// F2 of `finance` against a fake server: "Pagos" (one-tap "Pagado" with focus moving on and
// "Deshacer", rollback on failure, the "Pagado…" sheet for a variable amount, "Omitir este
// período"), the "Pago recurrente" sheet, the payment's page and its route.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import PaymentPage from "@/app/(app)/finance/payments/[id]/page";
import { fail, INVALID_FIELDS_MESSAGE, ok } from "@/lib/action-result";
import { requireOwner } from "@/lib/auth";
import type { FinanceCatalog } from "@/modules/finance/catalog-input";
import { ExpenseSheet } from "@/modules/finance/components/expense-sheet";
import { FinanceScreen } from "@/modules/finance/components/finance-screen";
import { PaymentsDeletedNotice } from "@/modules/finance/components/payments-deleted-notice";
import { PaymentsView } from "@/modules/finance/components/payments-view";
import { RecurringDetail } from "@/modules/finance/components/recurring-detail";
import {
  archiveRecurringPayment,
  createRecurringPayment,
  deleteRecurringPayment,
  markPaid,
  restoreRecurringPayment,
  skipPeriod,
  unarchiveRecurringPayment,
  undoPaid,
} from "@/modules/finance/payment-actions";
import { getRecurringDetail } from "@/modules/finance/payment-queries";
import { RECURRING_ERRORS } from "@/modules/finance/payments-copy";
import { buildPaymentsView } from "@/modules/finance/payments-view";
import { getFinanceCatalog } from "@/modules/finance/queries";
import type { RecurringItem } from "@/modules/finance/recurring-input";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => router,
}));
vi.mock("@/lib/auth", () => ({ requireOwner: vi.fn() }));
vi.mock("@/modules/finance/actions", () => ({
  createExpense: vi.fn(),
  editExpense: vi.fn(),
  deleteExpense: vi.fn(),
  restoreExpense: vi.fn(),
}));
vi.mock("@/modules/finance/queries", () => ({ getFinanceCatalog: vi.fn() }));
vi.mock("@/modules/finance/payment-queries", () => ({ getRecurringDetail: vi.fn() }));
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
const TARJETA = {
  id: "22222222-2222-4222-8222-111111111111",
  name: "Tarjeta",
  currency: "PEN" as const,
  sortOrder: 0,
};
const YAPE = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Yape",
  currency: "PEN" as const,
  sortOrder: 1,
};
const CATALOG: FinanceCatalog = {
  categories: [],
  methods: [TARJETA, YAPE],
  archivedCategories: [],
  archivedMethods: [],
  usdToPenE4: null,
  lastPaymentMethodId: null,
};

let serial = 0;
function item(values: Partial<RecurringItem> = {}): RecurringItem {
  serial += 1;
  return {
    id: `55555555-5555-4555-8555-${String(serial).padStart(12, "0")}`,
    name: `Pago ${serial}`,
    amountCents: 5000,
    currency: "PEN",
    category: null,
    paymentMethod: { id: TARJETA.id, name: TARJETA.name },
    cycle: "monthly",
    weekday: null,
    dayOfMonth: 5,
    intervalMonths: null,
    anchorMonth: null,
    startDate: "2026-10-01",
    installmentsTotal: null,
    notes: null,
    archived: false,
    ...values,
  };
}

/**
 * A promise the test resolves. Never leave one pending: React entangles async transitions, so an
 * unresolved one would keep the next tests' transitions pending too.
 */
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve: (value: T) => resolve(value) };
}

function renderView(items: RecurringItem[]) {
  return render(
    <FinanceScreen today={TODAY} catalog={CATALOG}>
      <PaymentsView data={buildPaymentsView(items, [], TODAY)} />
    </FinanceScreen>,
  );
}

const pendingList = () => screen.getByRole("list", { name: "Pendientes" });
const payKey = (name: string) =>
  screen.getByRole("button", { name: new RegExp(`^Pagado(, con monto)?: ${name},`) });
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
    markPaid,
    undoPaid,
    skipPeriod,
    createRecurringPayment,
    archiveRecurringPayment,
    deleteRecurringPayment,
    unarchiveRecurringPayment,
  ]) {
    vi.mocked(action).mockReset();
  }
  router.push.mockReset();
  return () => vi.useRealTimers();
});

describe("Pagos", () => {
  test("the sections: pending with the due date in words, this month, all, archived", () => {
    renderView([
      item({ name: "Internet", dayOfMonth: 5 }),
      item({ name: "Luz", dayOfMonth: 8, amountCents: null }),
      item({ name: "Seguro", cycle: "yearly", dayOfMonth: 23, anchorMonth: 3 }),
      item({ name: "Viejo", archived: true }),
    ]);
    const rows = within(pendingList()).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Vence hoy"),
      expect.stringContaining("Vence el jue 8"),
    ]);
    expect(within(rows[1]).getByText("Monto variable")).toBeInTheDocument();
    expect(payKey("Luz")).toHaveTextContent("Pagado…");
    expect(payKey("Luz")).toHaveAttribute("aria-haspopup", "dialog");
    const month = screen.getByRole("list", { name: /^Este mes/ });
    expect(within(month).getAllByRole("listitem").at(-1)).toHaveTextContent("No toca este mes");
    const all = screen.getByRole("list", { name: "Todos" });
    expect(within(all).getByRole("link", { name: /Seguro/ })).toHaveTextContent("Anual, 23 mar");
    expect(screen.getByText("Archivados (1)")).toBeInTheDocument();
  });

  test("Pagado: one tap, the row leaves, focus goes to the next one; Deshacer undoes it", async () => {
    const user = userEvent.setup();
    const internet = item({ name: "Internet", dayOfMonth: 5 });
    const agua = item({ name: "Agua", dayOfMonth: 6 });
    const answer = deferred<Awaited<ReturnType<typeof markPaid>>>();
    vi.mocked(markPaid).mockReturnValue(answer.promise);
    vi.mocked(undoPaid).mockResolvedValue(ok({ dueOn: TODAY, reopened: false }));
    renderView([internet, agua]);
    await user.click(payKey("Internet"));
    expect(markPaid).toHaveBeenCalledWith({ id: internet.id, dueOn: TODAY });
    // Gone at once (optimistic), with focus on the next row's key.
    await waitFor(() => expect(within(pendingList()).getAllByRole("listitem")).toHaveLength(1));
    expect(payKey("Agua")).toHaveFocus();
    answer.resolve(
      ok({
        dueOn: TODAY,
        name: "Internet",
        closedStamp: null,
        expense: {
          id: "e1",
          description: "Internet",
          amountCents: 5000,
          currency: "PEN",
          exchangeRateE4: null,
          spentOn: TODAY,
          category: null,
          paymentMethod: null,
          recurringPaymentId: internet.id,
        },
      }),
    );
    await within(notices()).findByText("Pago registrado");
    expect(within(notices()).getByText("Internet · 50 soles")).toBeInTheDocument();
    await user.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    // The undo names this pay's expense.
    await waitFor(() =>
      expect(undoPaid).toHaveBeenCalledWith({ id: internet.id, dueOn: TODAY, expenseId: "e1" }),
    );
  });

  test("the last row paid: focus goes to the Pendientes heading", async () => {
    const user = userEvent.setup();
    const internet = item({ name: "Internet" });
    const answer = deferred<Awaited<ReturnType<typeof markPaid>>>();
    vi.mocked(markPaid).mockReturnValue(answer.promise);
    renderView([internet]);
    await user.click(payKey("Internet"));
    const heading = screen.getByRole("heading", { level: 2, name: "Pendientes" });
    await waitFor(() => expect(heading).toHaveFocus());
    // The empty message is read with the heading.
    expect(heading).toHaveAccessibleDescription(/Nada pendiente/);
    // "Este mes" already says it was paid.
    expect(document.querySelector(`[data-month-row="${internet.id}"]`)).toHaveAttribute(
      "data-status",
      "paid",
    );
    answer.resolve(fail(RECURRING_ERRORS.alreadyPaid));
    await within(notices()).findByText(/Ya estaba pagado/);
  });

  test("a refused pay comes back with Sin guardar (asserted after the rollback)", async () => {
    const user = userEvent.setup();
    const internet = item({ name: "Internet" });
    vi.mocked(markPaid).mockResolvedValue(fail(RECURRING_ERRORS.archived));
    renderView([internet]);
    await user.click(payKey("Internet"));
    await within(notices()).findByText(/No se pudo registrar el pago/);
    await waitFor(() => expect(within(pendingList()).getAllByRole("listitem")).toHaveLength(1));
  });

  test("a variable amount: Pagado… opens the sheet; the amount is required, then sent", async () => {
    const user = userEvent.setup();
    const luz = item({ name: "Luz", amountCents: null });
    vi.mocked(markPaid).mockResolvedValue(fail(RECURRING_ERRORS.notDue));
    renderView([luz]);
    await user.click(payKey("Luz"));
    const sheet = await screen.findByRole("dialog", { name: "Registrar pago de Luz" });
    const amount = within(sheet).getByRole("textbox", { name: "Monto pagado en soles" });
    await waitFor(() => expect(amount).toHaveFocus());
    await user.keyboard("{Enter}");
    expect(markPaid).not.toHaveBeenCalled();
    expect(within(sheet).getByText("Escribe el monto.")).toBeInTheDocument();
    await user.type(amount, "1080,50");
    await user.selectOptions(
      within(sheet).getByRole("combobox", { name: "Medio de pago" }),
      YAPE.id,
    );
    await user.click(within(sheet).getByRole("button", { name: "Registrar pago" }));
    expect(markPaid).toHaveBeenCalledWith({
      id: luz.id,
      dueOn: TODAY,
      amount: "1080,50",
      spentOn: TODAY,
      paymentMethodId: YAPE.id,
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // The server refused it: the notice says why and the row is back (after the rollback).
    await within(notices()).findByText(new RegExp(RECURRING_ERRORS.notDue.slice(0, 20)));
    await waitFor(() => expect(within(pendingList()).getAllByRole("listitem")).toHaveLength(1));
  });

  test("a variable amount saved: the notice says the amount paid", async () => {
    const user = userEvent.setup();
    const luz = item({ name: "Luz", amountCents: null });
    vi.mocked(markPaid).mockResolvedValue(
      ok({
        dueOn: TODAY,
        name: "Luz",
        closedStamp: null,
        expense: {
          id: "e2",
          description: "Luz",
          amountCents: 108_050,
          currency: "PEN",
          exchangeRateE4: null,
          spentOn: TODAY,
          category: null,
          paymentMethod: null,
          recurringPaymentId: luz.id,
        },
      }),
    );
    renderView([luz]);
    await user.click(payKey("Luz"));
    const sheet = await screen.findByRole("dialog", { name: "Registrar pago de Luz" });
    expect(sheet).toHaveAccessibleDescription("Período que vence el lunes 5 de octubre.");
    await user.type(
      within(sheet).getByRole("textbox", { name: "Monto pagado en soles" }),
      "1080,50{Enter}",
    );
    await within(notices()).findByText("Luz · 1,080.50 soles");
  });

  test("a failed skip comes back, with Sin guardar", async () => {
    const user = userEvent.setup();
    const internet = item({ name: "Internet" });
    vi.mocked(skipPeriod).mockResolvedValue(fail(RECURRING_ERRORS.archived));
    renderView([internet]);
    await user.click(screen.getByRole("button", { name: "Más acciones de Internet" }));
    const sheet = await screen.findByRole("dialog", { name: "Registrar pago de Internet" });
    await user.click(within(sheet).getByRole("button", { name: "Omitir este período" }));
    await within(notices()).findByText(/No se pudo omitir el período/);
    await waitFor(() => expect(within(pendingList()).getAllByRole("listitem")).toHaveLength(1));
    expect(document.querySelector(`[data-month-row="${internet.id}"]`)).toHaveAttribute(
      "data-status",
      "pending",
    );
  });

  test("the Pagado… sheet of an overdue period speaks in the past tense", async () => {
    const user = userEvent.setup();
    renderView([item({ name: "Agua", dayOfMonth: 2 })]);
    await user.click(screen.getByRole("button", { name: "Más acciones de Agua" }));
    const sheet = await screen.findByRole("dialog", { name: "Registrar pago de Agua" });
    expect(sheet).toHaveAccessibleDescription("Período que venció el viernes 2 de octubre.");
  });

  test("Reactivar: the row leaves and focus goes to the next Reactivar, then to the summary's place", async () => {
    const user = userEvent.setup();
    const uno = item({ name: "Uno", archived: true });
    const dos = item({ name: "Dos", archived: true });
    const answers = [
      deferred<Awaited<ReturnType<typeof unarchiveRecurringPayment>>>(),
      deferred<Awaited<ReturnType<typeof unarchiveRecurringPayment>>>(),
    ];
    vi.mocked(unarchiveRecurringPayment)
      .mockReturnValueOnce(answers[0].promise)
      .mockReturnValueOnce(answers[1].promise);
    renderView([uno, dos]);
    await user.click(screen.getByText("Archivados (2)"));
    await user.click(screen.getByRole("button", { name: "Reactivar «Dos»" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Reactivar «Uno»" })).toHaveFocus(),
    );
    await user.click(screen.getByRole("button", { name: "Reactivar «Uno»" }));
    // No archived left: the list folds away and focus goes to "Nuevo pago recurrente".
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Nuevo pago recurrente" })).toHaveFocus(),
    );
    answers[0].resolve(ok({ ...dos, archived: false }));
    answers[1].resolve(ok({ ...uno, archived: false }));
    await waitFor(() => expect(unarchiveRecurringPayment).toHaveBeenCalledTimes(2));
  });

  test("Omitir este período from the more-actions sheet, with Deshacer", async () => {
    const user = userEvent.setup();
    const internet = item({ name: "Internet" });
    const answer = deferred<Awaited<ReturnType<typeof skipPeriod>>>();
    vi.mocked(skipPeriod).mockReturnValue(answer.promise);
    renderView([internet]);
    await user.click(screen.getByRole("button", { name: "Más acciones de Internet" }));
    const sheet = await screen.findByRole("dialog", { name: "Registrar pago de Internet" });
    await user.click(within(sheet).getByRole("button", { name: "Omitir este período" }));
    expect(skipPeriod).toHaveBeenCalledWith({ id: internet.id, dueOn: TODAY });
    expect(await screen.findByText(/Nada pendiente/)).toBeInTheDocument();
    answer.resolve(ok({ dueOn: TODAY, name: "Internet", closedStamp: null }));
    await within(notices()).findByText("Período omitido");
    expect(within(notices()).getByRole("button", { name: "Deshacer" })).toBeInTheDocument();
  });
});

describe("Pago recurrente sheet", () => {
  test("a yearly payment: its day and month; sent with the cycle's fields; errors on their field", async () => {
    const user = userEvent.setup();
    vi.mocked(createRecurringPayment)
      .mockResolvedValueOnce({
        ok: false,
        error: INVALID_FIELDS_MESSAGE,
        fieldErrors: { paymentMethodId: [RECURRING_ERRORS.methodUnavailable] },
      })
      .mockResolvedValueOnce(ok(item({ name: "Seguro" })));
    renderView([]);
    await user.click(screen.getByRole("button", { name: "Nuevo pago recurrente" }));
    const sheet = await screen.findByRole("dialog", { name: "Nuevo pago recurrente" });
    await waitFor(() =>
      expect(within(sheet).getByRole("textbox", { name: "Nombre" })).toHaveFocus(),
    );
    await user.keyboard("Seguro");
    await user.selectOptions(within(sheet).getByRole("combobox", { name: "Ciclo" }), "yearly");
    await user.selectOptions(within(sheet).getByRole("combobox", { name: "Día del mes" }), "23");
    await user.selectOptions(within(sheet).getByRole("combobox", { name: "Mes" }), "3");
    await user.type(
      within(sheet).getByRole("textbox", { name: "Monto previsto en soles" }),
      "1200",
    );
    await user.selectOptions(
      within(sheet).getByRole("combobox", { name: "Medio de pago" }),
      TARJETA.id,
    );
    await user.click(within(sheet).getByRole("button", { name: "Guardar" }));
    expect(createRecurringPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Seguro",
        cycle: "yearly",
        dayOfMonth: 23,
        anchorMonth: 3,
        amount: "1200",
        variable: false,
        currency: "PEN",
        paymentMethodId: TARJETA.id,
        startDate: TODAY,
      }),
    );
    expect(await within(sheet).findByText(RECURRING_ERRORS.methodUnavailable)).toBeInTheDocument();
    await waitFor(() =>
      expect(within(sheet).getByRole("combobox", { name: "Medio de pago" })).toHaveFocus(),
    );
    await user.click(within(sheet).getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  test("Monto variable hides the amount; weekly asks for a weekday", async () => {
    const user = userEvent.setup();
    renderView([]);
    await user.click(screen.getByRole("button", { name: "Nuevo pago recurrente" }));
    const sheet = await screen.findByRole("dialog", { name: "Nuevo pago recurrente" });
    await user.click(within(sheet).getByRole("switch", { name: "Monto variable" }));
    expect(within(sheet).queryByRole("textbox", { name: /Monto previsto/ })).toBeNull();
    await user.selectOptions(within(sheet).getByRole("combobox", { name: "Ciclo" }), "weekly");
    expect(within(sheet).getByRole("combobox", { name: "Día de la semana" })).toHaveValue("1");
    expect(within(sheet).queryByRole("combobox", { name: "Día del mes" })).toBeNull();
    // No name: refused before the server.
    await user.click(within(sheet).getByRole("button", { name: "Guardar" }));
    expect(createRecurringPayment).not.toHaveBeenCalled();
    expect(within(sheet).getByText(RECURRING_ERRORS.nameRequired)).toBeInTheDocument();
  });
});

describe("back from deleting a payment (?deleted=)", () => {
  test("the notice offers Deshacer, which restores it", async () => {
    const user = userEvent.setup();
    const internet = item({ name: "Internet" });
    vi.mocked(restoreRecurringPayment).mockResolvedValue(ok(internet));
    window.history.replaceState(null, "", `/finance?deleted=${internet.id}`);
    render(
      <FinanceScreen today={TODAY} catalog={CATALOG}>
        <PaymentsDeletedNotice deleted={{ id: internet.id, name: "Internet" }} />
      </FinanceScreen>,
    );
    await within(notices()).findByText("Pago recurrente eliminado");
    // The parameter leaves the URL (a reload doesn't repeat it).
    expect(window.location.search).toBe("");
    await user.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    await waitFor(() => expect(restoreRecurringPayment).toHaveBeenCalledWith({ id: internet.id }));
  });

  test("an unknown or restored payment (no name): no notice", async () => {
    render(
      <FinanceScreen today={TODAY} catalog={CATALOG}>
        <PaymentsDeletedNotice deleted={null} />
        <p>listo</p>
      </FinanceScreen>,
    );
    // Longer than the notice's delay.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(within(notices()).queryByText("Pago recurrente eliminado")).toBeNull();
    expect(screen.getByText("listo")).toBeInTheDocument();
  });
});

test("an expense that paid a recurring period links to the payment's page from its sheet", () => {
  const internet = item({ name: "Internet" });
  const base = {
    id: "33333333-3333-4333-8333-000000000001",
    description: "Internet",
    amountCents: 5000,
    currency: "PEN" as const,
    exchangeRateE4: null,
    spentOn: TODAY,
    category: null,
    paymentMethod: null,
  };
  const { unmount } = render(
    <ExpenseSheet
      open
      onOpenChange={vi.fn()}
      catalog={CATALOG}
      today={TODAY}
      expense={{ ...base, recurringPaymentId: internet.id }}
    />,
  );
  expect(screen.getByRole("link", { name: "Ver el pago recurrente" })).toHaveAttribute(
    "href",
    `/finance/payments/${internet.id}`,
  );
  unmount();
  // A loose expense has none (positive control of the query above).
  render(
    <ExpenseSheet
      open
      onOpenChange={vi.fn()}
      catalog={CATALOG}
      today={TODAY}
      expense={{ ...base, recurringPaymentId: null }}
    />,
  );
  expect(screen.getByRole("dialog", { name: "Editar gasto" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Ver el pago recurrente" })).toBeNull();
});

describe("the payment's page", () => {
  const seguro = item({
    name: "Seguro",
    cycle: "yearly",
    dayOfMonth: 23,
    anchorMonth: 3,
    notes: "Póliza 1",
  });

  function renderDetail() {
    return render(
      <FinanceScreen today={TODAY} catalog={CATALOG}>
        <RecurringDetail
          item={seguro}
          headingId="payment-title"
          nextDues={["2027-03-23", "2028-03-23", "2029-03-23"]}
          history={[
            {
              recurringId: seguro.id,
              dueOn: "2026-03-23",
              status: "paid",
              expense: {
                id: "e1",
                amountCents: 120_000,
                currency: "PEN",
                exchangeRateE4: null,
                spentOn: "2026-03-20",
              },
            },
            { recurringId: seguro.id, dueOn: "2025-03-23", status: "skipped", expense: null },
          ]}
        />
      </FinanceScreen>,
    );
  }

  test("its data, next due dates and history", () => {
    renderDetail();
    expect(screen.getByRole("heading", { level: 1, name: "Seguro" })).toBeInTheDocument();
    expect(screen.getByText("Anual, 23 mar")).toBeInTheDocument();
    expect(screen.getByText("Póliza 1")).toBeInTheDocument();
    expect(
      within(screen.getByRole("list", { name: "Próximos vencimientos" })).getAllByRole("listitem"),
    ).toHaveLength(3);
    const history = within(screen.getByRole("list", { name: "Historial" })).getAllByRole(
      "listitem",
    );
    expect(history[0]).toHaveTextContent("Pagado S/ 1,200.00 el vie 20 mar");
    expect(history[1]).toHaveTextContent("Omitido");
  });

  test("archive keeps focus on its key (now Reactivar) and offers Deshacer; delete goes back to Pagos", async () => {
    const user = userEvent.setup();
    const answer = deferred<Awaited<ReturnType<typeof archiveRecurringPayment>>>();
    vi.mocked(archiveRecurringPayment).mockReturnValue(answer.promise);
    vi.mocked(deleteRecurringPayment).mockResolvedValue(ok(seguro));
    renderDetail();
    const archive = screen.getByRole("button", { name: "Archivar" });
    await user.click(archive);
    // Optimistic: the same key now says "Reactivar" and keeps focus.
    await waitFor(() => expect(screen.getByRole("button", { name: "Reactivar" })).toHaveFocus());
    expect(screen.getByText("Archivado")).toBeInTheDocument();
    answer.resolve(ok({ ...seguro, archived: true }));
    await within(notices()).findByText("Se archivó «Seguro».");
    expect(within(notices()).getByRole("button", { name: "Deshacer" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Eliminar" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/finance?deleted=${seguro.id}`));
    expect(document.cookie).toContain("bo_finance_view=payments");
  });

  test("a refused archive comes back: the key says Archivar again and keeps focus", async () => {
    const user = userEvent.setup();
    vi.mocked(archiveRecurringPayment).mockResolvedValue(fail(RECURRING_ERRORS.notFound));
    renderDetail();
    await user.click(screen.getByRole("button", { name: "Archivar" }));
    await within(notices()).findByText(RECURRING_ERRORS.notFound);
    await waitFor(() => expect(screen.getByRole("button", { name: "Archivar" })).toHaveFocus());
    expect(screen.queryByText("Archivado")).toBeNull();
  });

  test("amounts and dates are spoken in words", () => {
    renderDetail();
    expect(screen.getByText("50 soles")).toHaveClass("sr-only");
    expect(screen.getByText("Pagado, 1,200 soles, el viernes 20 de marzo")).toHaveClass("sr-only");
    expect(screen.getByText("período que vencía el lunes 23 de marzo")).toHaveClass("sr-only");
  });

  test("the route checks the owner and is a 404 without the payment", async () => {
    vi.mocked(getFinanceCatalog).mockResolvedValue(CATALOG);
    vi.mocked(getRecurringDetail).mockResolvedValue(null);
    await expect(PaymentPage({ params: Promise.resolve({ id: "x" }) })).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_HTTP_ERROR_FALLBACK;404"),
    });
    expect(requireOwner).toHaveBeenCalled();
    vi.mocked(getRecurringDetail).mockResolvedValue({
      item: seguro,
      nextDues: ["2027-03-23"],
      history: [],
    });
    render(await PaymentPage({ params: Promise.resolve({ id: seguro.id }) }));
    expect(screen.getByRole("heading", { level: 1, name: "Seguro" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver a Finanzas" })).toHaveAttribute(
      "href",
      "/finance",
    );
  });
});
