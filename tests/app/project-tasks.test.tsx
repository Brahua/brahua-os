// T5: the "Tareas" section of a project's page (groups by milestone, the next action, adding
// inline, completing with undo, the done ones folded), the detail's "Próxima acción" and the
// card's "Siguiente tarea", against mocked actions.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { ScreenServicesProvider } from "@/modules/core/components/screen-services";
import { NextActionKey } from "@/modules/projects/components/next-action-key";
import { ProjectCard } from "@/modules/projects/components/project-card";
import type { ProjectSummary } from "@/modules/projects/project-input";
import { createTask } from "@/modules/tasks/actions";
import { TaskDetailProvider } from "@/modules/tasks/components/detail/task-detail-context";
import { TaskNextActionSection } from "@/modules/tasks/components/detail/task-next-action-section";
import { ProjectTasksSection } from "@/modules/tasks/components/project/project-tasks-section";
import { TasksScreen } from "@/modules/tasks/components/tasks-screen";
import { setNextAction, undoCompleteNextAction } from "@/modules/tasks/project-task-actions";
import { completeTaskWithNext, reopenTaskWithSpawn } from "@/modules/tasks/recurrence-actions";
import type { TaskItem, TaskTargets } from "@/modules/tasks/task-input";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/modules/tasks/actions", () => ({
  createTask: vi.fn(),
  listTaskTargets: vi.fn(),
  editTask: vi.fn(),
  completeTask: vi.fn(),
  reopenTask: vi.fn(),
  deleteTask: vi.fn(),
  restoreTask: vi.fn(),
}));
// T3: the lists complete and undo through the recurrence actions (the next occurrence comes back).
vi.mock("@/modules/tasks/recurrence-actions", () => ({
  setTaskRecurrence: vi.fn(),
  completeTaskWithNext: vi.fn(),
  reopenTaskWithSpawn: vi.fn(),
  restoreTaskWithSpawn: vi.fn(),
}));
vi.mock("@/modules/tasks/project-task-actions", () => ({
  setNextAction: vi.fn(),
  undoCompleteNextAction: vi.fn(),
}));

// 10:00 in Lima on Friday, Oct 2, 2026.
const NOW = new Date("2026-10-02T15:00:00.000Z");
const HOME = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "home",
  name: "Hogar",
  icon: "house",
  color: "home",
} as const;
const PROJECT = { id: "33333333-3333-4333-8333-333333333333", name: "Cocina" };
const TARGETS: TaskTargets = {
  areas: [HOME],
  projects: [{ ...PROJECT, status: "active", area: HOME }],
};
const PLANS = { id: "44444444-4444-4444-8444-444444444444", title: "Planos" };
const PAINT = { id: "55555555-5555-4555-8555-555555555555", title: "Pintura" };

let serial = 0;
function task(values: Partial<TaskItem>): TaskItem {
  serial += 1;
  return {
    id: `00000000-0000-4000-8000-${String(serial).padStart(12, "0")}`,
    title: `Tarea ${serial}`,
    priority: "medium",
    dueDate: null,
    dueTime: null,
    doneAt: null,
    createdAt: new Date(NOW.getTime() + serial),
    lifeAreaId: null,
    projectId: PROJECT.id,
    milestoneId: null,
    isNextAction: false,
    area: HOME,
    project: { ...PROJECT, status: "active" },
    recurrence: null,
    tags: [],
    ...values,
  };
}

const MEASURE = task({ title: "medir paredes", milestoneId: PLANS.id, isNextAction: true });
const DRAW = task({ title: "dibujar planta", milestoneId: PLANS.id });
const SAND = task({ title: "lijar", milestoneId: PAINT.id });
const LOOSE = task({ title: "llamar al gasfitero" });
const DONE = task({ title: "comprar cinta", doneAt: new Date("2026-10-01T15:00:00.000Z") });

function renderSection(props: Partial<Parameters<typeof ProjectTasksSection>[0]> = {}) {
  return render(
    <ScreenServicesProvider label="Avisos" actionHint="Para deshacer…">
      <ProjectTasksSection
        project={PROJECT}
        open
        milestones={[PLANS, PAINT]}
        pending={[LOOSE, SAND, DRAW, MEASURE]}
        done={[DONE]}
        now={NOW}
        targets={TARGETS}
        {...props}
      />
    </ScreenServicesProvider>,
  );
}

