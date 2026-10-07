// T1: /tasks (views as links, the inbox with its rows: complete and undo, classify, delete) and
// the detail (side sheet on the desktop, the task's page on the phone), against a fake server.
// The views of T2 are in tasks-views.test.tsx.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLayoutEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { InboxView } from "@/app/(app)/tasks/_components/inbox-view";
import TaskPage, { generateMetadata } from "@/app/(app)/tasks/[id]/page";
import TasksPage, { generateMetadata as viewMetadata } from "@/app/(app)/tasks/page";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { requireOwner } from "@/lib/auth";
import {
  completeTask,
  deleteTask,
  editTask,
  reopenTask,
  restoreTask,
} from "@/modules/tasks/actions";
import { TasksScreen } from "@/modules/tasks/components/tasks-screen";
import { getDeletedTask, getTask, getTaskTargets, listInboxTasks } from "@/modules/tasks/queries";
import type { TaskItem, TaskTargets } from "@/modules/tasks/task-input";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => router,
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("@/lib/auth", () => ({ requireOwner: vi.fn() }));
const cookieJar = vi.hoisted(() => ({ shortcuts: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "bo_shortcuts" && cookieJar.shortcuts ? { value: cookieJar.shortcuts } : undefined,
  }),
}));
vi.mock("@/modules/tasks/queries", () => ({
  listInboxTasks: vi.fn(),
  getTask: vi.fn(),
  getDeletedTask: vi.fn(),
  getTaskTargets: vi.fn(),
}));
vi.mock("@/modules/tasks/view-queries", () => ({
  listTodayTasks: vi.fn(async () => []),
  listUpcomingTasks: vi.fn(async () => []),
  listPendingTasks: vi.fn(async () => []),
  listDoneTasks: vi.fn(async () => []),
  getTaskNotes: vi.fn(async () => null),
}));
vi.mock("@/modules/tasks/detail-actions", () => ({
  readTaskNotes: vi.fn(async () => ({ ok: true, data: { notes: null } })),
  updateTaskNotes: vi.fn(),
  listTaskMilestones: vi.fn(async () => ({ ok: true, data: [] })),
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
// T3: the list completes and undoes through the recurrence variants; here they answer like the
// plain actions above (no next occurrence), so these tests drive `completeTask` / `reopenTask`.
vi.mock("@/modules/tasks/recurrence-actions", async () => {
  const actions = await import("@/modules/tasks/actions");
  return {
    setTaskRecurrence: vi.fn(),
    completeTaskWithNext: vi.fn(async (input: { id: string }) => {
      const result = await actions.completeTask(input);
      return result.ok
        ? { ok: true, data: { task: result.data, next: null, nextInbox: null } }
        : result;
    }),
    reopenTaskWithSpawn: vi.fn(async (input: { id: string }) => {
      const result = await actions.reopenTask(input);
      return result.ok ? { ok: true, data: { task: result.data, spawn: null } } : result;
    }),
    restoreTaskWithSpawn: vi.fn(async (input: { id: string }) => {
      const result = await actions.restoreTask(input);
      return result.ok ? { ok: true, data: { task: result.data, detached: false } } : result;
    }),
  };
});

// 10:00 in Lima on Oct 2, 2026.
const NOW = new Date("2026-10-02T15:00:00.000Z");

const HEALTH_ID = "11111111-1111-4111-8111-111111111111";
const HEALTH = {
  id: HEALTH_ID,
  slug: "health",
  name: "Salud",
  icon: "heart-pulse",
  color: "health",
} as const;
const TARGETS: TaskTargets = { areas: [HEALTH], projects: [] };

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

const PILAS = task({ title: "comprar pilas", dueDate: "2026-09-30" });
const PLANTAS = task({ title: "regar plantas", dueDate: "2026-10-02", priority: "high" });
const LIBRO = task({ title: "devolver libro" });
const INBOX = [PILAS, PLANTAS, LIBRO];

/**
 * A fake server: each action waits until the test answers it (in order), then applies the change
 * and re-renders the list with it, like the revalidation. Every call must settle before the test
 * ends (React entangles pending async transitions).
 */
const server = {
  tasks: INBOX,
  render: (() => {}) as (tasks: TaskItem[]) => void,
  pending: [] as { answer: (result?: ActionResult<unknown>) => void }[],
  async answer(result?: ActionResult<unknown>) {
    const call = server.pending.shift();
    if (!call) throw new Error("No pending call");
    await act(async () => call.answer(result));
  },
  async answerAll() {
    while (server.pending.length > 0) await server.answer();
  },
};

function serverCall<T>(
  apply: (tasks: TaskItem[]) => TaskItem[],
  value: () => T,
): Promise<ActionResult<T>> {
  return new Promise((resolve) => {
    server.pending.push({
      answer: (result) => {
        if (!result || result.ok) {
          server.tasks = apply(server.tasks);
          server.render(server.tasks);
        }
        resolve((result as ActionResult<T>) ?? ok(value()));
      },
    });
  });
}

const deleted = new Map<string, TaskItem>();
const isInbox = (item: TaskItem) => item.doneAt === null && !item.lifeAreaId && !item.projectId;

function Harness() {
  const [tasks, setTasks] = useState(server.tasks);
  useLayoutEffect(() => {
    server.render = (next) => setTasks(next.filter(isInbox));
  }, []);
  return (
    <TasksScreen now={NOW} targets={TARGETS}>
      <InboxView tasks={tasks} shortcuts headingId="view" />
    </TasksScreen>
  );
}

let desktop = false;
beforeEach(() => {
  desktop = false;
  window.matchMedia = vi.fn((query: string) => ({
    matches: desktop,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  server.tasks = INBOX;
  server.pending = [];
  deleted.clear();
  router.push.mockReset();
  router.replace.mockReset();
  vi.mocked(requireOwner)
    .mockReset()
    .mockResolvedValue({ user: { id: "owner" } } as never);
  vi.mocked(listInboxTasks).mockReset().mockResolvedValue(INBOX);
  vi.mocked(getTaskTargets).mockReset().mockResolvedValue(TARGETS);
  vi.mocked(getDeletedTask).mockReset().mockResolvedValue(null);
  vi.mocked(getTask).mockReset();
  const byId = (id: string) => server.tasks.find((item) => item.id === id)!;
  vi.mocked(completeTask)
    .mockReset()
    .mockImplementation(async (input) => {
      const { id } = input as { id: string };
      return serverCall(
        (tasks) => tasks.map((item) => (item.id === id ? { ...item, doneAt: NOW } : item)),
        () => byId(id),
      );
    });
  vi.mocked(reopenTask)
    .mockReset()
    .mockImplementation(async (input) => {
      const { id } = input as { id: string };
      return serverCall(
        (tasks) => tasks.map((item) => (item.id === id ? { ...item, doneAt: null } : item)),
        () => byId(id),
      );
    });
  vi.mocked(editTask)
    .mockReset()
    .mockImplementation(async (input) => {
      const { id, placement, dueDate, priority, title } = input as {
        id: string;
        placement?: { lifeAreaId: string | null };
        dueDate?: string | null;
        priority?: TaskItem["priority"];
        title?: string;
      };
      const change = (item: TaskItem): TaskItem => ({
        ...item,
        ...(placement
          ? { lifeAreaId: placement.lifeAreaId, area: placement.lifeAreaId ? HEALTH : null }
          : {}),
        ...(dueDate !== undefined ? { dueDate } : {}),
        ...(priority ? { priority } : {}),
        ...(title ? { title } : {}),
      });
      return serverCall(
        (tasks) => tasks.map((item) => (item.id === id ? change(item) : item)),
        () => byId(id),
      );
    });
  vi.mocked(deleteTask)
    .mockReset()
    .mockImplementation(async (input) => {
      const { id } = input as { id: string };
      const found = byId(id);
      return serverCall(
        (tasks) => {
          deleted.set(id, found);
          return tasks.filter((item) => item.id !== id);
        },
        () => ({ id, title: found.title }),
      );
    });
  vi.mocked(restoreTask)
    .mockReset()
    .mockImplementation(async (input) => {
      const { id } = input as { id: string };
      return serverCall(
        (tasks) => [...tasks, deleted.get(id)!],
        () => deleted.get(id)!,
      );
    });
});

afterEach(async () => {
  await server.answerAll();
});

const row = (title: string) =>
  screen.getByRole("link", { name: title }).closest("li") as HTMLElement;
const titles = () =>
  within(screen.getByRole("list", { name: "Tareas en la bandeja" }))
    .getAllByRole("link")
    .map((link) => link.textContent);
const notices = () => screen.getByRole("region", { name: "Avisos" });

describe("/tasks", () => {
  test("title, owner check, the views as links with the current one marked", async () => {
    // Each view has its own title, so a view switch is announced.
    const title = async (search: Record<string, string>) =>
      (await viewMetadata({ searchParams: Promise.resolve(search) })).title;
    expect(await title({})).toBe("Bandeja · Tareas · brahua-os");
    expect(await title({ vista: "hoy" })).toBe("Hoy · Tareas · brahua-os");
    expect(await title({ vista: "proximas" })).toBe("Próximas · Tareas · brahua-os");
    expect(await title({ vista: "nada" })).toBe("Bandeja · Tareas · brahua-os");
    render(await TasksPage({ searchParams: Promise.resolve({}) }));
    expect(requireOwner).toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1, name: "Tareas" })).toBeInTheDocument();
    const views = within(screen.getByRole("navigation", { name: "Vistas de tareas" }));
    expect(
      views
        .getAllByRole("link")
        .map((link) => [
          link.getAttribute("aria-label") ?? link.textContent,
          link.getAttribute("href"),
        ]),
    ).toEqual([
      ["Bandeja", "/tasks"],
      ["Hoy", "/tasks?vista=hoy"],
      ["Próximas", "/tasks?vista=proximas"],
      ["Todas", "/tasks?vista=todas"],
      ["Hechas", "/tasks?vista=hechas"],
    ]);
    // The view's heading counts what it shows ("Bandeja 3", read "Bandeja: 3 tareas").
    expect(
      screen.getByRole("heading", { level: 2, name: "Bandeja: 3 tareas" }),
    ).toBeInTheDocument();
    expect(views.getByRole("link", { name: "Bandeja" })).toHaveAttribute("aria-current", "page");
    expect(titles()).toEqual(["comprar pilas", "regar plantas", "devolver libro"]);
  });

  test("another view doesn't read the inbox; an unknown view is the inbox", async () => {
    const { unmount } = render(
      await TasksPage({ searchParams: Promise.resolve({ vista: "hoy" }) }),
    );
    expect(screen.getByRole("link", { name: "Hoy" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { level: 2, name: "Hoy" })).toBeInTheDocument();
    expect(listInboxTasks).not.toHaveBeenCalled();
    unmount();
    render(await TasksPage({ searchParams: Promise.resolve({ vista: "nada" }) }));
    expect(screen.getByRole("link", { name: "Bandeja" })).toHaveAttribute("aria-current", "page");
  });

  test("empty inbox: C is mentioned only with the shortcuts on (and only from 1024 px)", async () => {
    vi.mocked(listInboxTasks).mockResolvedValue([]);
    cookieJar.shortcuts = undefined;
    const { unmount } = render(await TasksPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("heading", { name: "Bandeja vacía" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Tareas en la bandeja" })).toBeNull();
    expect(screen.getByText(/También puedes pulsar C\./)).toHaveClass("hidden", "lg:inline");
    unmount();
    cookieJar.shortcuts = "off";
    render(await TasksPage({ searchParams: Promise.resolve({}) }));
    expect(screen.queryByText(/pulsar C/)).toBeNull();
    cookieJar.shortcuts = undefined;
  });

  test("?deleted=<id>: focus on the heading and Tarea eliminada · Deshacer", async () => {
    vi.mocked(getDeletedTask).mockResolvedValue({ id: LIBRO.id, title: "devolver libro" });
    vi.mocked(restoreTask).mockResolvedValue(ok(LIBRO));
    render(await TasksPage({ searchParams: Promise.resolve({ deleted: LIBRO.id }) }));
    expect(getDeletedTask).toHaveBeenCalledWith(LIBRO.id);
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveFocus());
    expect(await within(notices()).findByText("«devolver libro» se eliminó.")).toBeInTheDocument();
    await userEvent.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    expect(restoreTask).toHaveBeenCalledWith({ id: LIBRO.id });
  });
});

describe("inbox rows", () => {
  test("checkbox, title link to the task, due label in Lima time and Alta", () => {
    render(<Harness />);
    const pilas = row("comprar pilas");
    expect(within(pilas).getByRole("checkbox", { name: "Hecha: comprar pilas" })).not.toBeChecked();
    expect(within(pilas).getByRole("link")).toHaveAttribute("href", `/tasks/${PILAS.id}`);
    expect(within(pilas).getByRole("link")).toHaveAccessibleDescription("Retrasada hace 2 días");
    const plantas = row("regar plantas");
    expect(within(plantas).getByRole("link")).toHaveAccessibleDescription(
      "Vence hoy, Prioridad alta",
    );
    expect(within(row("devolver libro")).getByRole("link")).not.toHaveAttribute("aria-describedby");
    expect(
      within(pilas).getByRole("button", { name: "Clasificar «comprar pilas»" }),
    ).toBeInTheDocument();
  });

  test("one tap completes it at once (focus to the next row); Deshacer brings it back", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("checkbox", { name: "Hecha: comprar pilas" }));
    // Gone before the server answers, and focus is on the next row, never on <body>.
    expect(titles()).toEqual(["regar plantas", "devolver libro"]);
    expect(screen.getByRole("checkbox", { name: "Hecha: regar plantas" })).toHaveFocus();
    expect(completeTask).toHaveBeenCalledWith({ id: PILAS.id });

    await server.answer();
    expect(titles()).toEqual(["regar plantas", "devolver libro"]);
    expect(within(notices()).getByText("«comprar pilas» está hecha.")).toBeInTheDocument();

    await user.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    expect(titles()).toEqual(["comprar pilas", "regar plantas", "devolver libro"]);
    expect(reopenTask).toHaveBeenCalledWith({ id: PILAS.id });
    await server.answer();
    expect(titles()).toEqual(["comprar pilas", "regar plantas", "devolver libro"]);
    await waitFor(() =>
      expect(document.querySelector("[data-tasks-announcer]")).toHaveTextContent(
        "«comprar pilas» volvió a estar pendiente.",
      ),
    );
  });

  test("a refused completion rolls back with a notice", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("checkbox", { name: "Hecha: devolver libro" }));
    expect(titles()).toEqual(["comprar pilas", "regar plantas"]);
    await server.answer(fail("Esta tarea ya no existe (se eliminó)."));
    expect(titles()).toEqual(["comprar pilas", "regar plantas", "devolver libro"]);
    expect(
      within(notices()).getByText(
        /No se pudo marcar la tarea; volvió a como estaba\. Esta tarea ya no existe/,
      ),
    ).toBeInTheDocument();
  });

  test("the last one leaving sends focus to the view's heading", async () => {
    server.tasks = [LIBRO];
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("checkbox", { name: "Hecha: devolver libro" }));
    expect(screen.getByRole("heading", { name: "Bandeja vacía" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Bandeja" })).toHaveFocus();
    await server.answer();
  });
});

describe("Clasificar", () => {
  test("moving it to an area takes it out of the inbox; Deshacer puts it back", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Clasificar «comprar pilas»" }));
    const dialog = await screen.findByRole("dialog", { name: "Clasificar tarea" });
    expect(dialog).toHaveAccessibleDescription(/«comprar pilas»/);
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Área o proyecto" }),
      "Salud",
    );
    await user.click(within(dialog).getByRole("button", { name: "Guardar" }));
    expect(titles()).toEqual(["regar plantas", "devolver libro"]);
    expect(editTask).toHaveBeenCalledWith({
      id: PILAS.id,
      placement: { lifeAreaId: HEALTH_ID, projectId: null, milestoneId: null },
      dueDate: "2026-09-30",
    });
    await server.answer();
    expect(
      await within(notices()).findByText("«comprar pilas» pasó a «Salud»."),
    ).toBeInTheDocument();
    await user.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    expect(titles()).toEqual(["comprar pilas", "regar plantas", "devolver libro"]);
    expect(editTask).toHaveBeenLastCalledWith({
      id: PILAS.id,
      placement: { lifeAreaId: null, projectId: null, milestoneId: null },
      dueDate: "2026-09-30",
      dueTime: null,
    });
    await server.answer();
  });

  test("only a date: it stays in the inbox with its new label", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Clasificar «devolver libro»" }));
    const dialog = await screen.findByRole("dialog", { name: "Clasificar tarea" });
    await user.type(within(dialog).getByLabelText("Fecha límite"), "2026-10-03");
    await user.click(within(dialog).getByRole("button", { name: "Guardar" }));
    expect(within(row("devolver libro")).getByRole("link")).toHaveAccessibleDescription(
      "Vence mañana",
    );
    await server.answer();
    expect(titles()).toEqual(["comprar pilas", "regar plantas", "devolver libro"]);
  });

  test("Eliminar tarea: out at once, with Deshacer", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Clasificar «regar plantas»" }));
    const dialog = await screen.findByRole("dialog", { name: "Clasificar tarea" });
    await user.click(within(dialog).getByRole("button", { name: "Eliminar tarea" }));
    expect(titles()).toEqual(["comprar pilas", "devolver libro"]);
    expect(deleteTask).toHaveBeenCalledWith({ id: PLANTAS.id });
    await server.answer();
    await user.click(await within(notices()).findByRole("button", { name: "Deshacer" }));
    expect(restoreTask).toHaveBeenCalledWith({ id: PLANTAS.id });
    expect(titles()).toContain("regar plantas");
    await server.answer();
  });
});

