// `weekly-review` W2: /review as a page, with the composition roots and contracts mocked (no
// database): which week and step it opens on, what each step reads (a fixed number of calls), the
// placeholder of steps 3 and 4 and the authorization.
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import ReviewPage, { generateMetadata } from "@/app/(app)/review/page";
import { requireOwner } from "@/lib/auth";
import { getGoalsWeekReview } from "@/modules/goals/contracts";
import { getHabitsWeekCompleteDays, getHabitsWeekSummary } from "@/modules/habits/contracts";
import { getProjectsWeekReview } from "@/modules/projects/contracts";
import { getTasksWeekReview } from "@/modules/tasks/contracts";
import { hasReview } from "@/modules/weekly-review/queries";

vi.mock("@/lib/auth", () => ({ requireOwner: vi.fn() }));
vi.mock("@/modules/habits/contracts", () => ({
  getHabitsWeekSummary: vi.fn(),
  getHabitsWeekCompleteDays: vi.fn(),
}));
vi.mock("@/modules/tasks/contracts", () => ({ getTasksWeekReview: vi.fn() }));
vi.mock("@/modules/projects/contracts", () => ({ getProjectsWeekReview: vi.fn() }));
vi.mock("@/modules/goals/contracts", () => ({ getGoalsWeekReview: vi.fn() }));
vi.mock("@/modules/weekly-review/queries", () => ({ hasReview: vi.fn() }));
vi.mock("@/modules/weekly-review/actions", () => ({
  moveReviewTasks: vi.fn(),
  undoReviewMove: vi.fn(),
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

/** Tuesday 2026-10-13, 10:00 in Lima: the week in progress is 12–18, the previous one 5–11. */
const NOW = new Date("2026-10-13T15:00:00Z");

const search = (params: Record<string, string | string[]> = {}) =>
  ({ searchParams: Promise.resolve(params) }) as never;

async function open(params: Record<string, string | string[]> = {}) {
  render(await ReviewPage(search(params)));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  for (const mocked of [
    requireOwner,
    getHabitsWeekSummary,
    getHabitsWeekCompleteDays,
    getTasksWeekReview,
    getProjectsWeekReview,
    getGoalsWeekReview,
    hasReview,
  ]) {
    vi.mocked(mocked).mockReset();
  }
  vi.mocked(requireOwner).mockResolvedValue({ user: { id: "owner-id" } } as never);
  vi.mocked(hasReview).mockResolvedValue(false);
  vi.mocked(getHabitsWeekSummary).mockResolvedValue({
    weekStart: "2026-10-05",
    habits: [{ id: "h", name: "Correr", area: null, compliance: { done: 5, expected: 7 } }],
    total: { done: 18, expected: 24 },
  } as never);
  vi.mocked(getHabitsWeekCompleteDays).mockResolvedValue({
    weekStart: "2026-10-05",
    days: [],
    completeDays: 4,
  });
  vi.mocked(getTasksWeekReview).mockResolvedValue({
    weekStart: "2026-10-05",
    doneCount: 11,
    recentDone: [{ id: "t1", title: "Pagar la luz", doneAt: new Date() }],
    open: [
      {
        id: "00000000-0000-4000-8000-00000000000a",
        title: "Llamar al banco",
        dueDate: "2026-10-08",
        projectName: null,
        recurring: false,
      },
    ],
    openCount: 1,
    inboxCount: 3,
  });
  vi.mocked(getProjectsWeekReview).mockResolvedValue({
    weekStart: "2026-10-05",
    projects: [],
    milestonesDone: [],
  });
  vi.mocked(getGoalsWeekReview).mockResolvedValue({
    weekStart: "2026-10-05",
    active: [],
    achieved: [],
    entries: [],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("which week", () => {
  test("on Tuesday it opens the previous week while it has no review", async () => {
    await open();
    expect(requireOwner).toHaveBeenCalled();
    expect(hasReview).toHaveBeenCalledWith("2026-10-05");
    expect(screen.getByRole("heading", { level: 1, name: "Del 5 al 11 de octubre" })).toBeVisible();
    expect(getTasksWeekReview).toHaveBeenCalledWith("2026-10-05");
    // The week in progress one tap away.
    expect(screen.getByRole("link", { name: "Ver esta semana" })).toHaveAttribute(
      "href",
      "/review?semana=2026-10-12",
    );
  });

  test("once the previous week has its review, it opens the week in progress", async () => {
    vi.mocked(hasReview).mockResolvedValue(true);
    await open();
    expect(
      screen.getByRole("heading", { level: 1, name: "Del 12 al 18 de octubre" }),
    ).toBeVisible();
    expect(screen.queryByRole("link", { name: "Ver esta semana" })).not.toBeInTheDocument();
  });

  test("?semana= (a Monday that is not in the future) wins and skips the lookup", async () => {
    await open({ semana: "2026-09-28" });
    expect(hasReview).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { level: 1, name: "Del 28 de setiembre al 4 de octubre" }),
    ).toBeVisible();
    expect(getHabitsWeekSummary).toHaveBeenCalledWith("2026-09-28", expect.any(Date));
  });

  test.each([
    ["not a Monday", "2026-10-14"],
    ["not a day", "2026-02-30"],
    ["the future", "2026-10-19"],
    ["garbage", "ayer"],
  ])("an invalid ?semana= (%s) falls back to the default week", async (_name, value) => {
    await open({ semana: value });
    expect(screen.getByRole("heading", { level: 1, name: "Del 5 al 11 de octubre" })).toBeVisible();
  });

  test("a repeated ?semana= is not a week either", async () => {
    await open({ semana: ["2026-09-28", "2026-10-05"] });
    expect(screen.getByRole("heading", { level: 1, name: "Del 5 al 11 de octubre" })).toBeVisible();
  });
});

describe("which step", () => {
  test("step 1 is the default and reads each provider once, at the page's instant", async () => {
    await open();
    expect(screen.getByRole("heading", { level: 2, name: /Logros/ })).toBeVisible();
    expect(screen.getByText("Días completos esta semana: 4")).toBeVisible();
    expect(screen.getByText("18 de 24")).toBeVisible();
    expect(getHabitsWeekSummary).toHaveBeenCalledTimes(1);
    expect(getHabitsWeekSummary).toHaveBeenCalledWith("2026-10-05", NOW);
    expect(getHabitsWeekCompleteDays).toHaveBeenCalledWith("2026-10-05", NOW);
    expect(getTasksWeekReview).toHaveBeenCalledTimes(1);
    expect(getProjectsWeekReview).toHaveBeenCalledWith("2026-10-05", NOW);
    expect(getGoalsWeekReview).toHaveBeenCalledWith("2026-10-05", NOW);
    expect(screen.getByRole("link", { name: /Logros/ }).getAttribute("aria-current")).toBe("step");
  });

  test("an unknown ?paso= is step 1", async () => {
    await open({ paso: "9" });
    expect(screen.getByRole("heading", { level: 2, name: /Logros/ })).toBeVisible();
  });

  test("step 2 reads only the tasks and shows «Pendientes»", async () => {
    await open({ paso: "2" });
    expect(screen.getByRole("heading", { level: 2, name: /Pendientes/ })).toBeVisible();
    expect(screen.getByText("Quedó abierta 1 tarea.")).toBeVisible();
    // «Mover … al lunes»: the Monday after the week reviewed (5–11) is today's week's 12th.
    expect(screen.getByRole("button", { name: "Mover la tarea al lunes" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Procesar 3 en la bandeja" })).toBeVisible();
    expect(getTasksWeekReview).toHaveBeenCalledTimes(1);
    expect(getHabitsWeekSummary).not.toHaveBeenCalled();
    expect(getProjectsWeekReview).not.toHaveBeenCalled();
    expect(getGoalsWeekReview).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: /Pendientes/ }).getAttribute("aria-current")).toBe(
      "step",
    );
  });

  test.each(["3", "4"])(
    "step %s is the placeholder inside the same shell, with no reads",
    async (paso) => {
      await open({ paso });
      expect(screen.getByText("Esta parte llega pronto")).toBeVisible();
      expect(screen.getByRole("navigation", { name: "Pasos de la revisión" })).toBeVisible();
      expect(getTasksWeekReview).not.toHaveBeenCalled();
      expect(getHabitsWeekSummary).not.toHaveBeenCalled();
    },
  );
});

describe("metadata and authorization", () => {
  test("each step has its own title", async () => {
    expect(await generateMetadata(search())).toEqual({
      title: "Logros · Revisión semanal · brahua-os",
    });
    expect(await generateMetadata(search({ paso: "2" }))).toEqual({
      title: "Pendientes · Revisión semanal · brahua-os",
    });
  });

  test("without the owner the page reads nothing (requireOwner redirects)", async () => {
    vi.mocked(requireOwner).mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(ReviewPage(search())).rejects.toThrow("NEXT_REDIRECT");
    expect(getTasksWeekReview).not.toHaveBeenCalled();
    expect(hasReview).not.toHaveBeenCalled();
  });
});
