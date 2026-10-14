// `household` H3: the recipes as the owner uses them, against a fake server. The Server Actions are
// mocked; the screen's queue, notices, filters and focus handling are the real ones.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { fail, ok } from "@/lib/action-result";
import { ownerDateKey } from "@/lib/time";
import { ScreenServicesProvider } from "@/modules/core/components/screen-services";
import { RecipesScreen } from "@/modules/household/components/recipes-screen";
import {
  addRecipe,
  editRecipe,
  removeRecipe,
  undoRemoveRecipe,
} from "@/modules/household/recipe-actions";
import { RECIPE_COPY as COPY } from "@/modules/household/recipe-copy";
import { isoWeekday, type RecipeItem } from "@/modules/household/recipe-view";
import { WEEKDAY_LABELS } from "@/modules/household/recipe-copy";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/modules/household/recipe-actions", () => ({
  addRecipe: vi.fn(),
  editRecipe: vi.fn(),
  removeRecipe: vi.fn(),
  undoRemoveRecipe: vi.fn(),
}));

/** Lima's day for this run (the screen refuses to act when its day has passed). */
const TODAY = ownerDateKey(new Date());
const WD = isoWeekday(TODAY);
/** Another weekday, always different from today's. */
const OTHER_WD = (WD % 7) + 1;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const R = (
  n: number,
  name: string,
  mealTypes: RecipeItem["mealTypes"],
  weekdays: number[],
  url: string | null = null,
): RecipeItem => ({ id: id(n), name, mealTypes, weekdays, url });

const TALLARINES = R(1, "Tallarines", ["lunch"], [WD], "https://www.cookpad.com/r/1");
const AVENA = R(2, "Avena", ["breakfast"], [WD, OTHER_WD]);
const POLLO = R(3, "Pollo al horno", ["lunch", "dinner"], [OTHER_WD]);

function Screen({
  recipes = [TALLARINES, AVENA, POLLO],
  meal = null,
  day = null,
}: {
  recipes?: RecipeItem[];
  meal?: RecipeItem["mealTypes"][number] | null;
  day?: number | null;
}) {
  return (
    <ScreenServicesProvider
      label={COPY.noticesLabel}
      actionHint={COPY.undoHint}
      day={{ today: TODAY, changedMessage: "Empezó un día nuevo." }}
    >
      <RecipesScreen recipes={recipes} today={TODAY} meal={meal} day={day} />
    </ScreenServicesProvider>
  );
}

const rowOf = (r: RecipeItem) => document.querySelector<HTMLElement>(`[data-recipe-row="${r.id}"]`);
const section = (name: string) => document.querySelector<HTMLElement>(`[data-recipes-${name}]`)!;

beforeEach(() => {
  for (const action of [addRecipe, editRecipe, removeRecipe, undoRemoveRecipe])
    vi.mocked(action).mockReset();
});

