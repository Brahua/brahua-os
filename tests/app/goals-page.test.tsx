// `goals`: /goals as the owner sees it (the list, the rows, "+1" with "Deshacer", the form),
// against a fake server. The Server Actions are mocked; the screen's queue, notices and the
// optimistic list are the real ones.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ok, type ActionResult } from "@/lib/action-result";
import { ownerDateKey } from "@/lib/time";
import {
  addEntryToGoal,
  createGoal,
  moveGoalToNext,
  undoEntryOfGoal,
  undoMoveOfGoal,
} from "@/modules/goals/actions";
import { GoalsList } from "@/modules/goals/components/goals-list";
import { GoalsScreen } from "@/modules/goals/components/goals-screen";
import type { GoalItem, GoalMove, GoalMoveUndo } from "@/modules/goals/goal-input";
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
  setWeeklyObjective: vi.fn(),
  clearWeeklyObjective: vi.fn(),
  undoWeeklyObjective: vi.fn(),
  moveGoalToNext: vi.fn(),
  undoMoveOfGoal: vi.fn(),
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
    source: null,
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

const HABIT_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const SOURCES = {
  habits: [
    { id: HABIT_ID, name: "Correr" },
    { id: "33333333-3333-4333-8333-333333333333", name: "Meditar" },
  ],
  projects: [{ id: PROJECT_ID, name: "Lanzar brahua-os" }],
};

function Screen({ goals, sources = SOURCES }: { goals: GoalItem[]; sources?: typeof SOURCES }) {
  return (
    <GoalsScreen today={TODAY} areas={[]} sources={sources}>
      <GoalsList
        goals={goals}
        weekStart="2026-10-12"
        weeklyObjective={null}
        headingId="goals-title"
      />
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
  vi.mocked(moveGoalToNext).mockImplementation(wait);
  vi.mocked(undoMoveOfGoal).mockImplementation(wait);
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
    // Its only key says where it goes; "+1" is not offered in a period that is over.
    expect(
      within(past)
        .getAllByRole("button")
        .map((key) => key.textContent),
    ).toEqual(["Pasar a T4 2026"]);
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

const HABITO = goal({
  title: "Correr 40 días",
  periodKind: "quarter",
  quarter: 4,
  sourceKind: "habit",
  habitId: HABIT_ID,
  unit: null,
  target: 40,
  source: { kind: "habit", name: "Correr", done: 34, expected: 36 },
});
const PROYECTO = goal({
  title: "Lanzar la v1",
  sourceKind: "project",
  projectId: PROJECT_ID,
  unit: null,
  target: 100,
  source: { kind: "project", name: "Lanzar brahua-os", percent: 62, finished: false },
});

describe("Pasar al próximo periodo", () => {
  const FROM = { year: 2026, quarter: 3, position: 2 };

  async function openPrevious(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: /Anteriores/ }));
  }

  test("moves the goal to the next quarter at once, and 'Deshacer' carries where it was", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Screen goals={[LIBROS, PASADA]} />);
    await openPrevious(user);
    await user.click(screen.getByRole("button", { name: "Pasar «Curso de inglés» a T4 2026" }));

    // Optimistic: it left "Anteriores" for this quarter before the server answers.
    const quarter = document.querySelector('[data-goals-section="quarter"]') as HTMLElement;
    expect(within(quarter).getByText("Curso de inglés")).toBeInTheDocument();
    await waitFor(() =>
      expect(moveGoalToNext).toHaveBeenCalledWith({ id: PASADA.id, year: 2026, quarter: 3 }),
    );
    const saved = { ...PASADA, quarter: 4 };
    const result: ActionResult<GoalMove> = ok({ goal: saved, moved: true, from: FROM });
    await answer(result);
    rerender(<Screen goals={[LIBROS, saved]} />);

    expect(
      await within(notices()).findByText("«Curso de inglés» pasó a T4 2026."),
    ).toBeInTheDocument();
    await user.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    await waitFor(() =>
      expect(undoMoveOfGoal).toHaveBeenCalledWith({
        id: PASADA.id,
        from: FROM,
        applied: { year: 2026, quarter: 4 },
      }),
    );
    const undone: ActionResult<GoalMoveUndo> = ok({ goal: PASADA, restored: true });
    await answer(undone);
    rerender(<Screen goals={[LIBROS, PASADA]} />);
    expect(screen.getByRole("button", { name: /Anteriores/ })).toBeInTheDocument();
  });

  test("an undo that finds the goal changed says so instead of announcing it back", async () => {
    const user = userEvent.setup();
    render(<Screen goals={[LIBROS, PASADA]} />);
    await openPrevious(user);
    await user.click(screen.getByRole("button", { name: "Pasar «Curso de inglés» a T4 2026" }));
    await waitFor(() => expect(moveGoalToNext).toHaveBeenCalled());
    await answer(ok({ goal: { ...PASADA, quarter: 4 }, moved: true, from: FROM }));
    await user.click(await within(notices()).findByRole("button", { name: "Deshacer" }));
    await waitFor(() => expect(undoMoveOfGoal).toHaveBeenCalled());
    await answer(ok({ goal: { ...PASADA, quarter: 4 }, restored: false }));
    expect(
      await within(notices()).findByText(
        "«Curso de inglés» cambió mientras tanto: la dejé como está.",
      ),
    ).toBeInTheDocument();
  });

  test("a refusal rolls it back and says so (assert the rollback inside waitFor)", async () => {
    const user = userEvent.setup();
    render(<Screen goals={[LIBROS, PASADA]} />);
    await openPrevious(user);
    await user.click(screen.getByRole("button", { name: "Pasar «Curso de inglés» a T4 2026" }));
    await waitFor(() => expect(moveGoalToNext).toHaveBeenCalled());
    await answer({ ok: false, error: "Esta meta ya no existe (se eliminó)." });
    expect(
      await within(notices()).findByText(/No se pudo pasar al próximo periodo/),
    ).toBeInTheDocument();
    await waitFor(() => {
      const quarter = document.querySelector('[data-goals-section="quarter"]') as HTMLElement;
      expect(within(quarter).queryByText("Curso de inglés")).not.toBeInTheDocument();
    });
  });

  test("archived goals and goals of the current period have no key in 'Anteriores'", async () => {
    const user = userEvent.setup();
    render(<Screen goals={[LIBROS, ARCHIVADA, PASADA]} />);
    await openPrevious(user);
    expect(within(row("Pintar")).queryByRole("button", { name: /Pasar/ })).not.toBeInTheDocument();
    // Positive control: the past goal has it.
    expect(
      within(row("Curso de inglés")).getByRole("button", { name: /Pasar/ }),
    ).toBeInTheDocument();
  });
});

