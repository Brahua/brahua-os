// polish → capture-nl-dates: the live preview of what the quick capture understood, in the Tarea
// sheet ("pilas mañana") and the Gasto sheet ("12.50 café"): it appears, a touch cancels it and
// the text stays as typed, focus returns to the field, and the status region is polite.
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ok } from "@/lib/action-result";
import { createExpense } from "@/modules/finance/actions";
import type { FinanceCatalog } from "@/modules/finance/catalog-input";
import { ExpenseSheet } from "@/modules/finance/components/expense-sheet";
import type { ExpenseItem } from "@/modules/finance/expense-input";
import { createTask, listTaskTargets } from "@/modules/tasks/actions";
import { QuickCaptureSheet } from "@/modules/tasks/components/quick-capture-sheet";
import type { TaskItem } from "@/modules/tasks/task-input";

vi.mock("@/modules/tasks/actions", () => ({ createTask: vi.fn(), listTaskTargets: vi.fn() }));
vi.mock("@/modules/tasks/tag-actions", () => ({
  listTaskTags: vi.fn(async () => ({ ok: true, data: [] })),
  setTaskTags: vi.fn(),
}));
vi.mock("@/modules/finance/actions", () => ({
  createExpense: vi.fn(),
  editExpense: vi.fn(),
  deleteExpense: vi.fn(),
}));

const TODAY = "2026-10-07";
const EFECTIVO = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Efectivo",
  currency: "PEN" as const,
  sortOrder: 0,
};
const CATALOG: FinanceCatalog = {
  categories: [],
  methods: [EFECTIVO],
  archivedCategories: [],
  archivedMethods: [],
  usdToPenE4: 37_500,
  lastPaymentMethodId: EFECTIVO.id,
};

const savedTask = (title: string): TaskItem => ({
  id: "44444444-4444-4444-8444-444444444444",
  title,
  priority: "medium",
  dueDate: null,
  dueTime: null,
  doneAt: null,
  createdAt: new Date(),
  lifeAreaId: null,
  projectId: null,
  milestoneId: null,
  isNextAction: false,
  area: null,
  project: null,
  recurrence: null,
  tags: [],
});

const savedExpense = (): ExpenseItem => ({
  id: "33333333-3333-4333-8333-000000000001",
  description: "café",
  amountCents: 1250,
  currency: "PEN",
  exchangeRateE4: null,
  spentOn: TODAY,
  category: null,
  paymentMethod: null,
  recurringPaymentId: null,
});