describe("what it shows", () => {
  test("«Para hoy» has the recipes of the weekday, and below every recipe by name", () => {
    render(<Screen />);
    expect(
      screen.getByRole("heading", { name: `Para hoy · ${WEEKDAY_LABELS[WD - 1].toLowerCase()}` }),
    ).toBeVisible();
    const today = within(section("today"));
    expect(today.getByText("Tallarines")).toBeVisible();
    expect(today.getByText("Avena")).toBeVisible();
    expect(today.queryByText("Pollo al horno")).toBeNull();
    const names = [...section("list").querySelectorAll("li")].map((li) => li.textContent ?? "");
    expect(names).toHaveLength(3);
    expect(names[0]).toMatch(/^Avena/);
    expect(names[1]).toMatch(/^Pollo al horno/);
    expect(names[2]).toMatch(/^Tallarines/);
  });

  test("a recipe with a link opens it in a new tab, safely, and shows only the domain", () => {
    render(<Screen />);
    const link = within(rowOf(TALLARINES)!).getByRole("link", { name: /Tallarines/ });
    expect(link).toHaveAttribute("href", "https://www.cookpad.com/r/1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(within(rowOf(TALLARINES)!).getByText(/cookpad\.com/)).toBeVisible();
    expect(within(rowOf(TALLARINES)!).queryByText(/www\./)).toBeNull();
    // One without a link says so, and has no anchor.
    expect(within(rowOf(AVENA)!).queryByRole("link")).toBeNull();
    expect(within(rowOf(AVENA)!).getByText(/Sin enlace/)).toBeVisible();
  });

  test("a stored link that is not http(s) is never rendered as an anchor", () => {
    render(<Screen recipes={[R(9, "Rara", [], [], "javascript:alert(1)")]} />);
    expect(screen.queryByRole("link", { name: /Rara/ })).toBeNull();
    expect(document.querySelector('a[href^="javascript"]')).toBeNull();
  });

  test("no recipes at all: the empty state, and a key to add", () => {
    render(<Screen recipes={[]} />);
    expect(screen.getByText(COPY.emptyTitle)).toBeVisible();
    expect(screen.getByRole("button", { name: COPY.add })).toBeVisible();
  });
});

describe("filters", () => {
  test("the filters come from the URL: only the recipes that fit, the active chip marked, the others link to it", () => {
    render(<Screen meal="lunch" day={null} />);
    const list = within(section("list"));
    expect(list.getByText("Tallarines")).toBeVisible();
    expect(list.getByText("Pollo al horno")).toBeVisible();
    expect(list.queryByText("Avena")).toBeNull();
    const active = screen.getByRole("link", { name: COPY.filterName("Almuerzo") });
    expect(active).toHaveAttribute("aria-current", "true");
    // Tapping the active one clears it; another adds to it.
    expect(active).toHaveAttribute("href", "/household?vista=recetas");
    expect(
      screen.getByRole("link", { name: COPY.filterName(WEEKDAY_LABELS[WD - 1]) }),
    ).toHaveAttribute("href", `/household?vista=recetas&tipo=lunch&dia=${WD}`);
    expect(screen.getByRole("link", { name: COPY.clearFilters })).toHaveAttribute(
      "href",
      "/household?vista=recetas",
    );
  });

  test("a filter that matches nothing says so and offers to clear it", () => {
    render(<Screen meal="snack" />);
    expect(screen.getByText(COPY.noMatchTitle)).toBeVisible();
    expect(screen.getByRole("link", { name: COPY.clearFilters })).toBeVisible();
  });
});

describe("«Quitar»", () => {
  test("the row leaves at once and «Deshacer» restores that recipe", async () => {
    vi.mocked(removeRecipe).mockResolvedValue(ok(AVENA));
    vi.mocked(undoRemoveRecipe).mockResolvedValue(ok(AVENA));
    render(<Screen />);
    await userEvent.click(
      within(section("list")).getByRole("button", { name: COPY.removeName("Avena") }),
    );
    expect(removeRecipe).toHaveBeenCalledWith({ id: AVENA.id });
    expect(within(section("list")).queryByText("Avena")).toBeNull();
    await userEvent.click(await screen.findByRole("button", { name: COPY.undo }));
    expect(undoRemoveRecipe).toHaveBeenCalledWith({ id: AVENA.id });
    await waitFor(() => expect(within(section("list")).getByText("Avena")).toBeVisible());
  });

  test("a refusal brings it back and says it was not saved", async () => {
    vi.mocked(removeRecipe).mockResolvedValue(fail("No se pudo guardar."));
    render(<Screen />);
    await userEvent.click(
      within(section("list")).getByRole("button", { name: COPY.removeName("Avena") }),
    );
    expect(await screen.findByText(COPY.notSavedTitle)).toBeVisible();
    expect(within(section("list")).getByText("Avena")).toBeVisible();
  });
});

describe("the sheet", () => {
  async function openAdd() {
    render(<Screen recipes={[]} />);
    await userEvent.click(screen.getByRole("button", { name: COPY.add }));
    return screen.findByRole("dialog");
  }

  test("an empty name is refused on its field and nothing is sent", async () => {
    const dialog = await openAdd();
    await userEvent.click(within(dialog).getByRole("button", { name: COPY.save }));
    expect(await within(dialog).findByText("Escribe el nombre de la receta.")).toBeVisible();
    expect(within(dialog).getByLabelText(COPY.nameLabel)).toHaveFocus();
    expect(addRecipe).not.toHaveBeenCalled();
  });

  test("a link that isn't http(s) is refused on its own field", async () => {
    const dialog = await openAdd();
    await userEvent.type(within(dialog).getByLabelText(COPY.nameLabel), "Sopa");
    await userEvent.type(within(dialog).getByLabelText(COPY.urlLabel), "javascript:alert(1)");
    await userEvent.click(within(dialog).getByRole("button", { name: COPY.save }));
    expect(await within(dialog).findByText(/empiece por http/)).toBeVisible();
    expect(within(dialog).getByLabelText(COPY.urlLabel)).toHaveFocus();
    expect(addRecipe).not.toHaveBeenCalled();
  });

  test("saves a valid recipe with its meals and days, closes and announces it", async () => {
    vi.mocked(addRecipe).mockResolvedValue(ok(R(7, "Sopa", ["dinner"], [1])));
    const dialog = await openAdd();
    await userEvent.type(within(dialog).getByLabelText(COPY.nameLabel), "  Sopa ");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cena" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Lunes" }));
    await userEvent.type(within(dialog).getByLabelText(COPY.urlLabel), "https://example.com/sopa");
    await userEvent.click(within(dialog).getByRole("button", { name: COPY.save }));
    await waitFor(() => expect(addRecipe).toHaveBeenCalledTimes(1));
    expect(addRecipe).toHaveBeenCalledWith({
      name: "  Sopa ",
      mealTypes: ["dinner"],
      weekdays: [1],
      url: "https://example.com/sopa",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  test("editing starts from the recipe's own fields and sends its id", async () => {
    vi.mocked(editRecipe).mockResolvedValue(ok({ ...AVENA, name: "Avena con frutas" }));
    render(<Screen />);
    await userEvent.click(
      within(section("list")).getByRole("button", { name: COPY.editName("Avena") }),
    );
    const dialog = await screen.findByRole("dialog", { name: COPY.sheetEditTitle });
    expect(within(dialog).getByLabelText(COPY.nameLabel)).toHaveValue("Avena");
    expect(within(dialog).getByRole("button", { name: "Desayuno" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(dialog).getByRole("button", { name: WEEKDAY_LABELS[WD - 1] })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const unset = [1, 2, 3, 4, 5, 6, 7].find((day) => day !== WD && day !== OTHER_WD)!;
    expect(within(dialog).getByRole("button", { name: WEEKDAY_LABELS[unset - 1] })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await userEvent.type(within(dialog).getByLabelText(COPY.nameLabel), " con frutas");
    await userEvent.click(within(dialog).getByRole("button", { name: COPY.save }));
    await waitFor(() => expect(editRecipe).toHaveBeenCalledTimes(1));
    expect(editRecipe).toHaveBeenCalledWith({
      id: AVENA.id,
      name: "Avena con frutas",
      mealTypes: ["breakfast"],
      weekdays: [WD, OTHER_WD].sort((a, b) => a - b),
      url: "",
    });
  });

  test("a refusal from the server keeps the sheet open with the error on its field", async () => {
    vi.mocked(addRecipe).mockResolvedValue({
      ok: false,
      error: "Revisa los campos marcados.",
      fieldErrors: { url: ["Escribe un enlace que empiece por http:// o https://"] },
    });
    const dialog = await openAdd();
    await userEvent.type(within(dialog).getByLabelText(COPY.nameLabel), "Sopa");
    await userEvent.click(within(dialog).getByRole("button", { name: COPY.save }));
    expect(await within(dialog).findByText(/empiece por http/)).toBeVisible();
    expect(screen.getByRole("dialog")).toBeVisible();
  });
});

describe("focus", () => {
  test("«Quitar» hands focus to the next row's «Quitar» in its own list, never to the page", async () => {
    vi.mocked(removeRecipe).mockResolvedValue(ok(AVENA));
    render(<Screen />);
    const list = within(section("list"));
    // Avena is the first of the list; Pollo al horno is next.
    await userEvent.click(list.getByRole("button", { name: COPY.removeName("Avena") }));
    await screen.findByText(COPY.removed("Avena"));
    expect(list.getByRole("button", { name: COPY.removeName("Pollo al horno") })).toHaveFocus();
  });

  test("removing the last recipe leaves focus on «Añadir receta»", async () => {
    vi.mocked(removeRecipe).mockResolvedValue(ok(POLLO));
    render(<Screen recipes={[POLLO]} />);
    await userEvent.click(screen.getByRole("button", { name: COPY.removeName("Pollo al horno") }));
    await screen.findByText(COPY.removed("Pollo al horno"));
    expect(screen.getByRole("button", { name: COPY.add })).toHaveFocus();
  });

  test("a refused removal puts focus back on that row's «Quitar»", async () => {
    vi.mocked(removeRecipe).mockResolvedValue(fail("No se pudo guardar."));
    render(<Screen />);
    const list = within(section("list"));
    await userEvent.click(list.getByRole("button", { name: COPY.removeName("Avena") }));
    await screen.findByText(COPY.notSavedTitle);
    await waitFor(() =>
      expect(list.getByRole("button", { name: COPY.removeName("Avena") })).toHaveFocus(),
    );
  });

  test("an edit that takes the recipe out of «Para hoy» doesn't strand focus on a detached key", async () => {
    vi.mocked(editRecipe).mockResolvedValue(ok({ ...AVENA, weekdays: [OTHER_WD] }));
    const { rerender } = render(<Screen />);
    const opener = within(section("today")).getByRole("button", { name: COPY.editName("Avena") });
    await userEvent.click(opener);
    const dialog = await screen.findByRole("dialog", { name: COPY.sheetEditTitle });
    await userEvent.click(within(dialog).getByRole("button", { name: WEEKDAY_LABELS[WD - 1] }));
    await userEvent.click(within(dialog).getByRole("button", { name: COPY.save }));
    await waitFor(() => expect(editRecipe).toHaveBeenCalled());
    // The server now says it is no longer for today: the opener unmounts with its row.
    rerender(<Screen recipes={[TALLARINES, { ...AVENA, weekdays: [OTHER_WD] }, POLLO]} />);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // Focus goes to that recipe's «Editar» in the list it is still in, not to the page.
    await waitFor(() =>
      expect(
        within(section("list")).getByRole("button", { name: COPY.editName("Avena") }),
      ).toHaveFocus(),
    );
  });

  test("a saved recipe is announced once the sheet has closed", async () => {
    vi.mocked(addRecipe).mockResolvedValue(ok(R(7, "Sopa", [], [])));
    render(<Screen recipes={[]} />);
    await userEvent.click(screen.getByRole("button", { name: COPY.add }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText(COPY.nameLabel), "Sopa");
    await userEvent.click(within(dialog).getByRole("button", { name: COPY.save }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() =>
      expect(document.querySelector("[data-screen-announcer]")).toHaveTextContent(
        COPY.added("Sopa"),
      ),
    );
  });
});