describe("habit and project goals in the list", () => {
  test("a habit goal reads '34 de 40 días', links to its habit and has no +1", () => {
    render(<Screen goals={[HABITO]} />);
    const habit = row("Correr 40 días");
    expect(within(habit).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "34");
    expect(within(habit).getByText(/34 de 40 días/)).toBeInTheDocument();
    expect(within(habit).getByRole("link", { name: "Abrir el hábito «Correr»" })).toHaveAttribute(
      "href",
      `/habits/${HABIT_ID}`,
    );
    expect(within(habit).queryByRole("button", { name: /\+1/ })).not.toBeInTheDocument();
    expect(within(habit).queryByRole("button", { name: /Sumar/ })).not.toBeInTheDocument();
    // The pace is a next step or "por delante": it is there for a habit.
    expect(habit.querySelector("[data-goal-line]")).not.toBeNull();
  });

  test("a project goal reads '62 %' with its project, no pace and no +1", () => {
    render(<Screen goals={[PROYECTO]} />);
    const project = row("Lanzar la v1");
    expect(within(project).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "62");
    expect(within(project).getByText(/62 %/)).toBeInTheDocument();
    expect(
      within(project).getByRole("link", { name: "Abrir el proyecto «Lanzar brahua-os»" }),
    ).toHaveAttribute("href", `/projects/${PROJECT_ID}`);
    expect(project.querySelector("[data-goal-line]")).toBeNull();
    expect(within(project).queryByRole("button", { name: /\+1/ })).not.toBeInTheDocument();
  });

  test("a goal whose habit is gone says so instead of a number", () => {
    render(<Screen goals={[goal({ ...HABITO, title: "Sin hábito", source: null })]} />);
    const gone = row("Sin hábito");
    expect(within(gone).queryByRole("progressbar")).not.toBeInTheDocument();
    expect(within(gone).getByText(/sigue un hábito o proyecto que ya no está/)).toBeInTheDocument();
  });
});

