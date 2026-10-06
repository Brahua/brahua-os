import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import Home from "@/app/(app)/page";
import { ok } from "@/lib/action-result";
import { requireOwner } from "@/lib/auth";
import { getFinanceTodaySummary, type FinanceTodayItem } from "@/modules/finance/contracts";
import { getHabitsDueToday } from "@/modules/habits/contracts";
import type { HabitItem } from "@/modules/habits/habit-input";
import { setHabitDone } from "@/modules/habits/log-actions";
import { getProjectsTodaySummary } from "@/modules/projects/contracts";
import {
  getTasksDoneTodayCount,
  getTasksTodaySummary,
  type TaskTodayItem,
} from "@/modules/tasks/contracts";

vi.mock("@/lib/auth", () => ({ requireOwner: vi.fn() }));
vi.mock("@/modules/habits/contracts", () => ({ getHabitsDueToday: vi.fn() }));
vi.mock("@/modules/tasks/contracts", () => ({
  getTasksTodaySummary: vi.fn(),
  getTasksDoneTodayCount: vi.fn(),
}));
vi.mock("@/modules/tasks/recurrence-actions", () => ({
  completeTaskWithNext: vi.fn(),
  reopenTaskWithSpawn: vi.fn(),
}));
vi.mock("@/modules/projects/contracts", () => ({ getProjectsTodaySummary: vi.fn() }));
vi.mock("@/modules/finance/contracts", () => ({ getFinanceTodaySummary: vi.fn() }));
vi.mock("@/modules/finance/payment-actions", () => ({ markPaid: vi.fn(), undoPaid: vi.fn() }));
vi.mock("@/modules/finance/catalog-actions", () => ({ readFinanceCatalog: vi.fn() }));
vi.mock("@/modules/habits/log-actions", () => ({
  setHabitDone: vi.fn(),
  logHabit: vi.fn(),
  setHabitQuantity: vi.fn(),
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

beforeEach(() => {
  // 2026-09-30 08:15 in Lima (UTC-5).
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-09-30T13:15:00Z") });
  vi.mocked(requireOwner).mockReset();
  vi.mocked(requireOwner).mockResolvedValue({ user: { id: "owner-id" } } as never);
  vi.mocked(getHabitsDueToday).mockReset();
  vi.mocked(getHabitsDueToday).mockResolvedValue([]);
  vi.mocked(getTasksTodaySummary).mockReset();
  vi.mocked(getTasksTodaySummary).mockResolvedValue([]);
  vi.mocked(getProjectsTodaySummary).mockReset();
  vi.mocked(getProjectsTodaySummary).mockResolvedValue([]);
  vi.mocked(getTasksDoneTodayCount).mockReset();
  vi.mocked(getTasksDoneTodayCount).mockResolvedValue(0);
  vi.mocked(getFinanceTodaySummary).mockReset();
  vi.mocked(getFinanceTodaySummary).mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

test("home page greets in Lima time; passkeys and sign-out moved to Ajustes", async () => {
  render(await Home());

  expect(screen.getByRole("heading", { level: 1, name: "Buenos días" })).toBeInTheDocument();
  const date = screen.getByText("Miércoles, 30 de setiembre");
  expect(date.tagName).toBe("TIME");
  expect(date).toHaveAttribute("dateTime", "2026-09-30");
  expect(screen.queryByRole("heading", { name: /Passkeys/ })).toBeNull();
  expect(screen.queryByRole("button", { name: "Cerrar sesión" })).toBeNull();
  expect(requireOwner).toHaveBeenCalled();
});

test("home page reads today's habits at the page's instant and shows the board", async () => {
  render(await Home());
  expect(getHabitsDueToday).toHaveBeenCalledTimes(1);
  expect(getHabitsDueToday).toHaveBeenCalledWith(new Date("2026-09-30T13:15:00Z"));
  // No habits today: the calm empty day.
  expect(screen.getByRole("heading", { name: "Nada programado para hoy" })).toBeInTheDocument();
});

test("home page does not render without the owner (requireOwner redirects)", async () => {
  vi.mocked(requireOwner).mockRejectedValue(new Error("NEXT_REDIRECT"));
  await expect(Home()).rejects.toThrow("NEXT_REDIRECT");
  // Nothing is read before the owner is known.
  expect(getHabitsDueToday).not.toHaveBeenCalled();
  expect(getTasksTodaySummary).not.toHaveBeenCalled();
  expect(getProjectsTodaySummary).not.toHaveBeenCalled();
  expect(getTasksDoneTodayCount).not.toHaveBeenCalled();
  expect(getFinanceTodaySummary).not.toHaveBeenCalled();
});

test("home page reads the projects summary at the same instant and shows Proyectos (D3)", async () => {
  vi.mocked(getProjectsTodaySummary).mockResolvedValue([
    {
      id: "00000000-0000-4000-8000-0000000000aa",
      name: "Renovar pasaporte",
      area: { id: "a1", slug: "travel", name: "Planes y Viajes", icon: "plane", color: "travel" },
      status: "active",
      priority: "medium",
      dueDate: "2026-10-03",
      due: { kind: "soon", days: 3, label: "Vence en 3 días" },
      blockedBy: [],
    },
  ]);
  render(await Home());
  expect(getProjectsTodaySummary).toHaveBeenCalledTimes(1);
  expect(getProjectsTodaySummary).toHaveBeenCalledWith(new Date("2026-09-30T13:15:00Z"));
  const section = screen.getByRole("region", { name: "Proyectos" });
  expect(within(section).getByRole("link", { name: "Renovar pasaporte" })).toHaveAttribute(
    "href",
    "/projects/00000000-0000-4000-8000-0000000000aa",
  );
  // Something is due: no empty day.
  expect(screen.queryByRole("heading", { name: "Nada programado para hoy" })).toBeNull();
});

test("greeting and date follow Lima, not UTC, around midnight", async () => {
  // 2026-10-01 02:30 UTC is still 21:30 on September 30 in Lima.
  vi.setSystemTime(new Date("2026-10-01T02:30:00Z"));
  render(await Home());

  expect(screen.getByRole("heading", { level: 1, name: "Buenas noches" })).toBeInTheDocument();
  expect(screen.getByText("Miércoles, 30 de setiembre")).toBeInTheDocument();
});

test("a tap at 21:30 in Lima (02:30 UTC the next day) logs Lima's day", async () => {
  vi.setSystemTime(new Date("2026-10-01T02:30:00Z"));
  const meditar = {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Meditar",
    kind: "build",
    measure: "check",
    goal: 1,
    unit: null,
    step: 1,
    frequency: "daily",
    weeklyTarget: null,
    weekdays: null,
    startDate: "2026-01-01",
    area: null,
    quantity: 0,
    target: 1,
    hasLogs: false,
    weekDoneBefore: 0,
    weekAvailable: 7,
    streak: { unit: "days", done: 0, notDone: 0 },
    pause: null,
    recentLogs: [],
    recentPaused: [],
    identity: null,
    cue: null,
  } satisfies HabitItem;
  vi.mocked(getHabitsDueToday).mockResolvedValue([meditar]);
  vi.mocked(setHabitDone).mockResolvedValue(ok({ ...meditar, quantity: 1 }));
  render(await Home());

  await userEvent.click(screen.getByRole("button", { name: "Meditar" }));
  await waitFor(() =>
    expect(setHabitDone).toHaveBeenCalledWith({ id: meditar.id, day: "2026-09-30", done: true }),
  );
});

test("home page reads today's tasks at the page's instant and shows them in “Tareas” (D2)", async () => {
  const informe: TaskTodayItem = {
    id: "00000000-0000-4000-8000-000000000002",
    title: "Enviar informe",
    priority: "medium",
    dueDate: "2026-09-30",
    due: { kind: "today", days: 0, label: "Vence hoy" },
    area: null,
    project: null,
    isNextAction: false,
  };
  vi.mocked(getTasksTodaySummary).mockResolvedValue([informe]);
  render(await Home());

  expect(getTasksTodaySummary).toHaveBeenCalledTimes(1);
  expect(getTasksTodaySummary).toHaveBeenCalledWith(new Date("2026-09-30T13:15:00Z"));
  // Habits and tasks share one instant (one Lima day for the whole page).
  expect(vi.mocked(getTasksTodaySummary).mock.calls[0][0]).toBe(
    vi.mocked(getHabitsDueToday).mock.calls[0][0],
  );
  const tasks = screen.getByRole("region", { name: "Tareas" });
  expect(screen.getByRole("link", { name: "Enviar informe" })).toHaveAttribute(
    "href",
    "/tasks/00000000-0000-4000-8000-000000000002",
  );
  expect(tasks).toBeInTheDocument();
  // A task today: the day isn't empty.
  expect(screen.queryByRole("heading", { name: "Nada programado para hoy" })).toBeNull();
});

test("home page reads the tasks done today at the page's instant: “Día completo” (D4)", async () => {
  vi.mocked(getTasksDoneTodayCount).mockResolvedValue(3);
  render(await Home());

  expect(getTasksDoneTodayCount).toHaveBeenCalledTimes(1);
  expect(vi.mocked(getTasksDoneTodayCount).mock.calls[0][0]).toBe(
    vi.mocked(getHabitsDueToday).mock.calls[0][0],
  );
  // Nothing pending and 3 tasks done today: the day is complete, not empty.
  const complete = screen.getByRole("region", { name: "Día completo" });
  expect(complete).toHaveTextContent("3 tareas");
  expect(screen.queryByRole("heading", { name: "Nada programado para hoy" })).toBeNull();
});

test("nothing pending and nothing done today: the empty day, never “Día completo” (D4)", async () => {
  render(await Home());
  expect(screen.queryByRole("region", { name: "Día completo" })).toBeNull();
  expect(screen.getByRole("heading", { name: "Nada programado para hoy" })).toBeInTheDocument();
});

const payment = (values: Partial<FinanceTodayItem> = {}): FinanceTodayItem => ({
  recurringId: "00000000-0000-4000-8000-0000000000f1",
  name: "Internet",
  dueOn: "2026-09-30",
  amountCents: 5_000,
  currency: "PEN",
  paymentMethod: { id: "00000000-0000-4000-8000-0000000000f2", name: "Crédito" },
  ...values,
});

test("home page reads the payments at the same instant and shows Pagos between Tareas and Proyectos (F4)", async () => {
  vi.mocked(getFinanceTodaySummary).mockResolvedValue([payment()]);
  vi.mocked(getTasksTodaySummary).mockResolvedValue([
    {
      id: "00000000-0000-4000-8000-000000000002",
      title: "Enviar informe",
      priority: "medium",
      dueDate: "2026-09-30",
      due: { kind: "today", days: 0, label: "Vence hoy" },
      area: null,
      project: null,
      isNextAction: false,
    },
  ]);
  vi.mocked(getProjectsTodaySummary).mockResolvedValue([
    {
      id: "00000000-0000-4000-8000-0000000000aa",
      name: "Renovar pasaporte",
      area: { id: "a1", slug: "travel", name: "Planes y Viajes", icon: "plane", color: "travel" },
      status: "active",
      priority: "medium",
      dueDate: "2026-10-03",
      due: { kind: "soon", days: 3, label: "Vence en 3 días" },
      blockedBy: [],
    },
  ]);
  render(await Home());

  expect(getFinanceTodaySummary).toHaveBeenCalledTimes(1);
  expect(vi.mocked(getFinanceTodaySummary).mock.calls[0][0]).toBe(
    vi.mocked(getHabitsDueToday).mock.calls[0][0],
  );
  const sections = screen
    .getAllByRole("region")
    .map((region) => region.getAttribute("aria-labelledby"))
    .filter((id) => id?.startsWith("today-"));
  expect(sections).toEqual(["today-tasks-title", "today-payments-title", "today-projects-title"]);
  const pagos = screen.getByRole("region", { name: "Pagos" });
  expect(within(pagos).getByRole("link", { name: "Internet" })).toHaveAccessibleDescription(
    "Vence hoy, 50 soles, Crédito",
  );
});

test("an overdue payment keeps “Día completo” away; an upcoming one doesn't (F4)", async () => {
  vi.mocked(getTasksDoneTodayCount).mockResolvedValue(2);
  vi.mocked(getFinanceTodaySummary).mockResolvedValue([payment({ dueOn: "2026-09-28" })]);
  const { unmount } = render(await Home());
  expect(screen.queryByRole("region", { name: "Día completo" })).toBeNull();
  expect(screen.getByRole("region", { name: "Pagos" })).toBeInTheDocument();
  unmount();

  // Positive control: the same day with the payment due in 3 days is complete, Pagos still shows.
  vi.mocked(getFinanceTodaySummary).mockResolvedValue([payment({ dueOn: "2026-10-03" })]);
  render(await Home());
  expect(screen.getByRole("region", { name: "Día completo" })).toHaveTextContent("2 tareas");
  expect(screen.getByRole("region", { name: "Pagos" })).toBeInTheDocument();
});

test("only an upcoming payment: Pagos shows, never the empty day (F4)", async () => {
  vi.mocked(getFinanceTodaySummary).mockResolvedValue([payment({ dueOn: "2026-10-05" })]);
  render(await Home());
  expect(screen.getByRole("region", { name: "Pagos" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Nada programado para hoy" })).toBeNull();
  expect(screen.queryByRole("region", { name: "Día completo" })).toBeNull();
});
