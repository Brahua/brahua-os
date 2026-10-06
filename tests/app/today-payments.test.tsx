// F4 of `finance`: "Pagos" on the board (SPEC-finance "Con `today`"): what a row shows, one tap
// pays with finance's rule (its notice and "Deshacer"), a variable amount opens "Pagado…", the
// rollback of a refusal, where focus goes when a row leaves, and "Día completo" following the
// live list. Against a fake server, inside the real board (its one notice viewport).
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { ownerDateKey } from "@/lib/time";
import { readFinanceCatalog } from "@/modules/finance/catalog-actions";
import type { FinanceCatalog } from "@/modules/finance/catalog-input";
import { markPaid, undoPaid } from "@/modules/finance/payment-actions";
import type { FinanceTodayItem } from "@/modules/finance/today-summary";
import { TodayBoard } from "@/modules/today/components/today-board";
import { TodayPayments } from "@/modules/today/components/today-payments";
import { paymentsTally, TODAY_HEADING_ID } from "@/modules/today/today-board";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => router,
}));
vi.mock("@/modules/finance/payment-actions", () => ({ markPaid: vi.fn(), undoPaid: vi.fn() }));
vi.mock("@/modules/finance/catalog-actions", () => ({ readFinanceCatalog: vi.fn() }));

/** Monday 2026-10-05, 10:00 in Lima. Only Date is faked (timers stay real for userEvent). */
const NOW = new Date("2026-10-05T15:00:00.000Z");
const TODAY = ownerDateKey(NOW);

const CREDITO = { id: "00000000-0000-4000-8000-0000000000c1", name: "Crédito" };
const YAPE = { id: "00000000-0000-4000-8000-0000000000c2", name: "Yape" };

let serial = 0;
function payment(values: Partial<FinanceTodayItem> = {}): FinanceTodayItem {
  serial += 1;
  return {
    recurringId: `00000000-0000-4000-8000-${String(serial).padStart(12, "0")}`,
    name: `Pago ${serial}`,
    dueOn: TODAY,
    amountCents: 5_000,
    currency: "PEN",
    paymentMethod: CREDITO,
    ...values,
  };
}

/** Calls wait until the test answers them (every one must settle before the test ends). */
const pending: ((result: ActionResult<unknown>) => void)[] = [];
async function answer(result: ActionResult<unknown>) {
  const call = pending.shift();
  if (!call) throw new Error("No pending call");
  await act(async () => call(result));
}
const paid = (item: FinanceTodayItem, amountCents = item.amountCents ?? 0, id = "expense-1") =>
  ok({
    dueOn: item.dueOn,
    name: item.name,
    expense: {
      id,
      description: item.name,
      amountCents,
      currency: item.currency,
      exchangeRateE4: null,
      spentOn: TODAY,
      category: null,
      paymentMethod: item.paymentMethod,
      recurringPaymentId: item.recurringId,
    },
  });

type BoardProps = { payments: FinanceTodayItem[]; tasksDoneToday?: number; today?: string };

function Board({ payments, tasksDoneToday, today = TODAY }: BoardProps) {
  return (
    <>
      <h1 id={TODAY_HEADING_ID} tabIndex={-1}>
        Buenos días
      </h1>
      <TodayBoard
        today={today}
        habits={[]}
        payments={{
          count: payments.length,
          blocking: paymentsTally(payments, today).blocking,
          content: <TodayPayments today={today} payments={payments} />,
        }}
        dayComplete={tasksDoneToday === undefined ? undefined : { tasksDoneToday }}
      />
    </>
  );
}

const section = () => screen.getByRole("region", { name: "Pagos" });
const rows = () =>
  within(
    screen.getByRole("list", { name: "Pagos vencidos y de los próximos 7 días" }),
  ).getAllByRole("listitem");
const names = () => rows().map((row) => within(row).getByRole("link").textContent);
const payKey = (name: string) =>
  screen.getByRole("button", { name: new RegExp(`^Pagado(, con monto)?: ${name},`) });