describe("detail", () => {
  test("in the sheet, a refused save and Se guardó are said inside the dialog (the page behind is hidden)", async () => {
    desktop = true;
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("link", { name: "regar plantas" }));
    const dialog = await screen.findByRole("dialog", { name: "regar plantas" });
    // Section headings are h3 under the sheet's title (h2).
    expect(
      within(dialog).getByRole("heading", { level: 3, name: "Dónde y cuándo" }),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("radio", { name: "Baja" }));
    await server.answer(fail("Esta tarea ya no existe (se eliminó)."));
    const alert = within(dialog).getByRole("alert");
    expect(alert).toHaveTextContent(
      "No se pudo guardar la prioridad; volvió a como estaba. Esta tarea ya no existe (se eliminó).",
    );
    expect(within(dialog).getByRole("radio", { name: "Alta" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    // Not as a notice behind the sheet.
    expect(within(notices()).queryByText(/No se pudo guardar/)).toBeNull();

    const title = within(dialog).getByRole("textbox", { name: "Título" });
    await user.clear(title);
    await user.type(title, "regar más{Enter}");
    await server.answer();
    await waitFor(() =>
      expect(dialog.querySelector("[data-detail-status]")).toHaveTextContent(
        "Se guardó el título.",
      ),
    );
    // A later save clears the error.
    expect(within(dialog).getByRole("alert")).toBeEmptyDOMElement();
  });

  test("the checkbox's 44 px square is its label: tapping anywhere in it completes", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const box = screen.getByRole("checkbox", { name: "Hecha: devolver libro" });
    expect(box.parentElement?.tagName).toBe("LABEL");
    await user.click(box.parentElement!);
    expect(completeTask).toHaveBeenCalledWith({ id: LIBRO.id });
    await server.answer();
  });

  test("on the desktop the title opens a side sheet with the sections; edits save", async () => {
    desktop = true;
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("link", { name: "regar plantas" }));
    const dialog = await screen.findByRole("dialog", { name: "regar plantas" });
    expect(within(dialog).getByRole("textbox", { name: "Título" })).toHaveValue("regar plantas");
    expect(within(dialog).getByRole("heading", { name: "Dónde y cuándo" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Fecha límite")).toHaveAccessibleDescription("Vence hoy");

    await user.click(within(dialog).getByRole("radio", { name: "Baja" }));
    expect(within(dialog).getByRole("radio", { name: "Baja" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(editTask).toHaveBeenCalledWith({ id: PLANTAS.id, priority: "low" });
    await server.answer();

    const title = within(dialog).getByRole("textbox", { name: "Título" });
    await user.clear(title);
    await user.type(title, "regar las plantas{Enter}");
    expect(editTask).toHaveBeenLastCalledWith({ id: PLANTAS.id, title: "regar las plantas" });
    // The sheet's title follows at once.
    expect(screen.getByRole("dialog", { name: "regar las plantas" })).toBeInTheDocument();
    await server.answer();
  });

  test("an empty title stays in the field with its error and sends nothing", async () => {
    desktop = true;
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("link", { name: "devolver libro" }));
    const dialog = await screen.findByRole("dialog", { name: "devolver libro" });
    const title = within(dialog).getByRole("textbox", { name: "Título" });
    await user.clear(title);
    await user.type(title, "{Enter}");
    expect(title).toHaveAccessibleDescription("Escribe qué hay que hacer.");
    expect(editTask).not.toHaveBeenCalled();
  });

  test("deleting from the sheet closes it and offers Deshacer in the list", async () => {
    desktop = true;
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("link", { name: "devolver libro" }));
    const dialog = await screen.findByRole("dialog", { name: "devolver libro" });
    await user.click(within(dialog).getByRole("button", { name: "Eliminar tarea" }));
    expect(deleteTask).toHaveBeenCalledWith({ id: LIBRO.id });
    await server.answer();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await within(notices()).findByText("«devolver libro» se eliminó.")).toBeInTheDocument();
  });

  test("on the phone the title is a plain link to the task's page (no sheet)", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const link = screen.getByRole("link", { name: "regar plantas" });
    link.addEventListener("click", (event) => event.preventDefault());
    await user.click(link);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("/tasks/<id>", () => {
  test("its page: title, owner check, the sections; deleting goes back to the list", async () => {
    vi.mocked(getTask).mockResolvedValue(PLANTAS);
    expect(await generateMetadata({ params: Promise.resolve({ id: PLANTAS.id }) })).toEqual({
      title: "regar plantas · brahua-os",
    });
    render(await TaskPage({ params: Promise.resolve({ id: PLANTAS.id }) }));
    expect(requireOwner).toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1, name: "regar plantas" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver a Tareas" })).toHaveAttribute("href", "/tasks");
    vi.mocked(deleteTask).mockResolvedValueOnce(ok({ id: PLANTAS.id, title: "regar plantas" }));
    await userEvent.click(screen.getByRole("button", { name: "Eliminar tarea" }));
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith(`/tasks?deleted=${PLANTAS.id}`),
    );
  });

  test("missing or deleted: a 404 with its own title", async () => {
    vi.mocked(getTask).mockResolvedValue(null);
    await expect(TaskPage({ params: Promise.resolve({ id: "nope" }) })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
    expect(await generateMetadata({ params: Promise.resolve({ id: "nope" }) })).toMatchObject({
      title: "Tarea no encontrada · brahua-os",
    });
  });
});
