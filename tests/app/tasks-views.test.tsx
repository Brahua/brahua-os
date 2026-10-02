// T2: the views of /tasks (Hoy, Próximas, Todas with its filters, Hechas with "Deshacer") and
// the detail additions (Notas, Hito), against mocked actions.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import TaskPage from "@/app/(app)/tasks/[id]/page";
import { DoneView } from "@/app/(app)/tasks/_components/date-views";
import TasksPage from "@/app/(app)/tasks/page";
import { fail, ok } from "@/lib/action-result";
import { requireOwner } from "@/lib/auth";
import { completeTask, deleteTask, reopenTask } from "@/modules/tasks/actions";
import { TaskDetailSheet } from "@/modules/tasks/components/detail/task-detail-sheet";
import { TasksScreen } from "@/modules/tasks/components/tasks-screen";
import {
  listTaskMilestones,
  readTaskNotes,
  setTaskMilestone,
  updateTaskNotes,
} from "@/modules/tasks/detail-actions";
import { getTask, getTaskTargets } from "@/modules/tasks/queries";
import type { TaskItem, TaskTargets } from "@/modules/tasks/task-input";
import {
  getTaskNotes,
  listDoneTasks,
  listPendingTasks,
  listTodayTasks,
  listUpcomingTasks,
} from "@/modules/tasks/view-queries";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("@/lib/auth", () => ({ requireOwner: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/modules/tasks/queries", () => ({
  listInboxTasks: vi.fn(async () => []),
  getTask: vi.fn(),
  getDeletedTask: vi.fn(async () => null),
  getTaskTargets: vi.fn(),
}));
vi.mock("@/modules/tasks/view-queries", () => ({
  listTodayTasks: vi.fn(),
  listUpcomingTasks: vi.fn(),
  listPendingTasks: vi.fn(),
  listDoneTasks: vi.fn(),
  getTaskNotes: vi.fn(),
}));
vi.mock("@/modules/tasks/detail-actions", () => ({
  readTaskNotes: vi.fn(),
  updateTaskNotes: vi.fn(),
  listTaskMilestones: vi.fn(),
  setTaskMilestone: vi.fn(),
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
// T3: the list completes and reopens through the recurrence variants; here they answer like the
// plain actions above (no next occurrence), so these tests drive `completeTask` / `reopenTask`.
vi.mock("@/modules/tasks/recurrence-actions", async () => {
  const actions = await import("@/modules/tasks/actions");
  return {
    setTaskRecurrence: vi.fn(),
    completeTaskWithNext: vi.fn(async (input: { id: string }) => {
      const result = await actions.completeTask(input);
      return result.ok ? { ok: true, data: { task: result.data, next: null } } : result;
    }),
    reopenTaskWithSpawn: vi.fn(async (input: { id: string }) => {
      const result = await actions.reopenTask(input);
      return result.ok ? { ok: true, data: { task: result.data, spawn: null } } : result;
    }),
  };
});
// 10:00 in Lima on Friday, Oct 2, 2026.
const NOW = new Date("2026-10-02T15:00:00.000Z");

const HOME = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "home",
  name: "Hogar",
  icon: "house",
  color: "home",
} as const;
const WORK = {
  id: "22222222-2222-4222-8222-222222222222",
  slug: "work",
  name: "Trabajo",
  icon: "briefcase",
  color: "work",
} as const;
const KITCHEN = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "Cocina",
  status: "active",
} as const;
const TARGETS: TaskTargets = {
  areas: [HOME, WORK],
  projects: [{ ...KITCHEN, area: HOME }],
};
const PLANS = "44444444-4444-4444-8444-444444444444";
const PAINT = "55555555-5555-4555-8555-555555555555";

let serial = 0;
function task(values: Partial<TaskItem>): TaskItem {
  serial += 1;
  return {
    id: `00000000-0000-4000-8000-${String(serial).padStart(12, "0")}`,
    title: `Tarea ${serial}`,
    priority: "medium",
    dueDate: null,
    doneAt: null,
    createdAt: NOW,
    lifeAreaId: null,
    projectId: null,
    milestoneId: null,
    isNextAction: false,
    area: null,
    project: null,
    recurrence: null,
    tags: [],
    ...values,
  };
}

const LATE = task({ title: "pagar luz", dueDate: "2026-09-28", lifeAreaId: HOME.id, area: HOME });
const TODAY = task({ title: "regar plantas", dueDate: "2026-10-02", priority: "high" });
const TOMORROW_A = task({ title: "comprar pan", dueDate: "2026-10-03" });
const TOMORROW_B = task({ title: "llamar a mamá", dueDate: "2026-10-03" });
const THURSDAY = task({ title: "reunión", dueDate: "2026-10-08", lifeAreaId: WORK.id, area: WORK });
const IN_KITCHEN = task({
  title: "medir muebles",
  projectId: KITCHEN.id,
  project: KITCHEN,
  area: HOME,
  milestoneId: PLANS,
});
const DONE_TODAY = task({ title: "lavar ropa", doneAt: new Date("2026-10-02T13:00:00Z") });
const DONE_BEFORE = task({ title: "sacar basura", doneAt: new Date("2026-09-28T13:00:00Z") });

let desktop = false;
beforeEach(() => {
  desktop = false;
  window.matchMedia = vi.fn((query: string) => ({
    matches: desktop,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  vi.mocked(requireOwner)
    .mockReset()
    .mockResolvedValue({ user: { id: "owner" } } as never);
  vi.mocked(getTaskTargets).mockReset().mockResolvedValue(TARGETS);
  vi.mocked(listTodayTasks).mockReset().mockResolvedValue([LATE, TODAY]);
  vi.mocked(listUpcomingTasks).mockReset().mockResolvedValue([TOMORROW_A, TOMORROW_B, THURSDAY]);
  vi.mocked(listPendingTasks)
    .mockReset()
    .mockResolvedValue([LATE, TODAY, TOMORROW_A, THURSDAY, IN_KITCHEN]);
  vi.mocked(listDoneTasks).mockReset().mockResolvedValue([DONE_TODAY, DONE_BEFORE]);
  vi.mocked(getTaskNotes).mockReset().mockResolvedValue(null);
  vi.mocked(readTaskNotes)
    .mockReset()
    .mockResolvedValue(ok({ notes: null }));
  vi.mocked(updateTaskNotes).mockReset();
  vi.mocked(listTaskMilestones)
    .mockReset()
    .mockResolvedValue(
      ok([
        { id: PLANS, title: "Planos", done: true },
        { id: PAINT, title: "Pintura", done: false },
      ]),
    );
  vi.mocked(setTaskMilestone).mockReset();
  vi.mocked(completeTask).mockReset();
  vi.mocked(reopenTask).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

const page = async (search: Record<string, string>) =>
  render(await TasksPage({ searchParams: Promise.resolve(search) }));
const titlesIn = (list: HTMLElement) =>
  within(list)
    .getAllByRole("link")
    .map((link) => link.textContent);

describe("views", () => {
  test("Hoy: its tasks in the server's order, a count in the heading, labels", async () => {
    await page({ vista: "hoy" });
    expect(listTodayTasks).toHaveBeenCalledWith(expect.any(Date));
    expect(screen.getByRole("heading", { level: 2, name: "Hoy: 2 tareas" })).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Tareas de hoy" });
    expect(titlesIn(list)).toEqual(["pagar luz", "regar plantas"]);
    expect(screen.getByRole("link", { name: "pagar luz" })).toHaveAccessibleDescription(
      "Hogar, Retrasada hace 4 días",
    );
  });

  test("each view has its empty state", async () => {
    vi.mocked(listTodayTasks).mockResolvedValue([]);
    vi.mocked(listUpcomingTasks).mockResolvedValue([]);
    vi.mocked(listPendingTasks).mockResolvedValue([]);
    vi.mocked(listDoneTasks).mockResolvedValue([]);
    for (const [vista, heading] of [
      ["hoy", "Nada para hoy"],
      ["proximas", "Semana despejada"],
      ["todas", "Sin tareas pendientes"],
      ["hechas", "Nada hecho todavía"],
    ]) {
      const { unmount } = await page({ vista });
      expect(screen.getByRole("heading", { level: 3, name: heading })).toBeInTheDocument();
      // No count when there is nothing.
      expect(screen.getByRole("heading", { level: 2 }).textContent).not.toMatch(/\d/);
      unmount();
    }
  });

  test("Próximas: grouped by day under h3 headings (Mañana, then the date)", async () => {
    await page({ vista: "proximas" });
    const groups = screen.getAllByRole("heading", { level: 3 }).map((item) => item.textContent);
    expect(groups).toEqual(["Mañana", "Jueves 8 de octubre"]);
    expect(titlesIn(screen.getByRole("list", { name: "Mañana" }))).toEqual([
      "comprar pan",
      "llamar a mamá",
    ]);
    expect(titlesIn(screen.getByRole("list", { name: "Jueves 8 de octubre" }))).toEqual([
      "reunión",
    ]);
  });

  test("Todas: all pending; the filters are keys whose options are links in the URL", async () => {
    const user = userEvent.setup();
    await page({ vista: "todas" });
    expect(titlesIn(screen.getByRole("list", { name: "Tareas pendientes" }))).toHaveLength(5);
    const filters = within(screen.getByRole("group", { name: "Filtros" }));
    await user.click(filters.getByRole("button", { name: "Filtrar por área: Todas" }));
    const sheet = await screen.findByRole("dialog", { name: "Filtrar por área" });
    const options = within(within(sheet).getByRole("list", { name: "Áreas" })).getAllByRole("link");
    expect(options.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Todas las áreas", "/tasks?vista=todas"],
      ["Hogar", "/tasks?vista=todas&area=home"],
      ["Trabajo", "/tasks?vista=todas&area=work"],
    ]);
    expect(options[0]).toHaveAttribute("aria-current", "page");
  });

  test("Todas filtered by area and project: only those, the keys say so", async () => {
    const user = userEvent.setup();
    await page({ vista: "todas", area: "home" });
    expect(titlesIn(screen.getByRole("list", { name: "Tareas pendientes" }))).toEqual([
      "pagar luz",
      "medir muebles",
    ]);
    const filters = within(screen.getByRole("group", { name: "Filtros" }));
    await user.click(filters.getByRole("button", { name: "Filtrar por proyecto: Todos" }));
    const sheet = await screen.findByRole("dialog", { name: "Filtrar por proyecto" });
    expect(
      within(sheet)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual([
      "/tasks?vista=todas&area=home",
      `/tasks?vista=todas&area=home&proyecto=${KITCHEN.id}`,
    ]);
  });

  test("Todas: a project of another area doesn't apply", async () => {
    await page({ vista: "todas", area: "work", proyecto: KITCHEN.id });
    // Cocina is in Hogar: with Trabajo chosen the project filter doesn't apply.
    expect(screen.getByRole("button", { name: "Filtrar por proyecto: Todos" })).toBeInTheDocument();
    expect(titlesIn(screen.getByRole("list", { name: "Tareas pendientes" }))).toEqual(["reunión"]);
  });

  test("Todas with filters that match nothing: its own empty state with Quitar filtros", async () => {
    vi.mocked(listPendingTasks).mockResolvedValue([LATE]);
    await page({ vista: "todas", area: "work" });
    expect(
      screen.getByRole("heading", { level: 3, name: "Nada con estos filtros" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Quitar filtros" })).toHaveAttribute(
      "href",
      "/tasks?vista=todas",
    );
  });

  test("Hechas: done ones, checked, with when; Deshacer reopens and the notice undoes it", async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    let reopened: (value: Awaited<ReturnType<typeof reopenTask>>) => void = () => {};
    vi.mocked(reopenTask).mockImplementation(() => new Promise((resolve) => (reopened = resolve)));
    vi.mocked(completeTask).mockResolvedValue(ok(DONE_TODAY));
    render(
      <TasksScreen now={NOW} targets={TARGETS}>
        <h2 id="view" tabIndex={-1}>
          Hechas
        </h2>
        <DoneView tasks={[DONE_TODAY, DONE_BEFORE]} headingId="done-view" />
      </TasksScreen>,
    );
    const list = screen.getByRole("list", { name: "Tareas hechas" });
    expect(within(list).getByRole("checkbox", { name: "Hecha: lavar ropa" })).toBeChecked();
    expect(screen.getByRole("link", { name: "sacar basura" })).toHaveAccessibleDescription(
      "Hecha el 28 set. 2026",
    );
    await user.click(
      screen.getByRole("button", { name: "Deshacer «lavar ropa» (vuelve a pendientes)" }),
    );
    // Gone at once; focus goes to the same control of the next row (its "Deshacer").
    expect(screen.queryByRole("link", { name: "lavar ropa" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Deshacer «sacar basura» (vuelve a pendientes)" }),
    ).toHaveFocus();
    expect(reopenTask).toHaveBeenCalledWith({ id: DONE_TODAY.id });
    await act(async () => reopened(ok({ ...DONE_TODAY, doneAt: null })));
    const notices = screen.getByRole("region", { name: "Avisos" });
    expect(within(notices).getByText("«lavar ropa» volvió a estar pendiente.")).toBeInTheDocument();
    await user.click(within(notices).getByRole("button", { name: "Deshacer" }));
    await waitFor(() => expect(completeTask).toHaveBeenCalledWith({ id: DONE_TODAY.id }));
    expect(screen.getByRole("link", { name: "lavar ropa" })).toBeInTheDocument();
  });

  test("Hechas: unchecking a row reopens it too; a refusal puts it back with Sin guardar", async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    vi.mocked(reopenTask).mockResolvedValue(fail("Esta tarea ya no existe (se eliminó)."));
    render(
      <TasksScreen now={NOW} targets={TARGETS}>
        <DoneView tasks={[DONE_TODAY]} headingId="done-view" />
      </TasksScreen>,
    );
    await user.click(screen.getByRole("checkbox", { name: "Hecha: lavar ropa" }));
    await waitFor(() =>
      expect(
        within(screen.getByRole("region", { name: "Avisos" })).getByText(
          /No se pudo marcar la tarea.*ya no existe/,
        ),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("link", { name: "lavar ropa" })).toBeInTheDocument();
  });
});

describe("detail: Notas", () => {
  test("on the page: rendered from the server; write, preview, save (Markdown)", async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    vi.mocked(getTask).mockResolvedValue(TODAY);
    vi.mocked(getTaskNotes).mockResolvedValue("Comprar **abono**.");
    vi.mocked(updateTaskNotes).mockResolvedValue(ok({ notes: "# Riego\n\nCada *tres* días." }));
    render(await TaskPage({ params: Promise.resolve({ id: TODAY.id }) }));
    const section = screen.getByRole("region", { name: "Notas" });
    expect(within(section).getByText("abono").tagName).toBe("STRONG");
    await user.click(within(section).getByRole("button", { name: "Editar notas" }));
    const text = within(section).getByRole("textbox", { name: "Notas en Markdown" });
    expect(text).toHaveValue("Comprar **abono**.");
    await user.clear(text);
    await user.type(text, "# Riego{enter}{enter}Cada *tres* días.");
    await user.click(within(section).getByRole("tab", { name: "Vista previa" }));
    // `#` is an h3 under the page's h2 "Notas".
    expect(
      await within(section).findByRole("heading", { level: 3, name: "Riego" }),
    ).toBeInTheDocument();
    await user.click(within(section).getByRole("button", { name: "Guardar" }));
    expect(updateTaskNotes).toHaveBeenCalledWith({
      id: TODAY.id,
      notes: "# Riego\n\nCada *tres* días.",
    });
    expect((await within(section).findByText("tres")).tagName).toBe("EM");
    expect(within(section).getByRole("button", { name: "Editar notas" })).toHaveFocus();
  });

  test("bidi controls and the 20 000 limit are refused before sending", async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    vi.mocked(getTask).mockResolvedValue(TODAY);
    render(await TaskPage({ params: Promise.resolve({ id: TODAY.id }) }));
    const section = screen.getByRole("region", { name: "Notas" });
    await user.click(within(section).getByRole("button", { name: "Escribir notas" }));
    const text = within(section).getByRole("textbox", { name: "Notas en Markdown" });
    await user.type(text, "abc‮def");
    await user.click(within(section).getByRole("button", { name: "Guardar" }));
    expect(updateTaskNotes).not.toHaveBeenCalled();
    expect(text).toHaveAccessibleDescription(/marcas bidireccionales/);
  });

  test("in the sheet: read when it opens; a failed save keeps the draft and says why inside", async () => {
    vi.useRealTimers();
    desktop = true;
    const user = userEvent.setup();
    vi.mocked(readTaskNotes).mockResolvedValue(ok({ notes: "Vieja" }));
    vi.mocked(updateTaskNotes).mockResolvedValue(fail("No se pudo guardar."));
    render(
      <TasksScreen now={NOW} targets={TARGETS}>
        <TaskDetailSheet
          open
          onOpenChange={() => {}}
          task={TODAY}
          returnFocusRef={{ current: null }}
          onDeleted={() => {}}
        />
      </TasksScreen>,
    );
    const dialog = await screen.findByRole("dialog", { name: "regar plantas" });
    const section = within(dialog).getByRole("region", { name: "Notas" });
    // h3 in the sheet.
    expect(within(section).getByRole("heading", { level: 3, name: "Notas" })).toBeInTheDocument();
    expect(await within(section).findByText("Vieja")).toBeInTheDocument();
    expect(readTaskNotes).toHaveBeenCalledWith({ id: TODAY.id });
    await user.click(within(section).getByRole("button", { name: "Editar notas" }));
    await user.type(
      within(section).getByRole("textbox", { name: "Notas en Markdown" }),
      " y nueva",
    );
    await user.click(within(section).getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(within(dialog).getByRole("alert")).toHaveTextContent(
        /No se pudieron guardar las notas.*Tu texto sigue en «Editar notas»/,
      ),
    );
    expect(within(section).getByText("Vieja")).toBeInTheDocument();
    expect(within(section).getByText(/borrador sin guardar/)).toBeInTheDocument();
  });

  test("in the sheet: closing with unsaved notes asks first; Seguir editando keeps it open", async () => {
    vi.useRealTimers();
    desktop = true;
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <TasksScreen now={NOW} targets={TARGETS}>
        <TaskDetailSheet
          open
          onOpenChange={onOpenChange}
          task={TODAY}
          returnFocusRef={{ current: null }}
          onDeleted={() => {}}
        />
      </TasksScreen>,
    );
    const dialog = await screen.findByRole("dialog", { name: "regar plantas" });
    const section = within(dialog).getByRole("region", { name: "Notas" });
    await user.click(await within(section).findByRole("button", { name: "Escribir notas" }));
    await user.type(within(section).getByRole("textbox", { name: "Notas en Markdown" }), "algo");
    await user.click(within(dialog).getByRole("button", { name: /Cerrar/ }));
    expect(onOpenChange).not.toHaveBeenCalled();
    const confirm = within(dialog).getByRole("group", {
      name: "Tienes cambios sin guardar en las notas.",
    });
    expect(within(confirm).getByRole("button", { name: "Seguir editando" })).toHaveFocus();
    await user.click(within(confirm).getByRole("button", { name: "Salir sin guardar" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    // Positive control: without a draft, closing closes at once.
    onOpenChange.mockClear();
    await user.click(within(dialog).getByRole("button", { name: /Cerrar/ }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("detail: Notas, leaving the sheet", () => {
  function renderSheet(onOpenChange = vi.fn(), onDeleted = vi.fn()) {
    desktop = true;
    render(
      <TasksScreen now={NOW} targets={TARGETS}>
        <TaskDetailSheet
          open
          onOpenChange={onOpenChange}
          task={TODAY}
          returnFocusRef={{ current: null }}
          onDeleted={onDeleted}
        />
      </TasksScreen>,
    );
    return { onOpenChange, onDeleted };
  }

  async function startDraft(user: ReturnType<typeof userEvent.setup>) {
    const dialog = await screen.findByRole("dialog", { name: "regar plantas" });
    const section = within(dialog).getByRole("region", { name: "Notas" });
    await user.click(await within(section).findByRole("button", { name: "Escribir notas" }));
    await user.type(within(section).getByRole("textbox", { name: "Notas en Markdown" }), "algo");
    return { dialog, section };
  }

  test("Escape on the confirmation keeps the sheet open and the draft", async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    const { onOpenChange } = renderSheet();
    const { dialog, section } = await startDraft(user);
    await user.click(within(dialog).getByRole("button", { name: /Cerrar/ }));
    const confirm = within(dialog).getByRole("group", {
      name: "Tienes cambios sin guardar en las notas.",
    });
    expect(within(confirm).getByRole("button", { name: "Seguir editando" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "regar plantas" })).toBeInTheDocument();
    expect(within(section).getByRole("textbox", { name: "Notas en Markdown" })).toHaveValue("algo");
  });

  test("Eliminar tarea with unsaved notes asks first; Salir sin guardar then deletes", async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    vi.mocked(deleteTask)
      .mockReset()
      .mockResolvedValue(ok({ id: TODAY.id, title: TODAY.title }));
    const { onDeleted } = renderSheet();
    const { dialog } = await startDraft(user);
    await user.click(within(dialog).getByRole("button", { name: "Eliminar tarea" }));
    expect(deleteTask).not.toHaveBeenCalled();
    const confirm = within(dialog).getByRole("group", {
      name: "Tienes cambios sin guardar en las notas.",
    });
    await user.click(within(confirm).getByRole("button", { name: "Salir sin guardar" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(deleteTask).toHaveBeenCalledWith({ id: TODAY.id });
  });

  test("on the page, Eliminar tarea with unsaved notes asks first too", async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    vi.mocked(deleteTask)
      .mockReset()
      .mockResolvedValue(ok({ id: TODAY.id, title: TODAY.title }));
    vi.mocked(getTask).mockResolvedValue(TODAY);
    render(await TaskPage({ params: Promise.resolve({ id: TODAY.id }) }));
    const section = screen.getByRole("region", { name: "Notas" });
    await user.click(within(section).getByRole("button", { name: "Escribir notas" }));
    await user.type(within(section).getByRole("textbox", { name: "Notas en Markdown" }), "algo");
    await user.click(screen.getByRole("button", { name: "Eliminar tarea" }));
    expect(deleteTask).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Salir sin guardar" }));
    await waitFor(() => expect(deleteTask).toHaveBeenCalledWith({ id: TODAY.id }));
  });
});

describe("detail: Hito", () => {
  test("only with a project: its live milestones; picking one saves it", async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    vi.mocked(getTask).mockResolvedValue(IN_KITCHEN);
    vi.mocked(setTaskMilestone).mockResolvedValue(ok({ ...IN_KITCHEN, milestoneId: PAINT }));
    render(await TaskPage({ params: Promise.resolve({ id: IN_KITCHEN.id }) }));
    expect(listTaskMilestones).toHaveBeenCalledWith({ projectId: KITCHEN.id });
    const select = await screen.findByRole("combobox", { name: "Hito" });
    await waitFor(() =>
      expect(
        within(select)
          .getAllByRole("option")
          .map((option) => option.textContent),
      ).toEqual(["Sin hito", "Planos (hecho)", "Pintura"]),
    );
    expect(select).toHaveValue(PLANS);
    await user.selectOptions(select, PAINT);
    expect(setTaskMilestone).toHaveBeenCalledWith({ id: IN_KITCHEN.id, milestoneId: PAINT });
    await waitFor(() => expect(select).toHaveValue(PAINT));
  });

  test("a refusal (another project's milestone) rolls back with the reason", async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    vi.mocked(getTask).mockResolvedValue(IN_KITCHEN);
    vi.mocked(setTaskMilestone).mockResolvedValue({
      ok: false,
      error: "Revisa los campos marcados.",
      fieldErrors: { milestoneId: ["Ese hito no es de este proyecto o ya no existe."] },
    });
    render(await TaskPage({ params: Promise.resolve({ id: IN_KITCHEN.id }) }));
    const select = await screen.findByRole("combobox", { name: "Hito" });
    await waitFor(() => expect(within(select).getAllByRole("option")).toHaveLength(3));
    await user.selectOptions(select, "");
    expect(setTaskMilestone).toHaveBeenCalledWith({ id: IN_KITCHEN.id, milestoneId: null });
    await waitFor(() =>
      expect(
        within(screen.getByRole("region", { name: "Avisos" })).getByText(
          /No se pudo guardar el hito.*no es de este proyecto/,
        ),
      ).toBeInTheDocument(),
    );
    expect(select).toHaveValue(PLANS);
  });

  test("without a project there is no milestone field", async () => {
    vi.mocked(getTask).mockResolvedValue(TODAY);
    render(await TaskPage({ params: Promise.resolve({ id: TODAY.id }) }));
    expect(screen.queryByRole("combobox", { name: "Hito" })).toBeNull();
    expect(listTaskMilestones).not.toHaveBeenCalled();
  });
});