const notices = () => screen.getByRole("region", { name: "Avisos" });
const announcer = () => document.querySelector("[data-screen-announcer]");

const CATALOG: FinanceCatalog = {
  categories: [],
  methods: [
    { id: CREDITO.id, name: CREDITO.name, currency: "PEN" },
    { id: YAPE.id, name: YAPE.name, currency: "PEN" },
  ] as FinanceCatalog["methods"],
  archivedCategories: [],
  archivedMethods: [],
  usdToPenE4: null,
  lastPaymentMethodId: null,
};

beforeEach(() => {
  window.matchMedia = vi.fn((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  pending.length = 0;
  const wait = () =>
    new Promise<ActionResult<never>>((resolve) => {
      pending.push(resolve as (result: ActionResult<unknown>) => void);
    });
  vi.mocked(markPaid).mockImplementation(wait);
  vi.mocked(undoPaid).mockImplementation(wait);
  vi.mocked(readFinanceCatalog).mockResolvedValue(ok(CATALOG));
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("what a row shows", () => {
  test("name linking to its page, the due date in the signal color, amount and method, spoken", () => {
    const internet = payment({ name: "Internet", dueOn: "2026-10-02", amountCents: 12_990 });
    render(<Board payments={[internet]} />);

    const link = within(section()).getByRole("link", { name: "Internet" });
    expect(link).toHaveAttribute("href", `/finance/payments/${internet.recurringId}`);
    expect(link).toHaveAccessibleDescription("Venció hace 3 días, 129.90 soles, Crédito");
    const due = section().querySelector("[data-due]");
    expect(due).toHaveTextContent("Venció hace 3 días");
    // Orange with a LED, never red; no guilt.
    expect(due).toHaveClass("text-signal-text");
    expect(due?.className).not.toMatch(/danger|error|red/);
    expect(section().textContent).not.toMatch(/atrasad|fallaste/i);
    expect(section()).toHaveTextContent("S/ 129.90");
    expect(payKey("Internet")).toHaveAccessibleName("Pagado: Internet, venció hace 3 días");
    expect(payKey("Internet")).toHaveTextContent(/^Pagado$/);
  });

  test("due today, and an upcoming one in gray (positive control of the color)", () => {
    render(
      <Board
        payments={[
          payment({ name: "Netflix" }),
          payment({ name: "Agua", dueOn: "2026-10-08", paymentMethod: null }),
        ]}
      />,
    );
    const [today, soon] = section().querySelectorAll("[data-due]");
    expect(today).toHaveTextContent("Vence hoy");
    expect(today).toHaveClass("text-signal-text");
    expect(soon).toHaveTextContent("Vence el jue 8");
    expect(soon).not.toHaveClass("text-signal-text");
    expect(within(section()).getByRole("link", { name: "Agua" })).toHaveAccessibleDescription(
      "Vence el jue 8, 50 soles",
    );
  });

  test("a variable amount: “Monto variable” and “Pagado…” that opens a dialog", () => {
    render(<Board payments={[payment({ name: "Luz", amountCents: null })]} />);
    expect(section()).toHaveTextContent("Monto variable");
    expect(payKey("Luz")).toHaveTextContent("Pagado…");
    expect(payKey("Luz")).toHaveAttribute("aria-haspopup", "dialog");
  });

  test("Ver pagos goes to /finance and remembers the Pagos view", async () => {
    const user = userEvent.setup();
    render(<Board payments={[payment()]} />);
    const link = within(section()).getByRole("link", { name: "Ver pagos" });
    expect(link).toHaveAttribute("href", "/finance");
    link.addEventListener("click", (event) => event.preventDefault());
    await user.click(link);
    expect(document.cookie).toContain("bo_finance_view=payments");
  });

  test("with no payments the section renders nothing (the slot stays mounted)", () => {
    render(<Board payments={[]} />);
    expect(screen.queryByRole("region", { name: "Pagos" })).toBeNull();
  });
});

describe("paying with one tap", () => {
  test("the row leaves at once, focus to the next row's key, then the notice", async () => {
    const user = userEvent.setup();
    const list = [payment({ name: "Netflix" }), payment({ name: "Spotify" })];
    const { rerender } = render(<Board payments={list} />);

    await user.click(payKey("Netflix"));
    expect(names()).toEqual(["Spotify"]);
    expect(payKey("Spotify")).toHaveFocus();
    expect(markPaid).toHaveBeenCalledWith({ id: list[0].recurringId, dueOn: TODAY });

    await answer(paid(list[0]));
    rerender(<Board payments={list.slice(1)} />);
    expect(await within(notices()).findByText("Netflix · 50 soles")).toBeInTheDocument();
    expect(screen.getAllByRole("region", { name: "Avisos" })).toHaveLength(1);
  });

  test("the last row: focus goes to the previous row's key", async () => {
    const user = userEvent.setup();
    const list = [payment(), payment(), payment()];
    render(<Board payments={list} />);
    await user.click(payKey(list[2].name));
    expect(payKey(list[1].name)).toHaveFocus();
    await answer(paid(list[2]));
  });

  test("the only payment: the section leaves and focus goes to the board's heading", async () => {
    const user = userEvent.setup();
    const one = payment();
    render(<Board payments={[one]} />);
    await user.click(payKey(one.name));
    expect(screen.queryByRole("region", { name: "Pagos" })).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveFocus();
    await answer(paid(one));
  });

  test("a refusal rolls the row back in its place and says so", async () => {
    const user = userEvent.setup();
    const list = [payment({ name: "Netflix" }), payment({ name: "Spotify" })];
    render(<Board payments={list} />);
    await user.click(payKey("Netflix"));
    expect(names()).toEqual(["Spotify"]);

    await answer(fail("Ese pago ya no existe."));
    expect(
      await within(notices()).findByText(/No se pudo registrar el pago\. Ese pago ya no existe\./),
    ).toBeInTheDocument();
    // The notice can render before useOptimistic rolls back: assert inside waitFor.
    await waitFor(() => expect(names()).toEqual(["Netflix", "Spotify"]));
  });

  test("a new Lima day with the board open: nothing is saved, the board is read again", async () => {
    const user = userEvent.setup();
    const one = payment({ dueOn: "2026-10-04" });
    render(<Board payments={[one]} today="2026-10-04" />);
    await user.click(payKey(one.name));
    expect(markPaid).not.toHaveBeenCalled();
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(rows()).toHaveLength(1);
  });

  test("a tap that left focus on <body> (Safari) still moves it to the next key", async () => {
    const list = [payment(), payment()];
    render(<Board payments={list} />);
    expect(document.activeElement).toBe(document.body);
    fireEvent.click(payKey(list[0].name));
    await waitFor(() => expect(payKey(list[1].name)).toHaveFocus());
    await answer(paid(list[0]));
  });

  test("focus elsewhere on the page stays there (positive control)", async () => {
    const list = [payment(), payment()];
    render(<Board payments={list} />);
    const link = within(section()).getByRole("link", { name: "Ver pagos" });
    link.focus();
    fireEvent.click(payKey(list[0].name));
    await waitFor(() => expect(names()).toEqual([list[1].name]));
    expect(link).toHaveFocus();
    await answer(paid(list[0]));
  });
});

describe("Deshacer", () => {
  test("puts it back in its place with aria-disabled while it saves, undoes that expense, said once", async () => {
    const user = userEvent.setup();
    const list = [payment({ name: "Netflix" }), payment({ name: "Spotify" })];
    const { rerender } = render(<Board payments={list} />);
    await user.click(payKey("Netflix"));
    await answer(paid(list[0], 5_000, "expense-netflix"));
    rerender(<Board payments={list.slice(1)} />);

    await user.click(await within(notices()).findByRole("button", { name: "Deshacer" }));
    expect(names()).toEqual(["Netflix", "Spotify"]);
    const back = payKey("Netflix");
    expect(back).toHaveAttribute("aria-disabled", "true");
    expect(back).not.toBeDisabled();
    // A tap while it saves does nothing.
    await user.click(back);
    expect(markPaid).toHaveBeenCalledTimes(1);
    expect(undoPaid).toHaveBeenCalledWith({
      id: list[0].recurringId,
      dueOn: TODAY,
      expenseId: "expense-netflix",
    });

    await answer(ok({ dueOn: TODAY }));
    rerender(<Board payments={list} />);
    await waitFor(() => expect(payKey("Netflix")).not.toHaveAttribute("aria-disabled"));
    await waitFor(() =>
      expect(announcer()).toHaveTextContent("Se quitó el pago de Netflix: vuelve a pendientes."),
    );
    expect(announcer()?.textContent?.match(/Se quitó el pago/g)).toHaveLength(1);
  });

  test("Ctrl+Z after paying undoes it, like the notice's Deshacer", async () => {
    const user = userEvent.setup();
    const one = payment({ name: "Netflix" });
    const { rerender } = render(<Board payments={[one, payment()]} />);
    await user.click(payKey("Netflix"));
    await answer(paid(one));
    rerender(<Board payments={[payment({ name: "Otro" })]} />);
    await within(notices()).findByRole("button", { name: "Deshacer" });
    await user.keyboard("{Control>}z{/Control}");
    expect(undoPaid).toHaveBeenCalledTimes(1);
    await answer(ok({ dueOn: TODAY }));
  });

  test("the last one, after the server's read came back empty: Deshacer puts it back at once", async () => {
    const user = userEvent.setup();
    const one = payment({ name: "Netflix" });
    const { rerender } = render(<Board payments={[one]} />);
    await user.click(payKey("Netflix"));
    await answer(paid(one));
    // The action revalidated "/": nothing pending (count 0), the empty day shows.
    rerender(<Board payments={[]} />);
    expect(screen.queryByRole("region", { name: "Pagos" })).toBeNull();
    expect(screen.getByRole("region", { name: "Nada programado para hoy" })).toBeInTheDocument();

    await user.click(await within(notices()).findByRole("button", { name: "Deshacer" }));
    expect(payKey("Netflix")).toHaveAttribute("aria-disabled", "true");
    await answer(ok({ dueOn: TODAY }));
    rerender(<Board payments={[one]} />);
    await waitFor(() => expect(payKey("Netflix")).not.toHaveAttribute("aria-disabled"));
  });

  test("an undo that fails takes the row out again and says so", async () => {
    const user = userEvent.setup();
    const one = payment({ name: "Netflix" });
    const { rerender } = render(<Board payments={[one, payment({ name: "Agua" })]} />);
    await user.click(payKey("Netflix"));
    await answer(paid(one));
    rerender(<Board payments={[payment({ name: "Agua" })]} />);
    await user.click(await within(notices()).findByRole("button", { name: "Deshacer" }));
    expect(names()).toContain("Netflix");
    await answer(fail("Ese período ya no estaba pagado."));
    expect(await within(notices()).findByText(/No se pudo deshacer/)).toBeInTheDocument();
    await waitFor(() => expect(names()).not.toContain("Netflix"));
  });
});

describe("a variable amount: the Pagado… sheet", () => {
  test("opens with the amount focused, required, then sends the overrides; focus to the next key", async () => {
    const user = userEvent.setup();
    const luz = payment({ name: "Luz", amountCents: null });
    const agua = payment({ name: "Agua" });
    render(<Board payments={[luz, agua]} />);
    await user.click(payKey("Luz"));
    const sheet = await screen.findByRole("dialog", { name: "Registrar pago de Luz" });
    expect(sheet).toHaveAccessibleDescription("Período que vence el lunes 5 de octubre.");
    // The home page only pays: no skip here.
    expect(within(sheet).queryByRole("button", { name: /Omitir/ })).toBeNull();
    const amount = within(sheet).getByRole("textbox", { name: "Monto pagado en soles" });
    await waitFor(() => expect(amount).toHaveFocus());
    await user.keyboard("{Enter}");
    expect(markPaid).not.toHaveBeenCalled();
    expect(within(sheet).getByText("Escribe el monto.")).toBeInTheDocument();

    // The catalog arrives after the sheet opens (read on open): its methods are offered.
    await waitFor(() =>
      expect(within(sheet).getByRole("option", { name: "Yape" })).toBeInTheDocument(),
    );
    await user.type(amount, "108,50");
    await user.selectOptions(
      within(sheet).getByRole("combobox", { name: "Medio de pago" }),
      YAPE.id,
    );
    await user.click(within(sheet).getByRole("button", { name: "Registrar pago" }));
    expect(markPaid).toHaveBeenCalledWith({
      id: luz.recurringId,
      dueOn: TODAY,
      amount: "108,50",
      spentOn: TODAY,
      paymentMethodId: YAPE.id,
    });
    expect(names()).toEqual(["Agua"]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(payKey("Agua")).toHaveFocus());
    await answer(paid(luz, 10_850));
    expect(await within(notices()).findByText("Luz · 108.50 soles")).toBeInTheDocument();
  });

  test("without the catalog (the read failed) the payment's own method is still offered and saved", async () => {
    const user = userEvent.setup();
    vi.mocked(readFinanceCatalog).mockRejectedValue(new Error("offline"));
    const luz = payment({ name: "Luz", amountCents: null });
    render(<Board payments={[luz]} />);
    await user.click(payKey("Luz"));
    const sheet = await screen.findByRole("dialog", { name: "Registrar pago de Luz" });
    expect(within(sheet).getByRole("combobox", { name: "Medio de pago" })).toHaveValue(CREDITO.id);
    await user.type(within(sheet).getByRole("textbox", { name: "Monto pagado en soles" }), "90");
    await user.keyboard("{Enter}");
    expect(markPaid).toHaveBeenCalledWith(
      expect.objectContaining({ amount: "90", paymentMethodId: CREDITO.id }),
    );
    // The only row left: focus lands on the board's heading.
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveFocus());
    await answer(paid(luz, 9_000));
  });

  test("closing the sheet without paying returns focus to Pagado… and keeps the row", async () => {
    const user = userEvent.setup();
    render(<Board payments={[payment({ name: "Luz", amountCents: null })]} />);
    await user.click(payKey("Luz"));
    const sheet = await screen.findByRole("dialog", { name: "Registrar pago de Luz" });
    await user.click(within(sheet).getByRole("button", { name: "Cerrar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(payKey("Luz")).toHaveFocus());
    expect(markPaid).not.toHaveBeenCalled();
    expect(rows()).toHaveLength(1);
  });
});

describe("Día completo follows the live list", () => {
  test("an overdue payment keeps it away; paying it shows it (announced once); Deshacer takes it away", async () => {
    const user = userEvent.setup();
    const one = payment({ name: "Netflix", dueOn: "2026-10-03" });
    render(<Board payments={[one]} tasksDoneToday={1} />);
    expect(screen.queryByRole("region", { name: "Día completo" })).toBeNull();

    await user.click(payKey("Netflix"));
    // Optimistic: before the server answers.
    expect(screen.getByRole("region", { name: "Día completo" })).toBeInTheDocument();
    await waitFor(() => expect(announcer()).toHaveTextContent("Día completo: 1 tarea."));
    await answer(paid(one));

    await user.click(await within(notices()).findByRole("button", { name: "Deshacer" }));
    expect(screen.queryByRole("region", { name: "Día completo" })).toBeNull();
    await answer(ok({ dueOn: one.dueOn }));
  });

  test("an upcoming payment doesn't keep it away (positive control)", () => {
    render(<Board payments={[payment({ dueOn: "2026-10-07" })]} tasksDoneToday={1} />);
    expect(screen.getByRole("region", { name: "Día completo" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Pagos" })).toBeInTheDocument();
  });
});
