// G1 of `goals`: /goals as the owner sees it (the list, the rows, "+1" with "Deshacer", the form),
// against a fake server. The Server Actions are mocked; the screen's queue, notices and the
// optimistic list are the real ones.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ok, type ActionResult } from "@/lib/action-result";
import { ownerDateKey } from "@/lib/time";
import { addEntryToGoal, createGoal, undoEntryOfGoal } from "@/modules/goals/actions";
import { GoalsList } from "@/modules/goals/components/goals-list";
import { GoalsScreen } from "@/modules/goals/components/goals-screen";
import type { GoalItem } from "@/modules/goals/goal-input";
import type { EntryResult } from "@/modules/goals/goals";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => router,
}));
vi.mock("@/modules/goals/actions", () => ({
  addEntryToGoal: vi.fn(),
  undoEntryOfGoal: vi.fn(),
  createGoal: vi.fn(),
  updateGoal: vi.fn(),
  reorderGoals: vi.fn(),
  unarchiveGoal: vi.fn(),
  archiveGoal: vi.fn(),
  deleteGoal: vi.fn(),
  restoreGoal: vi.fn(),
  markGoalAchieved: vi.fn(),
  reopenGoal: vi.fn(),
}));
// The goals module's data layer is server only: the type is all the test needs of it.
vi.mock("@/modules/goals/goals", () => ({}));
vi.mock("@/lib/celebrate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/celebrate")>()),
  celebrateStreak: vi.fn(),
}));

/** Monday 2026-10-12, 10:00 in Lima (T4 2026). Only Date is faked (timers stay real for userEvent). */
const NOW = new Date("2026-10-12T15:00:00.000Z");
const TODAY = ownerDateKey(NOW);

let serial = 0;
function goal(values: Partial<GoalItem> = {}): GoalItem {
  serial += 1;
  return {
    id: `00000000-0000-4000-8000-${String(serial).padStart(12, "0")}`,
    title: `Meta ${serial}`,
    notes: null,
    periodKind: "year",
    year: 2026,
    quarter: null,
    sourceKind: "manual",
    habitId: null,
    projectId: null,
    target: 12,
    unit: "libros",
    status: "active",
    achievedAt: null,
    position: serial,
    area: null,
    sum: 0,
    ...values,
  };
}

const LIBROS = goal({ title: "Leer 12 libros", sum: 5 });
const KM = goal({
  title: "Correr 90 km",
  periodKind: "quarter",
  quarter: 4,
  target: 90,
  unit: "km",
  sum: 20,
});
const PASADA = goal({
  title: "Curso de inglés",
  periodKind: "quarter",
  quarter: 3,
  target: 10,
  unit: "lecciones",
  sum: 7,
});
const ARCHIVADA = goal({ title: "Pintar", status: "archived", sum: 2 });

function Screen({ goals }: { goals: GoalItem[] }) {
  return (
    <GoalsScreen today={TODAY} areas={[]}>
      <GoalsList goals={goals} headingId="goals-title" />
    </GoalsScreen>
  );
}

/** Calls wait until the test answers them (every one must settle before the test ends). */
const pending: ((result: ActionResult<never>) => void)[] = [];
async function answer(result: ActionResult<unknown>) {
  const call = pending.shift();
  if (!call) throw new Error("No pending call");
  await act(async () => call(result as ActionResult<never>));
}
const wait = () =>
  new Promise<ActionResult<never>>((resolve) => {
    pending.push(resolve);
  });

const row = (title: string) =>
  screen.getByRole("link", { name: title }).closest("li") as HTMLElement;
