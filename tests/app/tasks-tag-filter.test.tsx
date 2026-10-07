// T4: the tag filter of "Todas" (T2's generic TaskFilter with the tags as options):
// `?etiqueta=<tagId>` links that keep the other filters, aria-current on the current one, the
// announcement once the page shows it, an unknown id as "all", and a tag that stays offered.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import TasksPage from "@/app/(app)/tasks/page";
import { requireOwner } from "@/lib/auth";
import { getTaskTargets } from "@/modules/tasks/queries";
import { getTaskTagOptions } from "@/modules/tasks/tag-queries";
import type { TaskItem, TaskTargets } from "@/modules/tasks/task-input";
import { TAGS_COPY } from "@/modules/tasks/tags-copy";
import { listPendingTasks } from "@/modules/tasks/view-queries";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
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
vi.mock("@/modules/tasks/tag-queries", () => ({ getTaskTagOptions: vi.fn() }));
vi.mock("@/modules/tasks/actions", () => ({
  createTask: vi.fn(),
  listTaskTargets: vi.fn(),
  editTask: vi.fn(),
  completeTask: vi.fn(),
  reopenTask: vi.fn(),
  deleteTask: vi.fn(),
  restoreTask: vi.fn(),
}));
vi.mock("@/modules/tasks/recurrence-actions", () => ({
  setTaskRecurrence: vi.fn(),
  completeTaskWithNext: vi.fn(),
  reopenTaskWithSpawn: vi.fn(),
  restoreTaskWithSpawn: vi.fn(),
}));
vi.mock("@/modules/tasks/tag-actions", () => ({ listTaskTags: vi.fn(), setTaskTags: vi.fn() }));

const NOW = new Date("2026-10-02T15:00:00.000Z");
const HOME = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "home",
  name: "Hogar",
  icon: "house",
  color: "home",
} as const;
const TARGETS: TaskTargets = { areas: [HOME], projects: [] };
const COMPRAS = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "compras" };
const LIMPIEZA = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "limpieza" };
const VIEJA = { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", name: "vieja" };

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

const PAN = task({ title: "comprar pan", tags: [COMPRAS] });
const PISO = task({ title: "barrer", lifeAreaId: HOME.id, area: HOME, tags: [LIMPIEZA, COMPRAS] });
const LLAMAR = task({ title: "llamar" });

beforeEach(() => {
  window.matchMedia = vi.fn((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  vi.mocked(requireOwner)
    .mockReset()
    .mockResolvedValue({ user: { id: "owner" } } as never);
  vi.mocked(getTaskTargets).mockReset().mockResolvedValue(TARGETS);
  vi.mocked(listPendingTasks).mockReset().mockResolvedValue([PAN, PISO, LLAMAR]);
  vi.mocked(getTaskTagOptions).mockReset().mockResolvedValue([COMPRAS, LIMPIEZA, VIEJA]);
});

afterEach(() => {
  vi.useRealTimers();
});

const pageFor = async (search: Record<string, string>) =>
  TasksPage({ searchParams: Promise.resolve(search) });
const titles = () =>
  within(screen.getByRole("list", { name: "Tareas pendientes" }))
    .getAllByRole("link")
    .map((link) => link.textContent);
const tagKey = (name: string) =>
  screen.getByRole("button", { name: TAGS_COPY.filterTriggerName(name), hidden: true });

async function openSheet(name: string) {
  const user = userEvent.setup();
  await user.click(tagKey(name));
  const sheet = await screen.findByRole("dialog", { name: TAGS_COPY.filterTitle });
  return { user, sheet };
}

describe("Todas: tag filter", () => {
  test("a compact key; its options are links by id (the tags of the pending tasks, by name)", async () => {
    render(await pageFor({ vista: "todas" }));
    expect(titles()).toHaveLength(3);
    expect(tagKey(TAGS_COPY.filterAll)).toHaveAttribute("aria-haspopup", "dialog");
    const { sheet } = await openSheet(TAGS_COPY.filterAll);
    const links = within(
      within(sheet).getByRole("list", { name: TAGS_COPY.filterOptions }),
    ).getAllByRole("link");
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      [TAGS_COPY.filterAllOption, "/tasks?vista=todas"],
      ["compras", `/tasks?vista=todas&etiqueta=${COMPRAS.id}`],
      ["limpieza", `/tasks?vista=todas&etiqueta=${LIMPIEZA.id}`],
    ]);
    expect(links[0]).toHaveAttribute("aria-current", "page");
    // Without a tag in the URL, the tags in use aren't even asked for.
    expect(getTaskTagOptions).not.toHaveBeenCalled();
  });

  test("filtered by a tag (with an area): only those tasks; the key and aria-current say so", async () => {
    render(await pageFor({ vista: "todas", area: "home", etiqueta: COMPRAS.id }));
    expect(titles()).toEqual(["barrer"]);
    const { sheet } = await openSheet("compras");
    const current = within(sheet).getByRole("link", { name: "compras" });
    expect(current).toHaveAttribute("aria-current", "page");
    expect(current.querySelector(".lucide-check")).not.toBeNull();
    await waitFor(() => expect(current).toHaveFocus());
    // The other options keep the area.
    expect(within(sheet).getByRole("link", { name: TAGS_COPY.filterAllOption })).toHaveAttribute(
      "href",
      "/tasks?vista=todas&area=home",
    );
    expect(within(sheet).getByRole("link", { name: "limpieza" })).toHaveAttribute(
      "href",
      `/tasks?vista=todas&area=home&etiqueta=${LIMPIEZA.id}`,
    );
  });

  test("the area and project keys keep the tag", async () => {
    render(await pageFor({ vista: "todas", etiqueta: COMPRAS.id }));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Filtrar por área: Todas" }));
    const sheet = await screen.findByRole("dialog", { name: "Filtrar por área" });
    expect(within(sheet).getByRole("link", { name: "Hogar" })).toHaveAttribute(
      "href",
      `/tasks?vista=todas&area=home&etiqueta=${COMPRAS.id}`,
    );
  });

  test("an unknown id (or a name) is all", async () => {
    render(await pageFor({ vista: "todas", etiqueta: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }));
    expect(titles()).toHaveLength(3);
    expect(tagKey(TAGS_COPY.filterAll)).toBeInTheDocument();
  });

  test("a tag no pending task has any more stays offered (its last one was just done)", async () => {
    render(await pageFor({ vista: "todas", etiqueta: VIEJA.id }));
    expect(tagKey("vieja")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: "Nada con estos filtros" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Quitar filtros" })).toHaveAttribute(
      "href",
      "/tasks?vista=todas",
    );
  });

  test("picking one closes the sheet and announces it once the page shows it", async () => {
    const view = render(await pageFor({ vista: "todas" }));
    const { user, sheet } = await openSheet(TAGS_COPY.filterAll);
    const option = within(sheet).getByRole("link", { name: "limpieza" });
    // jsdom doesn't navigate; re-rendering the page with the new URL stands in for it.
    option.addEventListener("click", (event) => event.preventDefault());
    await user.click(option);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(tagKey(TAGS_COPY.filterAll)).toHaveFocus();
    const page = await pageFor({ vista: "todas", etiqueta: LIMPIEZA.id });
    await act(async () => view.rerender(page));
    expect(titles()).toEqual(["barrer"]);
    await waitFor(() =>
      expect(
        screen.getAllByRole("status").some((region) => /limpieza/.test(region.textContent ?? "")),
      ).toBe(true),
    );
  });
});
