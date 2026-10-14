// E3 of `finance-email`: the «Sugerencias» section of /finance (register with one touch, edit first,
// dismiss, each with its exact «Deshacer»; duplicate, unverified and unreadable rows; focus) and the
// «Correos del banco» part of Ajustes, against fake actions.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { fail, ok } from "@/lib/action-result";
import type { FinanceCatalog } from "@/modules/finance/catalog-input";
import { EmailSettingsSection } from "@/modules/finance/components/email-settings-section";
import { FinanceScreen } from "@/modules/finance/components/finance-screen";
import { SuggestionsSection } from "@/modules/finance/components/suggestions-section";
import {
  dismissEmailSuggestion,
  markEmailSuggestionPaid,
  registerEmailSuggestion,
  setMethodLast4,
  setOwnNames,
  undoDismissEmailSuggestion,
  undoRegisterEmailSuggestion,
} from "@/modules/finance/email/actions";
import type { SuggestionItem } from "@/modules/finance/email/input";
import type { ExpenseItem } from "@/modules/finance/expense-input";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/modules/finance/email/actions", () => ({
  registerEmailSuggestion: vi.fn(),
  dismissEmailSuggestion: vi.fn(),
  markEmailSuggestionPaid: vi.fn(),
  undoDismissEmailSuggestion: vi.fn(),
  undoRegisterEmailSuggestion: vi.fn(),
  setOwnNames: vi.fn(),
  setMethodLast4: vi.fn(),
}));
vi.mock("@/modules/finance/actions", () => ({
  createExpense: vi.fn(),
  editExpense: vi.fn(),
  deleteExpense: vi.fn(),
  restoreExpense: vi.fn(),
}));
vi.mock("@/modules/finance/catalog-actions", () => ({ readFinanceCatalog: vi.fn() }));

const TODAY = "2026-10-14";
const BBVA = { id: "22222222-2222-4222-8222-111111111111", name: "BBVA crédito" };
const CATALOG: FinanceCatalog = {
  categories: [{ id: "11111111-1111-4111-8111-111111111111", name: "Comida", sortOrder: 0 }],
  methods: [{ ...BBVA, currency: "PEN", sortOrder: 0 }],
  archivedCategories: [],
  archivedMethods: [],
  usdToPenE4: 37_500,
  lastPaymentMethodId: null,
};

let serial = 0;
function suggestion(over: Partial<SuggestionItem> = {}): SuggestionItem {
  serial += 1;
  return {
    id: `44444444-4444-4444-8444-${String(serial).padStart(12, "0")}`,
    source: "bbva",
    kind: "card",
    status: "pending",
    amountCents: 4320,
    currency: "PEN",
    merchant: "RAPPI SAC",
    occurredOn: "2026-10-11",
    cardLast4: "3659",
    subject: "Has realizado un consumo con tu tarjeta BBVA",
    senderVerified: true,
    method: null,
    duplicate: false,
    recurring: null,
    ...over,
  };
}

const unreadable = () =>
  suggestion({
    status: "unreadable",
    kind: null,
    amountCents: null,
    currency: null,
    merchant: null,
    occurredOn: null,
    cardLast4: null,
    subject: "Constancia de operación transferencia PLIN",
  });

function expense(over: Partial<ExpenseItem> = {}): ExpenseItem {
  return {
    id: "33333333-3333-4333-8333-000000000001",
    description: "RAPPI SAC",
    amountCents: 4320,
    currency: "PEN",
    exchangeRateE4: null,
    spentOn: "2026-10-11",
    category: null,
    paymentMethod: null,
    recurringPaymentId: null,
    ...over,
  };
}

function renderSection(items: SuggestionItem[]) {
  return render(
    <FinanceScreen today={TODAY} catalog={CATALOG}>
      <SuggestionsSection items={items} />
    </FinanceScreen>,
  );
}