const notices = () => screen.getByRole("region", { name: "Avisos de metas" });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  pending.length = 0;
  vi.mocked(addEntryToGoal).mockImplementation(wait);
  vi.mocked(undoEntryOfGoal).mockImplementation(wait);
  vi.mocked(createGoal).mockImplementation(wait);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("the list", () => {
  test("this quarter and this year, each goal with its bar, its count and its pace", () => {
    render(<Screen goals={[LIBROS, KM]} />);
    expect(screen.getByRole("heading", { level: 1, name: "Metas" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Este trimestre (T4 2026)" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Este año (2026)" })).toBeInTheDocument();

    const libros = row("Leer 12 libros");
    const bar = within(libros).getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "12");
    expect(bar).toHaveAttribute("aria-valuenow", "5");
    expect(bar).toHaveAttribute("aria-valuetext", "5 de 12 libros");
    expect(within(libros).getByText("5 de 12 libros")).toBeInTheDocument();
    // Day 285 of 365: 9.4 expected, 5 is below: a next step, never a reproach.
    expect(libros.querySelector("[data-goal-line]")?.textContent).toMatch(
      /^Para llegar: ~\d+ libros por semana$/,
    );
    // The quarter one: day 12 of 92 → 11.7 expected, 20 is ahead.
    expect(
      within(row("Correr 90 km")).getByText("Vas 8 por delante de tu ritmo"),
    ).toBeInTheDocument();
  });

  test("a goal in its period has '+1' and 'Sumar…' (aria-disabled, never disabled, is for pending)", () => {
    render(<Screen goals={[LIBROS]} />);
    const add = within(row("Leer 12 libros")).getByRole("button", {
      name: "+1 en «Leer 12 libros»",
    });
    expect(add).toHaveTextContent("+1");
    expect(add).not.toBeDisabled();
    expect(
      within(row("Leer 12 libros")).getByRole("button", { name: /Sumar otra cantidad/ }),
    ).toBeInTheDocument();
  });

  test("a past goal that was not reached is in 'Anteriores' with its final value, no keys and no alarm", async () => {
    const user = userEvent.setup();
    render(<Screen goals={[LIBROS, PASADA, ARCHIVADA]} />);
    const toggle = screen.getByRole("button", { name: /Anteriores/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const past = row("Curso de inglés");
    expect(past).toHaveAttribute("data-goal-status", "active");
    expect(within(past).getByText("7 de 10 lecciones")).toBeInTheDocument();
    expect(within(past).getByText("Terminó con 7 de 10 lecciones.")).toBeInTheDocument();
    expect(within(past).queryByRole("button")).not.toBeInTheDocument();
    // The archived one says so in words, and can be reactivated.
    expect(within(row("Pintar")).getByText("Archivada")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reactivar «Pintar»" })).toBeInTheDocument();
    // Neither a past nor an archived goal is in the sections of the current periods.
    const yearSection = document.querySelector('[data-goals-section="year"]') as HTMLElement;
    expect(within(yearSection).queryByText("Curso de inglés")).not.toBeInTheDocument();
    expect(within(yearSection).queryByText("Pintar")).not.toBeInTheDocument();
  });

  test("empty: an example and 'Crear mi primera meta'", () => {
    render(<Screen goals={[]} />);
    expect(screen.getByText("Todavía no tienes metas")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Crear mi primera meta" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ordenar" })).not.toBeInTheDocument();
  });

  test("'Ordenar' needs two goals in a section", () => {
    const { rerender } = render(<Screen goals={[LIBROS, KM]} />);
    expect(screen.queryByRole("button", { name: "Ordenar" })).not.toBeInTheDocument();
    rerender(<Screen goals={[LIBROS, goal({ title: "Otra" }), KM]} />);
    expect(screen.getByRole("button", { name: "Ordenar" })).toBeInTheDocument();
  });
});

describe("+1 and Deshacer", () => {
  function entry(source: GoalItem, sum: number, achievedNow = false): ActionResult<EntryResult> {
    return ok({
      goal: { ...source, sum, status: achievedNow ? "achieved" : source.status },
      entryId: "99999999-9999-4999-8999-999999999999",
      achievedNow,
    });
  }

  test("the tap shows the new count at once, then the notice undoes that exact entry", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Screen goals={[LIBROS]} />);
    await user.click(screen.getByRole("button", { name: "+1 en «Leer 12 libros»" }));

    // Optimistic: 6 de 12 before the server answers.
    expect(within(row("Leer 12 libros")).getByText("6 de 12 libros")).toBeInTheDocument();
    expect(within(row("Leer 12 libros")).getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "6",
    );
    await waitFor(() =>
      expect(addEntryToGoal).toHaveBeenCalledWith({ goalId: LIBROS.id, delta: 1 }),
    );
    await answer(entry(LIBROS, 6));
    // The Server Action revalidates the page: the props now carry the saved sum.
    rerender(<Screen goals={[{ ...LIBROS, sum: 6 }]} />);

    expect(
      await within(notices()).findByText("+1 en «Leer 12 libros»: 6 de 12 libros."),
    ).toBeInTheDocument();
    await user.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    // The undo carries the id of the entry the tap created, never just the goal.
    await waitFor(() =>
      expect(undoEntryOfGoal).toHaveBeenCalledWith({
        goalId: LIBROS.id,
        entryId: "99999999-9999-4999-8999-999999999999",
      }),
    );
    // Optimistic back to 5 before the answer.
    await waitFor(() =>
      expect(within(row("Leer 12 libros")).getByText("5 de 12 libros")).toBeInTheDocument(),
    );
    await answer(ok({ ...LIBROS, sum: 5 }));
    rerender(<Screen goals={[LIBROS]} />);
    expect(within(row("Leer 12 libros")).getByText("5 de 12 libros")).toBeInTheDocument();
  });

  test("two quick taps both count", async () => {
    const user = userEvent.setup();
    render(<Screen goals={[LIBROS]} />);
    const add = screen.getByRole("button", { name: "+1 en «Leer 12 libros»" });
    await user.click(add);
    await user.click(add);
    expect(within(row("Leer 12 libros")).getByText("7 de 12 libros")).toBeInTheDocument();
    await waitFor(() => expect(addEntryToGoal).toHaveBeenCalledTimes(1));
    await answer(entry(LIBROS, 6));
    await waitFor(() => expect(addEntryToGoal).toHaveBeenCalledTimes(2));
    await answer(entry(LIBROS, 7));
  });

  test("a refusal rolls the count back and says so (assert the rollback inside waitFor)", async () => {
    const user = userEvent.setup();
    render(<Screen goals={[LIBROS]} />);
    await user.click(screen.getByRole("button", { name: "+1 en «Leer 12 libros»" }));
    expect(within(row("Leer 12 libros")).getByText("6 de 12 libros")).toBeInTheDocument();
    await answer({ ok: false, error: "Esta meta ya no existe (se eliminó)." });
    // The failure notice can render before useOptimistic rolls back.
    await waitFor(() =>
      expect(within(row("Leer 12 libros")).getByText("5 de 12 libros")).toBeInTheDocument(),
    );
    expect(
      await within(notices()).findByText(/No se pudo sumar\. Esta meta ya no existe/),
    ).toBeInTheDocument();
  });

  test("reaching the target says so and achieves it on the screen at once", async () => {
    const user = userEvent.setup();
    const casi = goal({ title: "Casi", sum: 11 });
    render(<Screen goals={[casi]} />);
    await user.click(screen.getByRole("button", { name: "+1 en «Casi»" }));
    expect(row("Casi")).toHaveAttribute("data-goal-status", "achieved");
    expect(within(row("Casi")).getByText("Lograda")).toBeInTheDocument();
    await answer(entry(casi, 12, true));
    expect(await within(notices()).findByText("Meta lograda")).toBeInTheDocument();
  });
});