beforeEach(() => {
  window.matchMedia = vi.fn((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  // Wednesday 2026-10-07, 10:00 in Lima.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-07T15:00:00.000Z"));
  vi.mocked(listTaskTargets)
    .mockReset()
    .mockResolvedValue(ok({ areas: [], projects: [] }));
  vi.mocked(createTask)
    .mockReset()
    .mockResolvedValue(ok(savedTask("pilas")));
  vi.mocked(createExpense).mockReset().mockResolvedValue(ok(savedExpense()));
});
afterEach(() => vi.useRealTimers());

const preview = () => document.querySelector<HTMLButtonElement>("[data-nl-preview]");
const nlStatus = () => document.querySelector("[data-nl-status]")!;

describe("Tarea: the title's reading", () => {
  const titleField = () => screen.getByRole("textbox", { name: "¿Qué hay que hacer?" });
  const renderSheet = () =>
    render(<QuickCaptureSheet open onOpenChange={vi.fn()} returnFocusRef={createRef()} />);

  test("it appears while typing, speaks politely and leaves the field untouched", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(titleField(), "dentista vie 10am");
    expect(preview()).toHaveTextContent("Vence el vie 9 oct · 10:00");
    expect(preview()).toHaveTextContent("Quitar");
    expect(nlStatus()).toHaveAttribute("aria-live", "polite");
    expect(nlStatus()).toHaveTextContent(
      "Vence el vie 9 oct · 10:00. Toca para dejar el texto tal cual.",
    );
    // The field still shows what was typed.
    expect(titleField()).toHaveValue("dentista vie 10am");
  });

  test("a title with no tokens shows nothing, and the status stays empty but mounted", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(titleField(), "comprar 3 pilas");
    expect(preview()).toBeNull();
    expect(nlStatus()).toHaveTextContent("");
  });

  test("saving sends the title without the tokens, with the date and the hour", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(titleField(), "dentista vie 10am{Enter}");
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({ title: "dentista", dueDate: "2026-10-09", dueTime: "10:00" }),
    );
  });

  test("pilas mañana: title 'pilas' and tomorrow in Lima", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(titleField(), "pilas mañana{Enter}");
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({ title: "pilas", dueDate: "2026-10-08" }),
    );
  });

  test("a touch cancels it: the text stays as typed, focus returns to the field, the title is sent whole", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(titleField(), "pilas mañana");
    await user.click(preview()!);
    expect(preview()).toBeNull();
    expect(titleField()).toHaveValue("pilas mañana");
    expect(titleField()).toHaveFocus();
    await waitFor(() => expect(nlStatus()).toHaveTextContent(""));

    // Cancelled for this entry: more typing does not bring it back.
    await user.type(titleField(), " 10am");
    expect(preview()).toBeNull();
    await user.keyboard("{Enter}");
    const sent = vi.mocked(createTask).mock.calls[0]![0] as {
      title: string;
      dueDate: string | null;
    };
    expect(sent.title).toBe("pilas mañana 10am");
    expect(sent.dueDate).toBeNull();
    expect(sent).not.toHaveProperty("dueTime");
  });

  test("the key can be reached and used from the keyboard", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(titleField(), "pilas mañana");
    preview()!.focus();
    await user.keyboard("{Enter}");
    expect(preview()).toBeNull();
    expect(titleField()).toHaveFocus();
  });

  test("a day picked by hand rules: the date words stay in the title; an hour still goes with that day", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(screen.getByLabelText("Fecha límite"), "2026-10-20");
    await user.type(titleField(), "pilas mañana");
    expect(preview()).toBeNull();
    await user.type(titleField(), " 10am");
    expect(preview()).toHaveTextContent("Hora 10:00");
    await user.keyboard("{Enter}");
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({ title: "pilas mañana", dueDate: "2026-10-20", dueTime: "10:00" }),
    );
  });

  test("after saving, the next entry starts with no reading and uncancelled", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(titleField(), "pilas mañana");
    await user.click(preview()!);
    await user.keyboard("{Enter}");
    await waitFor(() => expect(titleField()).toHaveValue(""));
    await user.type(titleField(), "llamar hoy");
    expect(preview()).toHaveTextContent("Vence el mié 7 oct");
  });
});

describe("Gasto: the description's reading", () => {
  const description = () => screen.getByRole("textbox", { name: "Descripción (opcional)" });
  const amount = () => screen.getByRole("textbox", { name: /^Monto en/ });
  const renderSheet = () =>
    render(
      <ExpenseSheet
        open
        onOpenChange={vi.fn()}
        returnFocusRef={createRef()}
        catalog={CATALOG}
        today={TODAY}
      />,
    );

  test("'12.50 café' shows the amount and the description, and saves 12.50 with 'café'", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(description(), "12.50 café");
    expect(preview()).toHaveTextContent("S/ 12.50 · café");
    expect(description()).toHaveValue("12.50 café");
    await user.keyboard("{Enter}");
    expect(createExpense).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: "12.50",
        description: "café",
        paymentMethodId: EFECTIVO.id,
        currency: "PEN",
      }),
    );
  });

  test("typed in the amount field itself ('12.50 café', a desktop keyboard) it reads the same", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(amount(), "12.50 café");
    expect(preview()).toHaveTextContent("S/ 12.50 · café");
    await user.keyboard("{Enter}");
    expect(createExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: "12.50", description: "café", currency: "PEN" }),
    );
  });

  test("cancelling from the amount field returns focus to it and the text is refused as an amount", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(amount(), "12.50 café");
    await user.click(preview()!);
    expect(preview()).toBeNull();
    expect(amount()).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(createExpense).not.toHaveBeenCalled();
  });

  test("a currency in the text wins over the method's", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(description(), "USD 95 claude{Enter}");
    expect(createExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: "95", description: "claude", currency: "USD" }),
    );
  });

  test("a touch cancels it and the description is sent as typed (the amount rules empty)", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(description(), "12.50 café");
    await user.click(preview()!);
    expect(preview()).toBeNull();
    expect(description()).toHaveValue("12.50 café");
    expect(description()).toHaveFocus();
    await user.keyboard("{Enter}");
    // Nothing was understood: no amount, so the form refuses it on the amount field.
    expect(createExpense).not.toHaveBeenCalled();
  });

  test("an amount typed by hand rules: the description is not read", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(amount(), "5");
    await user.type(description(), "12.50 café");
    expect(preview()).toBeNull();
    await user.keyboard("{Enter}");
    expect(createExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: "5", description: "12.50 café" }),
    );
  });

  test("a description with no amount shows nothing", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(description(), "café");
    expect(preview()).toBeNull();
  });
});