describe("the form", () => {
  test("creates a manual goal in a few keystrokes (title, target, unit)", async () => {
    const user = userEvent.setup();
    render(<Screen goals={[]} />);
    await user.click(screen.getByRole("button", { name: "Crear mi primera meta" }));
    const sheet = await screen.findByRole("dialog", { name: "Nueva meta" });
    // "Cantidad" is the default; Hábito and Proyecto are the other two ways to measure it.
    expect(within(sheet).getByRole("radio", { name: "Cantidad" })).toBeChecked();
    expect(within(sheet).getByRole("radio", { name: "Hábito" })).not.toBeChecked();
    expect(within(sheet).getByRole("radio", { name: "Proyecto" })).not.toBeChecked();

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

describe("the form: how it is measured", () => {
  async function openForm() {
    const user = userEvent.setup();
    render(<Screen goals={[]} />);
    await user.click(screen.getByRole("button", { name: "Crear mi primera meta" }));
    const sheet = await screen.findByRole("dialog", { name: "Nueva meta" });
    return { user, sheet };
  }

  test("each source brings its own fields", async () => {
    const { user, sheet } = await openForm();
    expect(within(sheet).getByRole("textbox", { name: "Unidad" })).toBeInTheDocument();
    expect(within(sheet).queryByRole("combobox", { name: "Hábito" })).not.toBeInTheDocument();

    await user.click(within(sheet).getByRole("radio", { name: "Hábito" }));
    expect(within(sheet).getByRole("combobox", { name: "Hábito" })).toBeInTheDocument();
    expect(within(sheet).getByRole("textbox", { name: "Días a cumplir" })).toBeInTheDocument();
    expect(within(sheet).queryByRole("textbox", { name: "Unidad" })).not.toBeInTheDocument();
    expect(within(sheet).queryByRole("combobox", { name: "Proyecto" })).not.toBeInTheDocument();
    expect(within(sheet).getByRole("option", { name: "Meditar" })).toBeInTheDocument();

    await user.click(within(sheet).getByRole("radio", { name: "Proyecto" }));
    expect(within(sheet).getByRole("combobox", { name: "Proyecto" })).toBeInTheDocument();
    expect(
      within(sheet).queryByRole("textbox", { name: "Días a cumplir" }),
    ).not.toBeInTheDocument();
    expect(within(sheet).queryByRole("textbox", { name: "Meta" })).not.toBeInTheDocument();

    await user.click(within(sheet).getByRole("radio", { name: "Cantidad" }));
    expect(within(sheet).getByRole("textbox", { name: "Meta" })).toBeInTheDocument();
    expect(within(sheet).getByRole("textbox", { name: "Unidad" })).toBeInTheDocument();
  });

  test("a habit goal sends the habit and its days, nothing of the other sources", async () => {
    const { user, sheet } = await openForm();
    await user.type(within(sheet).getByRole("textbox", { name: "Título" }), "Correr 40 días");
    await user.click(within(sheet).getByRole("radio", { name: "Hábito" }));
    await user.selectOptions(within(sheet).getByRole("combobox", { name: "Hábito" }), HABIT_ID);
    await user.type(within(sheet).getByRole("textbox", { name: "Días a cumplir" }), "40");
    await user.click(within(sheet).getByRole("button", { name: "Crear meta" }));
    await waitFor(() =>
      expect(createGoal).toHaveBeenCalledWith({
        title: "Correr 40 días",
        notes: null,
        areaId: null,
        sourceKind: "habit",
        habitId: HABIT_ID,
        target: 40,
        periodKind: "year",
        year: 2026,
        quarter: null,
      }),
    );
    await answer(ok(goal({ title: "Correr 40 días" })));
  });

  test("a project goal sends just the project (its target is fixed)", async () => {
    const { user, sheet } = await openForm();
    await user.type(within(sheet).getByRole("textbox", { name: "Título" }), "Lanzar la v1");
    await user.click(within(sheet).getByRole("radio", { name: "Proyecto" }));
    await user.selectOptions(within(sheet).getByRole("combobox", { name: "Proyecto" }), PROJECT_ID);
    await user.click(within(sheet).getByRole("button", { name: "Crear meta" }));
    await waitFor(() =>
      expect(createGoal).toHaveBeenCalledWith(
        expect.objectContaining({ sourceKind: "project", projectId: PROJECT_ID, target: 100 }),
      ),
    );
    await answer(ok(goal({ title: "Lanzar la v1" })));
  });

  test("without a pick, the habit field says so and takes focus; nothing is sent", async () => {
    const { user, sheet } = await openForm();
    await user.type(within(sheet).getByRole("textbox", { name: "Título" }), "Correr");
    await user.click(within(sheet).getByRole("radio", { name: "Hábito" }));
    await user.type(within(sheet).getByRole("textbox", { name: "Días a cumplir" }), "40");
    await user.click(within(sheet).getByRole("button", { name: "Crear meta" }));
    expect(await within(sheet).findByText("Elige un hábito.")).toBeInTheDocument();
    await waitFor(() =>
      expect(within(sheet).getByRole("combobox", { name: "Hábito" })).toHaveFocus(),
    );
    expect(createGoal).not.toHaveBeenCalled();
  });

  test("with no habits to follow, the field explains where to make one", async () => {
    const user = userEvent.setup();
    render(<Screen goals={[]} sources={{ habits: [], projects: [] }} />);
    await user.click(screen.getByRole("button", { name: "Crear mi primera meta" }));
    const sheet = await screen.findByRole("dialog", { name: "Nueva meta" });
    await user.click(within(sheet).getByRole("radio", { name: "Hábito" }));
    expect(within(sheet).getByText(/Todavía no tienes hábitos activos/)).toBeInTheDocument();
  });
});