describe("the form", () => {
  test("creates a manual goal in a few keystrokes (title, target, unit)", async () => {
    const user = userEvent.setup();
    render(<Screen goals={[]} />);
    await user.click(screen.getByRole("button", { name: "Crear mi primera meta" }));
    const sheet = await screen.findByRole("dialog", { name: "Nueva meta" });
    // Only "Cantidad" for now.
    expect(within(sheet).getByRole("radio", { name: "Cantidad" })).toBeChecked();
    expect(within(sheet).queryByRole("radio", { name: "Hábito" })).not.toBeInTheDocument();

    await user.type(within(sheet).getByRole("textbox", { name: "Título" }), "Leer 12 libros");
    await user.type(within(sheet).getByRole("textbox", { name: "Meta" }), "12");
    await user.type(within(sheet).getByRole("textbox", { name: "Unidad" }), "libros");
    await user.click(within(sheet).getByRole("button", { name: "Crear meta" }));

    await waitFor(() =>
      expect(createGoal).toHaveBeenCalledWith({
        title: "Leer 12 libros",
        notes: null,
        areaId: null,
        sourceKind: "manual",
        target: 12,
        unit: "libros",
        periodKind: "year",
        year: 2026,
        quarter: null,
      }),
    );
    await answer(ok(goal({ title: "Leer 12 libros" })));
  });

  test("the quarter is the current one", async () => {
    const user = userEvent.setup();
    render(<Screen goals={[]} />);
    await user.click(screen.getByRole("button", { name: "Crear mi primera meta" }));
    const sheet = await screen.findByRole("dialog", { name: "Nueva meta" });
    await user.click(within(sheet).getByRole("radio", { name: "Trimestre" }));
    expect(within(sheet).getByText("Este trimestre: T4 2026")).toBeInTheDocument();
    await user.type(within(sheet).getByRole("textbox", { name: "Título" }), "Correr");
    await user.type(within(sheet).getByRole("textbox", { name: "Meta" }), "90");
    await user.type(within(sheet).getByRole("textbox", { name: "Unidad" }), "km");
    await user.click(within(sheet).getByRole("button", { name: "Crear meta" }));
    await waitFor(() =>
      expect(createGoal).toHaveBeenCalledWith(
        expect.objectContaining({ periodKind: "quarter", year: 2026, quarter: 4 }),
      ),
    );
    await answer(ok(goal({ title: "Correr" })));
  });

  test("invalid fields show their errors on the field and do not call the server", async () => {
    const user = userEvent.setup();
    render(<Screen goals={[]} />);
    await user.click(screen.getByRole("button", { name: "Crear mi primera meta" }));
    const sheet = await screen.findByRole("dialog", { name: "Nueva meta" });
    await user.click(within(sheet).getByRole("button", { name: "Crear meta" }));
    expect(await within(sheet).findByText("Escribe el título de la meta.")).toBeInTheDocument();
    expect(
      within(sheet).getByText("La meta es un número entero de 1 a 100 000."),
    ).toBeInTheDocument();
    expect(
      within(sheet).getByText("Escribe la unidad (libros, km, páginas…)."),
    ).toBeInTheDocument();
    expect(createGoal).not.toHaveBeenCalled();
    // Focus lands on the first invalid field.
    await waitFor(() =>
      expect(within(sheet).getByRole("textbox", { name: "Título" })).toHaveFocus(),
    );
  });
});
