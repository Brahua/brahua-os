// `household` H1: /household as a page, with `tasks`' contract mocked (no database): what it
// reads (one call, the `limpieza` tag), the grouping from the URL and the authorization.
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import HouseholdPage, { metadata } from "@/app/(app)/household/page";
import { requireOwner } from "@/lib/auth";
import { getTasksByTag, type TaggedTask } from "@/modules/tasks/contracts";

vi.mock("@/lib/auth", () => ({ requireOwner: vi.fn() }));
vi.mock("@/modules/tasks/contracts", () => ({ getTasksByTag: vi.fn() }));
vi.mock("@/modules/household/actions", () => ({
  addCleaning: vi.fn(),
  completeCleaning: vi.fn(),
  reopenCleaning: vi.fn(),
  removeCleaning: vi.fn(),
  restoreCleaning: vi.fn(),
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

/** Wednesday 2026-10-14, 10:00 in Lima. */
const NOW = new Date("2026-10-14T15:00:00Z");

const TASKS: TaggedTask[] = [
  {
    id: "00000000-0000-4000-8000-00000000000a",
    title: "Limpiar inodoro",
    dueDate: "2026-10-14",
    recurrence: { kind: "weekdays", interval: null, weekdays: [3], monthDay: null },
    tags: ["limpieza", "zona: baño"],
  },
  {
    id: "00000000-0000-4000-8000-00000000000b",
    title: "Ordenar el clóset",
    dueDate: null,
    recurrence: null,
    tags: ["limpieza"],
  },
];

const search = (params: Record<string, string> = {}) =>
  ({ searchParams: Promise.resolve(params) }) as never;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  vi.mocked(requireOwner)
    .mockReset()
    .mockResolvedValue(undefined as never);
  vi.mocked(getTasksByTag).mockReset().mockResolvedValue(TASKS);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the page", () => {
  test("checks the owner first and reads the cleaning with one call, by its tag", async () => {
    render(await HouseholdPage(search()));
    expect(requireOwner).toHaveBeenCalledTimes(1);
    expect(getTasksByTag).toHaveBeenCalledTimes(1);
    expect(getTasksByTag).toHaveBeenCalledWith("limpieza");
    expect(metadata.title).toBe("Hogar · brahua-os");
    expect(screen.getByRole("heading", { level: 1, name: "Hogar" })).toBeVisible();
  });

  test("by zone by default, with «Sin zona» for a cleaning without one", async () => {
    render(await HouseholdPage(search()));
    expect(screen.getByRole("heading", { name: /Baño/ })).toBeVisible();
    expect(screen.getByRole("heading", { name: /^Sin zona/ })).toBeVisible();
    expect(screen.getByText("Cada semana, miércoles · toca hoy")).toBeVisible();
  });

  test("?agrupar=dia groups by day, and an unknown value falls back to zone", async () => {
    const { unmount } = render(await HouseholdPage(search({ agrupar: "dia" })));
    expect(screen.getByRole("heading", { name: "Hoy · miércoles 14" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Sin fecha" })).toBeVisible();
    unmount();
    render(await HouseholdPage(search({ agrupar: "x", vista: "compras" })));
    expect(screen.getByRole("heading", { name: /Baño/ })).toBeVisible();
  });

  test("a refused owner never reads anything", async () => {
    vi.mocked(requireOwner).mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(HouseholdPage(search())).rejects.toThrow("NEXT_REDIRECT");
    expect(getTasksByTag).not.toHaveBeenCalled();
  });
});
