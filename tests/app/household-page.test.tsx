// `household` H1: /household as a page, with `tasks`' contract mocked (no database): what it
// reads (one call, the `limpieza` tag), the grouping from the URL and the authorization.
import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import HouseholdPage, { metadata } from "@/app/(app)/household/page";
import { requireOwner } from "@/lib/auth";
import { getRecipes } from "@/modules/household/recipe-queries";
import { getProducts } from "@/modules/household/shopping-queries";
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
vi.mock("@/modules/household/shopping-actions", () => ({
  addShoppingProduct: vi.fn(),
  markProductBought: vi.fn(),
  changeProductQuantity: vi.fn(),
  removeProductFromShoppingList: vi.fn(),
  undoRemoveProduct: vi.fn(),
  forgetShoppingProduct: vi.fn(),
  undoForgetProduct: vi.fn(),
  finishShoppingTrip: vi.fn(),
  undoFinishShoppingTrip: vi.fn(),
}));
vi.mock("@/modules/household/shopping-queries", () => ({ getProducts: vi.fn() }));
vi.mock("@/modules/household/recipe-queries", () => ({ getRecipes: vi.fn() }));
vi.mock("@/modules/household/recipe-actions", () => ({
  addRecipe: vi.fn(),
  editRecipe: vi.fn(),
  removeRecipe: vi.fn(),
  undoRemoveRecipe: vi.fn(),
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
  vi.mocked(getProducts).mockReset().mockResolvedValue([]);
  vi.mocked(getRecipes).mockReset().mockResolvedValue([]);
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
    render(await HouseholdPage(search({ agrupar: "x" })));
    expect(screen.getByRole("heading", { name: /Baño/ })).toBeVisible();
  });

  test("?vista=compras reads only the products, and an unknown view falls back to the cleaning", async () => {
    const { unmount } = render(await HouseholdPage(search({ vista: "compras" })));
    expect(getProducts).toHaveBeenCalledTimes(1);
    expect(getTasksByTag).not.toHaveBeenCalled();
    expect(screen.getByText("La lista está vacía.")).toBeVisible();
    // The two views are a navigation, the current one marked.
    const nav = screen.getByRole("navigation", { name: "Secciones del Hogar" });
    expect(within(nav).getByRole("link", { name: "Compras" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(nav).getByRole("link", { name: "Limpieza" })).toHaveAttribute(
      "href",
      "/household",
    );
    unmount();
    vi.mocked(getTasksByTag).mockClear();
    vi.mocked(getProducts).mockClear();
    render(await HouseholdPage(search({ vista: "otra" })));
    expect(getTasksByTag).toHaveBeenCalledTimes(1);
    expect(getProducts).not.toHaveBeenCalled();
    expect(getRecipes).not.toHaveBeenCalled();
  });

  test("?vista=recetas reads only the recipes and passes the filters from the URL", async () => {
    vi.mocked(getRecipes).mockResolvedValue([
      {
        id: "00000000-0000-4000-8000-000000000001",
        name: "Tallarines",
        mealTypes: ["lunch"],
        weekdays: [3],
        url: null,
      },
      {
        id: "00000000-0000-4000-8000-000000000002",
        name: "Avena",
        mealTypes: ["breakfast"],
        weekdays: [3],
        url: null,
      },
    ]);
    render(await HouseholdPage(search({ vista: "recetas", tipo: "lunch", dia: "3" })));
    expect(getRecipes).toHaveBeenCalledTimes(1);
    expect(getTasksByTag).not.toHaveBeenCalled();
    expect(getProducts).not.toHaveBeenCalled();
    // Wednesday: «Para hoy» lists both; the filtered list only the lunch.
    expect(screen.getByRole("heading", { name: "Para hoy · miércoles" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Filtrar por Almuerzo" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    // A tampered value is ignored, not an error.
    const { unmount } = render(
      await HouseholdPage(search({ vista: "recetas", tipo: "x", dia: "99" })),
    );
    expect(
      screen.getAllByRole("link", { name: "Filtrar por Almuerzo" }).at(-1),
    ).not.toHaveAttribute("aria-current");
    unmount();
  });

  test("a refused owner never reads anything", async () => {
    vi.mocked(requireOwner).mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(HouseholdPage(search())).rejects.toThrow("NEXT_REDIRECT");
    expect(getTasksByTag).not.toHaveBeenCalled();
    expect(getProducts).not.toHaveBeenCalled();
  });
});