beforeEach(() => {
  window.matchMedia = vi.fn((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  for (const action of [
    registerEmailSuggestion,
    markEmailSuggestionPaid,
    dismissEmailSuggestion,
    undoDismissEmailSuggestion,
    undoRegisterEmailSuggestion,
    setOwnNames,
    setMethodLast4,
  ]) {
    vi.mocked(action).mockReset();
  }
});

describe("the rows", () => {
  test("a verified suggestion shows what was read and the three keys", () => {
    renderSection([suggestion({ method: BBVA })]);
    const heading = screen.getByRole("heading", { level: 2, name: /Sugerencias/ });
    expect(heading).toHaveTextContent("1 sugerencia");
    const row = document.querySelector("[data-suggestion]") as HTMLElement;
    expect(within(row).getByText("RAPPI SAC")).toBeVisible();
    expect(within(row).getByText("S/ 43.20")).toBeVisible();
    expect(row).toHaveTextContent("BBVA · BBVA crédito");
    for (const name of ["Registrar", "Editar", "Descartar"]) {
      expect(within(row).getByRole("button", { name })).toBeVisible();
    }
    expect(within(row).queryByText("Posible duplicado.")).toBeNull();
  });

  test("an unverified sender has no one-touch Registrar, only Revisar", () => {
    renderSection([suggestion({ senderVerified: false })]);
    expect(screen.queryByRole("button", { name: "Registrar" })).toBeNull();
    expect(screen.getByRole("button", { name: "Revisar" })).toBeVisible();
    expect(screen.getByText("Remitente no verificado.")).toBeVisible();
  });

  test("a duplicate is flagged but can still be registered", () => {
    renderSection([suggestion({ duplicate: true })]);
    expect(screen.getByText("Posible duplicado.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Registrar" })).toBeVisible();
  });

  test("an unreadable one says so and offers to register by hand", () => {
    renderSection([unreadable()]);
    expect(screen.getByText("No pude leerlo")).toBeVisible();
    expect(screen.getByText("Constancia de operación transferencia PLIN")).toBeVisible();
    expect(screen.getByRole("button", { name: "Registrar a mano" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Registrar" })).toBeNull();
  });

  test("nothing at all without suggestions", () => {
    renderSection([]);
    expect(screen.queryByRole("heading", { name: /Sugerencias/ })).toBeNull();
  });
});

describe("Registrar", () => {
  test("one touch: the row leaves, the notice says so and its Deshacer carries the expense id", async () => {
    const user = userEvent.setup();
    const [first, second] = [suggestion(), suggestion({ merchant: "OXXO" })];
    vi.mocked(registerEmailSuggestion).mockResolvedValue(
      ok({ suggestionId: first.id, expense: expense() }),
    );
    vi.mocked(undoRegisterEmailSuggestion).mockResolvedValue(ok({ id: first.id }));
    renderSection([first, second]);

    const rows = document.querySelectorAll("[data-suggestion]");
    await user.click(within(rows[0] as HTMLElement).getByRole("button", { name: "Registrar" }));

    expect(registerEmailSuggestion).toHaveBeenCalledWith({ id: first.id });
    await waitFor(() => expect(screen.getByText("Gasto registrado")).toBeVisible());
    await user.click(screen.getByRole("button", { name: "Deshacer" }));
    await waitFor(() =>
      expect(undoRegisterEmailSuggestion).toHaveBeenCalledWith({
        id: first.id,
        expenseId: "33333333-3333-4333-8333-000000000001",
        reopenStamp: null,
      }),
    );
  });

  test("focus goes to the neighbor's Registrar when a row leaves", async () => {
    const user = userEvent.setup();
    const [first, second] = [suggestion(), suggestion({ merchant: "OXXO" })];
    vi.mocked(registerEmailSuggestion).mockResolvedValue(
      ok({ suggestionId: first.id, expense: expense() }),
    );
    renderSection([first, second]);
    const rows = document.querySelectorAll("[data-suggestion]");
    await user.click(within(rows[0] as HTMLElement).getByRole("button", { name: "Registrar" }));
    await waitFor(() => {
      const next = within(
        document.querySelector(`[data-suggestion="${second.id}"]`) as HTMLElement,
      );
      expect(next.getByRole("button", { name: "Registrar" })).toHaveFocus();
    });
  });

  test("a refusal brings the row back and says so (never a silent loss)", async () => {
    const user = userEvent.setup();
    const item = suggestion();
    vi.mocked(registerEmailSuggestion).mockResolvedValue(fail("Esta sugerencia ya se decidió."));
    renderSection([item]);
    await user.click(screen.getByRole("button", { name: "Registrar" }));
    await waitFor(() => expect(screen.getByText("Sin guardar")).toBeVisible());
    expect(screen.getByText(/Esta sugerencia ya se decidió\./)).toBeVisible();
    expect(screen.getByText("RAPPI SAC")).toBeVisible();
  });

  test("a network failure is a notice too", async () => {
    const user = userEvent.setup();
    vi.mocked(registerEmailSuggestion).mockRejectedValue(new Error("offline"));
    renderSection([suggestion()]);
    await user.click(screen.getByRole("button", { name: "Registrar" }));
    await waitFor(() => expect(screen.getByText("Sin guardar")).toBeVisible());
  });
});

describe("Editar", () => {
  test("opens the sheet with what was read and registers with the owner's changes", async () => {
    const user = userEvent.setup();
    const item = suggestion({ method: BBVA });
    vi.mocked(registerEmailSuggestion).mockResolvedValue(
      ok({ suggestionId: item.id, expense: expense({ amountCents: 5000, description: "Cena" }) }),
    );
    renderSection([item]);
    await user.click(screen.getByRole("button", { name: "Editar" }));

    const dialog = await screen.findByRole("dialog", { name: "Registrar sugerencia" });
    const amount = within(dialog).getByRole("textbox", { name: /^Monto en/ });
    expect(amount).toHaveValue("43.20");
    expect(within(dialog).getByRole("textbox", { name: /Descripción/ })).toHaveValue("RAPPI SAC");
    expect(within(dialog).getByRole("combobox", { name: "Medio de pago" })).toHaveValue(BBVA.id);

    await user.clear(amount);
    await user.type(amount, "50");
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Categoría" }), "Comida");
    await user.click(within(dialog).getByRole("button", { name: "Registrar gasto" }));

    await waitFor(() => expect(registerEmailSuggestion).toHaveBeenCalled());
    expect(registerEmailSuggestion).toHaveBeenCalledWith({
      id: item.id,
      overrides: {
        amount: "50",
        description: "RAPPI SAC",
        categoryId: CATALOG.categories[0].id,
        paymentMethodId: BBVA.id,
      },
    });
    await waitFor(() => expect(screen.getByText("Gasto registrado")).toBeVisible());
  });

  test("a refused amount shows on its field and the sheet stays open", async () => {
    const user = userEvent.setup();
    vi.mocked(registerEmailSuggestion).mockResolvedValue({
      ok: false,
      error: "Revisa los campos.",
      fieldErrors: { amount: ["Escribe solo el número."] },
    });
    renderSection([suggestion()]);
    await user.click(screen.getByRole("button", { name: "Editar" }));
    const dialog = await screen.findByRole("dialog", { name: "Registrar sugerencia" });
    await user.click(within(dialog).getByRole("button", { name: "Registrar gasto" }));
    expect(await within(dialog).findByText("Escribe solo el número.")).toBeVisible();
    expect(screen.getByRole("dialog", { name: "Registrar sugerencia" })).toBeVisible();
  });
});

describe("Descartar", () => {
  test("removes the row, says so and Deshacer brings it back through the server", async () => {
    const user = userEvent.setup();
    const item = suggestion();
    vi.mocked(dismissEmailSuggestion).mockResolvedValue(ok({ id: item.id }));
    vi.mocked(undoDismissEmailSuggestion).mockResolvedValue(ok({ id: item.id }));
    renderSection([item]);
    await user.click(screen.getByRole("button", { name: "Descartar" }));
    expect(dismissEmailSuggestion).toHaveBeenCalledWith({ id: item.id });
    await waitFor(() => expect(screen.getByText("Sugerencia descartada")).toBeVisible());
    await user.click(screen.getByRole("button", { name: "Deshacer" }));
    await waitFor(() => expect(undoDismissEmailSuggestion).toHaveBeenCalledWith({ id: item.id }));
  });

  test("a failed Deshacer says it could not undo", async () => {
    const user = userEvent.setup();
    const item = suggestion();
    vi.mocked(dismissEmailSuggestion).mockResolvedValue(ok({ id: item.id }));
    vi.mocked(undoDismissEmailSuggestion).mockResolvedValue(fail("Cambió mientras tanto."));
    renderSection([item]);
    await user.click(screen.getByRole("button", { name: "Descartar" }));
    await user.click(await screen.findByRole("button", { name: "Deshacer" }));
    await waitFor(() => expect(screen.getByText(/No se pudo deshacer\./)).toBeVisible());
  });
});

describe("Registrar a mano", () => {
  test("opens the empty expense sheet and, once saved, the unreadable email leaves the inbox", async () => {
    const user = userEvent.setup();
    const item = unreadable();
    const { createExpense } = await import("@/modules/finance/actions");
    vi.mocked(createExpense).mockResolvedValue(ok(expense()));
    vi.mocked(dismissEmailSuggestion).mockResolvedValue(ok({ id: item.id }));
    renderSection([item]);
    await user.click(screen.getByRole("button", { name: "Registrar a mano" }));
    const dialog = await screen.findByRole("dialog", { name: "Nuevo gasto" });
    await user.type(within(dialog).getByRole("textbox", { name: /^Monto en/ }), "10{Enter}");
    await waitFor(() => expect(dismissEmailSuggestion).toHaveBeenCalledWith({ id: item.id }));
    expect(dismissEmailSuggestion).toHaveBeenCalledTimes(1);
  });
});

describe("«Correos del banco» in Ajustes", () => {
  const SETTINGS = {
    ownNames: ["Ana Demo Perez"],
    methods: [{ id: BBVA.id, name: BBVA.name, last4: "3659" }],
  };

  test("starts from what is stored", () => {
    render(<EmailSettingsSection initial={SETTINGS} sheetBusy={false} />);
    expect(screen.getByRole("textbox", { name: "Mis nombres" })).toHaveValue("Ana Demo Perez");
    expect(screen.getByRole("textbox", { name: "Últimos 4 dígitos de BBVA crédito" })).toHaveValue(
      "3659",
    );
  });

  test("saves the names, one per line, and says so", async () => {
    const user = userEvent.setup();
    vi.mocked(setOwnNames).mockResolvedValue(
      ok({ ...SETTINGS, ownNames: ["Ana Demo Perez", "Ana D Perez Q"] }),
    );
    render(<EmailSettingsSection initial={SETTINGS} sheetBusy={false} />);
    const names = screen.getByRole("textbox", { name: "Mis nombres" });
    await user.clear(names);
    await user.type(names, "Ana Demo Perez{Enter}Ana D Perez Q");
    await user.click(screen.getByRole("button", { name: "Guardar nombres" }));
    await waitFor(() =>
      expect(setOwnNames).toHaveBeenCalledWith({ names: ["Ana Demo Perez", "Ana D Perez Q"] }),
    );
    await waitFor(() =>
      expect(document.querySelector("[data-email-settings-status]")).toHaveTextContent(
        "Nombres guardados.",
      ),
    );
  });

  test("four digits or nothing: anything else is refused before the server", async () => {
    const user = userEvent.setup();
    render(<EmailSettingsSection initial={SETTINGS} sheetBusy={false} />);
    const digits = screen.getByRole("textbox", { name: "Últimos 4 dígitos de BBVA crédito" });
    await user.clear(digits);
    await user.type(digits, "12a");
    await user.click(screen.getByRole("button", { name: "Guardar dígitos" }));
    expect(await screen.findByText("Escribe exactamente 4 dígitos, o déjalo vacío.")).toBeVisible();
    expect(setMethodLast4).not.toHaveBeenCalled();

    vi.mocked(setMethodLast4).mockResolvedValue(
      ok({ ...SETTINGS, methods: [{ ...SETTINGS.methods[0], last4: "1234" }] }),
    );
    await user.clear(digits);
    await user.type(digits, "1234");
    await user.click(screen.getByRole("button", { name: "Guardar dígitos" }));
    await waitFor(() =>
      expect(setMethodLast4).toHaveBeenCalledWith({ id: BBVA.id, last4: "1234" }),
    );
  });
});

describe("recurring payments that arrive by email (addendum E5)", () => {
  const NETFLIX = {
    id: "55555555-5555-4555-8555-000000000001",
    name: "Netflix",
    dueOn: "2026-10-10",
    state: "pending" as const,
    expectedCents: 5000,
    sameAmount: true,
  };

  test("a pending period: «Parece el pago de …», Marcar como pagado first, Registrar como gasto after", () => {
    renderSection([suggestion({ merchant: "NETFLIX.COM", amountCents: 5000, recurring: NETFLIX })]);
    expect(screen.getByText(/Parece el pago de «Netflix» · venció el 10 de octubre/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Marcar como pagado" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Registrar como gasto" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Registrar" })).toBeNull();
    expect(screen.queryByText(/El monto es distinto/)).toBeNull();
  });

  test("another amount than the expected one is said, in soles", () => {
    renderSection([
      suggestion({ amountCents: 6000, recurring: { ...NETFLIX, sameAmount: false } }),
    ]);
    expect(screen.getByText(/El monto es distinto del previsto \(S\/ 50\.00\)\./)).toBeVisible();
  });

  test("it says when it is due: today, or still to come", () => {
    renderSection([suggestion({ recurring: { ...NETFLIX, dueOn: TODAY } })]);
    expect(screen.getByText(/vence hoy/)).toBeVisible();
  });

  test("Marcar como pagado: the row leaves, «Pago marcado», and Deshacer carries the expense and the stamp", async () => {
    const user = userEvent.setup();
    const item = suggestion({ recurring: NETFLIX });
    vi.mocked(markEmailSuggestionPaid).mockResolvedValue(
      ok({
        suggestionId: item.id,
        expense: expense({ description: "Netflix", amountCents: 5000 }),
        recurringName: "Netflix",
        closedStamp: "2026-10-14T12:00:00.000Z",
      }),
    );
    vi.mocked(undoRegisterEmailSuggestion).mockResolvedValue(ok({ id: item.id }));
    renderSection([item]);
    await user.click(screen.getByRole("button", { name: "Marcar como pagado" }));
    expect(markEmailSuggestionPaid).toHaveBeenCalledWith({ id: item.id });
    await waitFor(() => expect(screen.getByText("Pago marcado")).toBeVisible());
    expect(registerEmailSuggestion).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Deshacer" }));
    await waitFor(() =>
      expect(undoRegisterEmailSuggestion).toHaveBeenCalledWith({
        id: item.id,
        expenseId: "33333333-3333-4333-8333-000000000001",
        reopenStamp: "2026-10-14T12:00:00.000Z",
      }),
    );
  });

  test("a refusal brings the row back with the reason", async () => {
    const user = userEvent.setup();
    vi.mocked(markEmailSuggestionPaid).mockResolvedValue(
      fail("Ya no parece el pago de un recurrente: revisa la sugerencia."),
    );
    renderSection([suggestion({ recurring: NETFLIX })]);
    await user.click(screen.getByRole("button", { name: "Marcar como pagado" }));
    await waitFor(() => expect(screen.getByText("Sin guardar")).toBeVisible());
    expect(screen.getByRole("button", { name: "Marcar como pagado" })).toBeVisible();
  });

  test("Registrar como gasto is the plain register (the payment stays pending)", async () => {
    const user = userEvent.setup();
    const item = suggestion({ recurring: NETFLIX });
    vi.mocked(registerEmailSuggestion).mockResolvedValue(
      ok({ suggestionId: item.id, expense: expense() }),
    );
    renderSection([item]);
    await user.click(screen.getByRole("button", { name: "Registrar como gasto" }));
    expect(registerEmailSuggestion).toHaveBeenCalledWith({ id: item.id });
    expect(markEmailSuggestionPaid).not.toHaveBeenCalled();
  });

  test("a period already marked as paid: the note and Descartar first, never Marcar como pagado", async () => {
    const user = userEvent.setup();
    const item = suggestion({ recurring: { ...NETFLIX, state: "paid" } });
    vi.mocked(dismissEmailSuggestion).mockResolvedValue(ok({ id: item.id }));
    renderSection([item]);
    expect(screen.getByText("Ya marcaste «Netflix» como pagado este mes.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Marcar como pagado" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Descartar" })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Descartar" }));
    expect(dismissEmailSuggestion).toHaveBeenCalledWith({ id: item.id });
  });

  test("an unverified sender is looked at first: Revisar, and no «parece el pago»", () => {
    renderSection([suggestion({ senderVerified: false, recurring: NETFLIX })]);
    expect(screen.getByRole("button", { name: "Revisar" })).toBeVisible();
    expect(screen.queryByText(/Parece el pago/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Marcar como pagado" })).toBeNull();
  });
});