beforeEach(() => {
  // The phone: a title is a link to the task's page (the desktop opens the detail sheet).
  window.matchMedia = vi.fn((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  vi.mocked(createTask).mockReset();
  vi.mocked(completeTaskWithNext).mockReset();
  vi.mocked(reopenTaskWithSpawn).mockReset();
  vi.mocked(setNextAction).mockReset();
  vi.mocked(undoCompleteNextAction).mockReset();
});

describe("Tareas section", () => {
  test("grouped by milestone in order, Sin hito last; the next action; no area on the rows", () => {
    renderSection();
    const section = screen.getByRole("region", { name: "Tareas, 4 pendientes" });
    const groups = within(section)
      .getAllByRole("heading", { level: 3 })
      .map((heading) => heading.textContent);
    expect(groups.slice(0, 3)).toEqual(["Planos", "Pintura", "Sin hito"]);
    const plans = within(section).getByRole("list", { name: "Planos" });
    expect(
      within(plans)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["medir paredes", "dibujar planta"]);
    expect(section).toHaveTextContent("Próxima acción: medir paredes");
    expect(
      within(section).getByRole("button", { name: "Próxima acción: medir paredes" }),
    ).toHaveAttribute("aria-pressed", "true");
    // The page is the project's: the rows don't repeat its area and name.
    expect(within(plans).queryByText("Hogar · Cocina")).toBeNull();
    // The done ones, folded.
    const toggle = within(section).getByRole("button", {
      name: "Hechas en los últimos 30 días, 1",
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(within(section).getByText("comprar cinta")).not.toBeVisible();
  });

  test("without tasks in milestones the list is flat (no lone Sin hito)", () => {
    renderSection({ pending: [LOOSE] });
    const section = screen.getByRole("region", { name: "Tareas, 1 pendiente" });
    expect(within(section).queryByRole("heading", { name: "Sin hito" })).toBeNull();
    expect(section).toHaveTextContent("Sin próxima acción");
  });

  test("marking another one moves the mark at once; the server confirms", async () => {
    const user = userEvent.setup();
    let answer: (value: Awaited<ReturnType<typeof setNextAction>>) => void = () => {};
    vi.mocked(setNextAction).mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    renderSection();
    const sand = screen.getByRole("button", { name: "Próxima acción: lijar" });
    await user.click(sand);
    expect(sand).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Próxima acción: medir paredes" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(setNextAction).toHaveBeenCalledWith({ id: SAND.id, next: true });
    await act(async () => answer(ok({ ...SAND, isNextAction: true })));
    await waitFor(() =>
      expect(screen.getByText("«lijar» es la próxima acción.")).toBeInTheDocument(),
    );
  });

  test("a refused mark rolls back with Sin guardar and the reason", async () => {
    const user = userEvent.setup();
    vi.mocked(setNextAction).mockResolvedValue(
      fail("Una tarea hecha no puede ser la próxima acción."),
    );
    renderSection();
    await user.click(screen.getByRole("button", { name: "Próxima acción: lijar" }));
    const notices = screen.getByRole("region", { name: "Avisos" });
    await waitFor(() =>
      expect(notices).toHaveTextContent(
        "No se pudo cambiar la próxima acción; volvió a como estaba. Una tarea hecha no puede ser la próxima acción.",
      ),
    );
    // The notice can render before the optimistic value rolls back.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Próxima acción: lijar" })).toHaveAttribute(
        "aria-pressed",
        "false",
      ),
    );
    expect(screen.getByRole("button", { name: "Próxima acción: medir paredes" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("Enter adds to the project (and the chosen milestone), and the field is ready for another", async () => {
    const user = userEvent.setup();
    vi.mocked(createTask).mockResolvedValue(ok(task({ title: "comprar pintura" })));
    renderSection();
    await user.selectOptions(screen.getByRole("combobox", { name: "Hito" }), "Pintura");
    const field = screen.getByRole("textbox", { name: "Nueva tarea" });
    await user.type(field, "comprar pintura{Enter}");
    expect(field).toHaveValue("");
    expect(field).toHaveFocus();
    expect(createTask).toHaveBeenCalledWith({
      title: "comprar pintura",
      projectId: PROJECT.id,
      milestoneId: PAINT.id,
      dueDate: null,
      lifeAreaId: null,
      priority: "medium",
    });
    await waitFor(() =>
      expect(screen.getByText("Tarea «comprar pintura» agregada a «Pintura».")).toBeInTheDocument(),
    );
    // The milestone stays for the next one.
    expect(screen.getByRole("combobox", { name: "Hito" })).toHaveValue(PAINT.id);
  });

  test("an empty title says why; a failed add puts the text back with the reason", async () => {
    const user = userEvent.setup();
    vi.mocked(createTask).mockResolvedValue(
      fail("Ese proyecto ya no está disponible (se terminó, se canceló o se eliminó). Elige otro."),
    );
    renderSection();
    const field = screen.getByRole("textbox", { name: "Nueva tarea" });
    await user.type(field, "{Enter}");
    expect(field).toHaveAccessibleDescription(/Escribe qué hay que hacer\./);
    expect(createTask).not.toHaveBeenCalled();
    await user.type(field, "x{Enter}");
    await waitFor(() => expect(field).toHaveValue("x"));
    expect(screen.getByRole("region", { name: "Avisos" })).toHaveTextContent(
      "No se pudo agregar la tarea.",
    );
  });

  test("completing the next action: gone at once; Deshacer reopens and re-marks it in one call", async () => {
    const user = userEvent.setup();
    // The server answers when the test says (in the app, its answer revalidates the page).
    let completed: (value: Awaited<ReturnType<typeof completeTaskWithNext>>) => void = () => {};
    vi.mocked(completeTaskWithNext).mockImplementation(
      () => new Promise((resolve) => (completed = resolve)),
    );
    vi.mocked(undoCompleteNextAction).mockResolvedValue(
      ok({ task: MEASURE, mark: "restored", spawn: null, restored: true, warning: null }),
    );
    renderSection();
    await user.click(screen.getByRole("checkbox", { name: "Hecha: medir paredes" }));
    expect(screen.queryByRole("link", { name: "medir paredes" })).toBeNull();
    // Focus goes to the next row's checkbox, never to <body>.
    expect(screen.getByRole("checkbox", { name: "Hecha: dibujar planta" })).toHaveFocus();
    expect(completeTaskWithNext).toHaveBeenCalledWith({ id: MEASURE.id });
    await act(async () =>
      completed(
        ok({ task: { ...MEASURE, doneAt: NOW, isNextAction: false }, next: null, nextInbox: null }),
      ),
    );
    const notices = screen.getByRole("region", { name: "Avisos" });
    await waitFor(() => expect(notices).toHaveTextContent("«medir paredes» está hecha."));
    await user.click(within(notices).getByRole("button", { name: "Deshacer" }));
    await waitFor(() => expect(undoCompleteNextAction).toHaveBeenCalledWith({ id: MEASURE.id }));
    // One atomic call: no plain reopen and no separate mark.
    expect(reopenTaskWithSpawn).not.toHaveBeenCalled();
    expect(setNextAction).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "medir paredes" })).toBeInTheDocument();
  });

  test("an undo that reopens but can't re-mark says so with Sin guardar", async () => {
    const user = userEvent.setup();
    vi.mocked(completeTaskWithNext).mockResolvedValue(
      ok({ task: { ...MEASURE, doneAt: NOW }, next: null, nextInbox: null }),
    );
    vi.mocked(undoCompleteNextAction).mockResolvedValue(
      ok({
        task: MEASURE,
        mark: "projectClosed",
        spawn: null,
        restored: false,
        warning: "Volvió a estar pendiente, pero no se pudo volver a marcar como próxima acción.",
      }),
    );
    renderSection();
    const notices = screen.getByRole("region", { name: "Avisos" });
    await user.click(screen.getByRole("checkbox", { name: "Hecha: medir paredes" }));
    await waitFor(() => expect(notices).toHaveTextContent("«medir paredes» está hecha."));
    await user.click(within(notices).getByRole("button", { name: "Deshacer" }));
    await waitFor(() =>
      expect(notices).toHaveTextContent(
        "«medir paredes»: Volvió a estar pendiente, pero no se pudo volver a marcar como próxima acción.",
      ),
    );
    expect(notices).toHaveTextContent("Sin guardar");
  });

  test("a task that wasn't the next action: Deshacer is the plain reopen", async () => {
    const user = userEvent.setup();
    vi.mocked(reopenTaskWithSpawn).mockResolvedValue(ok({ task: DRAW, spawn: null }));
    renderSection();
    const notices = screen.getByRole("region", { name: "Avisos" });
    vi.mocked(completeTaskWithNext).mockResolvedValue(
      ok({ task: { ...DRAW, doneAt: NOW }, next: null, nextInbox: null }),
    );
    await user.click(screen.getByRole("checkbox", { name: "Hecha: dibujar planta" }));
    await waitFor(() => expect(notices).toHaveTextContent("«dibujar planta» está hecha."));
    await user.click(within(notices).getByRole("button", { name: "Deshacer" }));
    await waitFor(() => expect(reopenTaskWithSpawn).toHaveBeenCalledWith({ id: DRAW.id }));
    expect(undoCompleteNextAction).not.toHaveBeenCalled();
  });

  test("a closed project: no adding, no marks, and it says why", () => {
    renderSection({ open: false });
    expect(screen.queryByRole("textbox", { name: "Nueva tarea" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Próxima acción:/ })).toBeNull();
    expect(screen.getByText(/El proyecto está cerrado/)).toBeInTheDocument();
    // Completing still works.
    expect(screen.getByRole("checkbox", { name: "Hecha: lijar" })).toBeInTheDocument();
  });

  test("the done ones unfold and can be reopened", async () => {
    const user = userEvent.setup();
    vi.mocked(reopenTaskWithSpawn).mockResolvedValue(
      ok({ task: { ...DONE, doneAt: null }, spawn: null }),
    );
    renderSection();
    await user.click(screen.getByRole("button", { name: "Hechas en los últimos 30 días, 1" }));
    const list = screen.getByRole("list", { name: "Tareas hechas del proyecto" });
    expect(within(list).getByRole("checkbox", { name: "Hecha: comprar cinta" })).toBeChecked();
    await user.click(
      within(list).getByRole("button", { name: "Deshacer «comprar cinta» (vuelve a pendientes)" }),
    );
    expect(reopenTaskWithSpawn).toHaveBeenCalledWith({ id: DONE.id });
  });
});

describe("the detail's Próxima acción", () => {
  function renderDetail(value: TaskItem) {
    return render(
      <TasksScreen now={NOW} targets={TARGETS}>
        <TaskDetailProvider task={value} host="page" onDeleted={vi.fn()}>
          <TaskNextActionSection />
        </TaskDetailProvider>
      </TasksScreen>,
    );
  }

  test("a switch that marks it, at once, and says so", async () => {
    const user = userEvent.setup();
    vi.mocked(setNextAction).mockResolvedValue(ok({ ...DRAW, isNextAction: true }));
    renderDetail(DRAW);
    const toggle = screen.getByRole("switch", { name: "Es la próxima acción de «Cocina»" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(setNextAction).toHaveBeenCalledWith({ id: DRAW.id, next: true });
    await waitFor(() =>
      expect(screen.getByText("«dibujar planta» es la próxima acción.")).toBeInTheDocument(),
    );
  });

  test("not for a task without a project; a done task or a closed project says why", () => {
    const { unmount } = renderDetail(task({ projectId: null, project: null }));
    expect(screen.queryByRole("heading", { name: "Próxima acción" })).toBeNull();
    unmount();
    const second = renderDetail(task({ doneAt: NOW }));
    expect(screen.getByText("Una tarea hecha no puede ser la próxima acción.")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).toBeNull();
    second.unmount();
    renderDetail(task({ project: { ...PROJECT, status: "done" } }));
    expect(screen.getByText(/El proyecto está cerrado/)).toBeInTheDocument();
  });
});

describe("the card's Siguiente tarea", () => {
  const SUMMARY: ProjectSummary = {
    id: PROJECT.id,
    name: PROJECT.name,
    objective: null,
    status: "active",
    priority: "medium",
    startDate: null,
    dueDate: null,
    completedAt: null,
    area: HOME,
  } as ProjectSummary;

  function renderCard(complete = vi.fn(), undoComplete = vi.fn()) {
    render(
      <ScreenServicesProvider label="Avisos" actionHint="Para deshacer…">
        <ProjectCard
          project={SUMMARY}
          due={null}
          nextAction={{
            title: "medir paredes",
            key: (
              <NextActionKey
                projectName="Cocina"
                action={{ id: MEASURE.id, title: "medir paredes" }}
                complete={complete}
                undoComplete={undoComplete}
              />
            ),
          }}
        />
      </ScreenServicesProvider>,
    );
    return { complete, undoComplete };
  }

  test("the key, and the name link says it", () => {
    renderCard();
    const card = screen.getByRole("article");
    expect(card).toHaveTextContent("Siguiente tarea");
    expect(screen.getByRole("link", { name: "Cocina" })).toHaveAccessibleDescription(
      "Siguiente tarea: medir paredes",
    );
    expect(
      screen.getByRole("checkbox", { name: "Hecha: medir paredes" }),
    ).toHaveAccessibleDescription("Siguiente tarea de Cocina");
  });

  test("the check completes it at once, focus to the card's name; Deshacer undoes it", async () => {
    const user = userEvent.setup();
    type Answer = ActionResult<unknown>;
    let completed: (value: Answer) => void = () => {};
    const { complete, undoComplete } = renderCard(
      vi.fn(() => new Promise<Answer>((resolve) => (completed = resolve))),
      vi.fn(async () => ok({ restored: true, warning: null })),
    );
    await user.click(screen.getByRole("checkbox", { name: "Hecha: medir paredes" }));
    expect(complete).toHaveBeenCalledWith({ id: MEASURE.id });
    expect(screen.queryByRole("checkbox", { name: "Hecha: medir paredes" })).toBeNull();
    expect(screen.getByRole("link", { name: "Cocina" })).toHaveFocus();
    await act(async () => completed(ok(null)));
    const notices = screen.getByRole("region", { name: "Avisos" });
    await waitFor(() => expect(notices).toHaveTextContent("«medir paredes» está hecha."));
    await user.click(within(notices).getByRole("button", { name: "Deshacer" }));
    await waitFor(() => expect(undoComplete).toHaveBeenCalledWith({ id: MEASURE.id }));
    await waitFor(() =>
      expect(
        screen.getByText("«medir paredes» volvió a ser la siguiente tarea."),
      ).toBeInTheDocument(),
    );
  });

  test("Deshacer when another task took the mark: only pending again; a refused re-mark warns", async () => {
    const user = userEvent.setup();
    const undoComplete = vi
      .fn()
      .mockResolvedValueOnce(ok({ restored: false, warning: null }))
      .mockResolvedValueOnce(ok({ restored: false, warning: "No se pudo volver a marcar." }));
    renderCard(
      vi.fn(async () => ok(null)),
      undoComplete,
    );
    const notices = screen.getByRole("region", { name: "Avisos" });
    await user.click(screen.getByRole("checkbox", { name: "Hecha: medir paredes" }));
    await waitFor(() => expect(notices).toHaveTextContent("«medir paredes» está hecha."));
    await user.click(within(notices).getByRole("button", { name: "Deshacer" }));
    await waitFor(() =>
      expect(screen.getByText("«medir paredes» volvió a estar pendiente.")).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("checkbox", { name: "Hecha: medir paredes" }));
    await waitFor(() => expect(notices).toHaveTextContent("«medir paredes» está hecha."));
    await user.click(within(notices).getByRole("button", { name: "Deshacer" }));
    await waitFor(() =>
      expect(notices).toHaveTextContent("«medir paredes»: No se pudo volver a marcar."),
    );
  });

  test("a refusal brings it back with Sin guardar", async () => {
    const user = userEvent.setup();
    renderCard(vi.fn(async () => fail("Esta tarea ya no existe (se eliminó).")));
    await user.click(screen.getByRole("checkbox", { name: "Hecha: medir paredes" }));
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "Avisos" })).toHaveTextContent(
        "No se pudo marcar la tarea; volvió a como estaba. Esta tarea ya no existe (se eliminó).",
      ),
    );
    // The notice can render before the optimistic value rolls back.
    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: "Hecha: medir paredes" })).toBeInTheDocument(),
    );
  });
});
