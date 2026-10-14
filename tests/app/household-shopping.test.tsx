// `household` H2: the shopping list as the owner uses it, against a fake server. The Server Actions
// are mocked; the screen's queue, notices, optimistic overrides and focus handling are the real ones.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { fail, ok } from "@/lib/action-result";
import { ownerDateKey } from "@/lib/time";
import { ScreenServicesProvider } from "@/modules/core/components/screen-services";
import { ShoppingScreen } from "@/modules/household/components/shopping-screen";
import {
  addShoppingProduct,
  changeProductQuantity,
  finishShoppingTrip,
  forgetShoppingProduct,
  markProductBought,
  removeProductFromShoppingList,
  undoFinishShoppingTrip,
  undoForgetProduct,
  undoRemoveProduct,
} from "@/modules/household/shopping-actions";
import { SHOPPING_COPY as COPY } from "@/modules/household/shopping-copy";
import type { ShoppingProduct } from "@/modules/household/shopping-view";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
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

const TODAY = ownerDateKey(new Date());
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const P = (
  n: number,
  name: string,
  category: ShoppingProduct["category"],
  status: ShoppingProduct["status"],
  quantity: string | null = null,
): ShoppingProduct => ({ id: id(n), name, category, quantity, status });

const ZANAHORIA = P(1, "Zanahoria", "verduras", "needed");
const POLLO = P(2, "Pollo", "carnes", "needed", "1 kg");
const LECHE = P(3, "Leche", "lacteos", "bought");
const CAFE = P(4, "Café", "otros", "idle");
const ARROZ = P(5, "Arroz", "otros", "idle");

function Screen({
  products = [ZANAHORIA, POLLO, LECHE, CAFE, ARROZ],
}: {
  products?: ShoppingProduct[];
}) {
  return (
    <ScreenServicesProvider
      label={COPY.noticesLabel}
      actionHint={COPY.undoHint}
      day={{ today: TODAY, changedMessage: "Empezó un día nuevo." }}
    >
      <ShoppingScreen products={products} />
    </ScreenServicesProvider>
  );
}

const rowOf = (p: ShoppingProduct) =>
  document.querySelector<HTMLElement>(`[data-shopping-row="${p.id}"]`);
const boughtKey = (p: ShoppingProduct) =>
  screen.getByRole("button", { name: COPY.boughtName(p.name) });

const ALL = [
  addShoppingProduct,
  markProductBought,
  changeProductQuantity,
  removeProductFromShoppingList,
  undoRemoveProduct,
  forgetShoppingProduct,
  undoForgetProduct,
  finishShoppingTrip,
  undoFinishShoppingTrip,
];

beforeEach(() => {
  for (const action of ALL) vi.mocked(action).mockReset();
});

describe("what it shows", () => {
  test("the list by category in walking order, the checked-off apart and the known ones tucked away", () => {
    render(<Screen />);
    const sections = [...document.querySelectorAll<HTMLElement>("[data-shopping-category]")];
    expect(sections.map((section) => section.dataset.shoppingCategory)).toEqual([
      "verduras",
      "carnes",
    ]);
    expect(within(rowOf(POLLO)!).getByLabelText(COPY.quantityName("Pollo"))).toHaveValue("1 kg");
    const bought = document.querySelector<HTMLElement>("[data-shopping-bought]")!;
    expect(within(bought).getByText("Leche")).toBeInTheDocument();
    expect(within(bought).getByText(COPY.boughtCount(1))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: COPY.finish })).toBeVisible();
    const saved = document.querySelector<HTMLElement>("[data-shopping-saved]")!;
    expect(within(saved).getByText("Café")).toBeInTheDocument();
    expect(within(saved).getByText("Arroz")).toBeInTheDocument();
  });

  test("an empty list says so and offers to add", () => {
    render(<Screen products={[]} />);
    expect(screen.getByText(COPY.emptyTitle)).toBeVisible();
    expect(screen.getByRole("textbox", { name: COPY.nameLabel })).toBeVisible();
    expect(screen.getByRole("button", { name: COPY.finishNone })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });
});

describe("«Comprado»", () => {
  test("the product leaves the list at once and goes to «Comprados»; focus lands on the next row", async () => {
    vi.mocked(markProductBought).mockResolvedValue(ok({ ...ZANAHORIA, status: "bought" }));
    render(<Screen />);
    await userEvent.click(boughtKey(ZANAHORIA));
    expect(markProductBought).toHaveBeenCalledWith({ id: ZANAHORIA.id, bought: true });
    const bought = document.querySelector<HTMLElement>("[data-shopping-bought]")!;
    expect(within(bought).getByText("Zanahoria")).toBeInTheDocument();
    expect(document.querySelector('[data-shopping-category="verduras"]')).toBeNull();
    await waitFor(() => expect(boughtKey(POLLO)).toHaveFocus());
  });

  test("a refusal puts it back and says it was not saved", async () => {
    vi.mocked(markProductBought).mockResolvedValue(fail("No se pudo guardar."));
    render(<Screen />);
    await userEvent.click(boughtKey(ZANAHORIA));
    expect(await screen.findByText(COPY.notSavedTitle)).toBeVisible();
    expect(document.querySelector('[data-shopping-category="verduras"]')).not.toBeNull();
  });

  test("a second tap on a product that is saving does nothing", async () => {
    let finish!: (value: ReturnType<typeof ok>) => void;
    vi.mocked(markProductBought).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve as typeof finish;
      }),
    );
    render(<Screen products={[ZANAHORIA]} />);
    await userEvent.click(boughtKey(ZANAHORIA));
    const again = screen.getByRole("button", { name: COPY.boughtName("Zanahoria") });
    expect(again).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(again);
    expect(markProductBought).toHaveBeenCalledTimes(1);
    finish(ok({ ...ZANAHORIA, status: "bought" }));
  });

  test("unchecking a bought product puts it back on the list", async () => {
    vi.mocked(markProductBought).mockResolvedValue(ok({ ...LECHE, status: "needed" }));
    render(<Screen />);
    await userEvent.click(screen.getByRole("button", { name: COPY.boughtName("Leche") }));
    expect(markProductBought).toHaveBeenCalledWith({ id: LECHE.id, bought: false });
    expect(document.querySelector('[data-shopping-category="lacteos"]')).not.toBeNull();
  });
});

describe("«Terminé la compra»", () => {
  test("clears what was bought, says how many and «Deshacer» carries each product with its time", async () => {
    const at = "2026-10-14T15:00:00.000Z";
    vi.mocked(finishShoppingTrip).mockResolvedValue(
      ok({ entries: [{ id: LECHE.id, boughtAt: at }] }),
    );
    vi.mocked(undoFinishShoppingTrip).mockResolvedValue(ok({ restored: [LECHE.id], kept: [] }));
    render(<Screen />);
    await userEvent.click(screen.getByRole("button", { name: COPY.finish }));
    expect(await screen.findByText(COPY.finished(1))).toBeVisible();
    expect(screen.getByRole("button", { name: COPY.finishNone })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await userEvent.click(screen.getByRole("button", { name: COPY.undo }));
    expect(undoFinishShoppingTrip).toHaveBeenCalledWith({
      entries: [{ id: LECHE.id, boughtAt: at }],
    });
    await waitFor(() => expect(screen.getByRole("button", { name: COPY.finish })).toBeVisible());
  });

  test("a partial undo says how many could not come back", async () => {
    const at = "2026-10-14T15:00:00.000Z";
    vi.mocked(finishShoppingTrip).mockResolvedValue(
      ok({ entries: [{ id: LECHE.id, boughtAt: at }] }),
    );
    vi.mocked(undoFinishShoppingTrip).mockResolvedValue(ok({ restored: [], kept: [LECHE.id] }));
    render(<Screen />);
    await userEvent.click(screen.getByRole("button", { name: COPY.finish }));
    await userEvent.click(await screen.findByRole("button", { name: COPY.undo }));
    expect(await screen.findByText(COPY.notRestored(1))).toBeVisible();
  });

  test("with nothing bought the key does nothing", async () => {
    render(<Screen products={[ZANAHORIA]} />);
    await userEvent.click(screen.getByRole("button", { name: COPY.finishNone }));
    expect(finishShoppingTrip).not.toHaveBeenCalled();
  });

  test("a refusal brings the bought products back", async () => {
    vi.mocked(finishShoppingTrip).mockResolvedValue(fail("No se pudo guardar."));
    render(<Screen />);
    await userEvent.click(screen.getByRole("button", { name: COPY.finish }));
    expect(await screen.findByText(COPY.notSavedTitle)).toBeVisible();
    expect(screen.getByRole("button", { name: COPY.finish })).toBeVisible();
  });
});

describe("adding", () => {
  test("a new name sends its category and quantity, clears the field and keeps focus in it", async () => {
    vi.mocked(addShoppingProduct).mockResolvedValue(
      ok({
        product: P(9, "Atún", "otros", "needed", "2 latas"),
        created: true,
        alreadyOnList: false,
      }),
    );
    render(<Screen products={[]} />);
    const name = screen.getByRole("textbox", { name: COPY.nameLabel });
    await userEvent.type(name, "  Atún ");
    await userEvent.selectOptions(screen.getByLabelText(COPY.categoryLabel), "carnes");
    await userEvent.type(screen.getByRole("textbox", { name: COPY.quantityLabel }), "2 latas");
    await userEvent.click(screen.getByRole("button", { name: COPY.add }));
    expect(addShoppingProduct).toHaveBeenCalledWith({
      name: "  Atún ",
      category: "carnes",
      quantity: "2 latas",
    });
    await waitFor(() => expect(name).toHaveValue(""));
    expect(name).toHaveFocus();
    expect(await screen.findByText(/Atún/)).toBeVisible();
  });

  test("an empty name is refused on its field and nothing is sent", async () => {
    render(<Screen />);
    await userEvent.click(screen.getByRole("button", { name: COPY.add }));
    expect(await screen.findByText("Escribe el nombre del producto.")).toBeVisible();
    expect(addShoppingProduct).not.toHaveBeenCalled();
  });

  test("typing shows what was bought before, and one tap puts it on the list with what it had", async () => {
    vi.mocked(addShoppingProduct).mockResolvedValue(
      ok({ product: { ...CAFE, status: "needed" }, created: false, alreadyOnList: false }),
    );
    render(<Screen />);
    await userEvent.type(screen.getByRole("textbox", { name: COPY.nameLabel }), "caf");
    const suggestion = await screen.findByRole("button", {
      name: COPY.suggestionName("Café", "Otros"),
    });
    await userEvent.click(suggestion);
    // Only the name travels: the server keeps the category and the quantity it knows.
    expect(addShoppingProduct).toHaveBeenCalledWith({ name: "Café" });
    expect(document.querySelector('[data-shopping-category="otros"]')).not.toBeNull();
  });

  test("a name that is already known sends no category, so it keeps its own", async () => {
    vi.mocked(addShoppingProduct).mockResolvedValue(
      ok({ product: { ...ARROZ, status: "needed" }, created: false, alreadyOnList: false }),
    );
    render(<Screen />);
    await userEvent.type(screen.getByRole("textbox", { name: COPY.nameLabel }), "ARROZ");
    expect(screen.queryByLabelText(COPY.categoryLabel)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: COPY.add }));
    expect(addShoppingProduct).toHaveBeenCalledWith({ name: "ARROZ" });
  });

  test("a name already on the list says so while typing", async () => {
    render(<Screen />);
    await userEvent.type(screen.getByRole("textbox", { name: COPY.nameLabel }), "pollo");
    expect(screen.getByText(COPY.alreadyOnList("Pollo"))).toBeVisible();
  });
});

describe("«Quitar», «Olvidar» and the quantity", () => {
  test("«Quitar» takes it off the list and «Deshacer» carries what it was", async () => {
    vi.mocked(removeProductFromShoppingList).mockResolvedValue(
      ok({
        product: { ...POLLO, status: "idle" },
        previousStatus: "needed",
        previousBoughtAt: null,
      }),
    );
    vi.mocked(undoRemoveProduct).mockResolvedValue(ok(POLLO));
    render(<Screen />);
    await userEvent.click(screen.getByRole("button", { name: COPY.removeName("Pollo") }));
    expect(document.querySelector('[data-shopping-category="carnes"]')).toBeNull();
    await userEvent.click(await screen.findByRole("button", { name: COPY.undo }));
    expect(undoRemoveProduct).toHaveBeenCalledWith({
      id: POLLO.id,
      previousStatus: "needed",
      boughtAt: null,
    });
    await waitFor(() =>
      expect(document.querySelector('[data-shopping-category="carnes"]')).not.toBeNull(),
    );
  });

  test("«Olvidar» forgets a known product and «Deshacer» brings it back", async () => {
    vi.mocked(forgetShoppingProduct).mockResolvedValue(ok(CAFE));
    vi.mocked(undoForgetProduct).mockResolvedValue(ok(CAFE));
    render(<Screen />);
    await userEvent.click(screen.getByText(COPY.savedTitle));
    await userEvent.click(screen.getByRole("button", { name: COPY.forgetName("Café") }));
    expect(forgetShoppingProduct).toHaveBeenCalledWith({ id: CAFE.id });
    expect(rowOf(CAFE)).toBeNull();
    await userEvent.click(await screen.findByRole("button", { name: COPY.undo }));
    expect(undoForgetProduct).toHaveBeenCalledWith({ id: CAFE.id });
    await waitFor(() => expect(rowOf(CAFE)).not.toBeNull());
  });

  test("the quantity saves on Enter only when it changed, and clears when emptied", async () => {
    vi.mocked(changeProductQuantity).mockResolvedValue(ok({ ...POLLO, quantity: "2 kg" }));
    render(<Screen />);
    const field = screen.getByLabelText(COPY.quantityName("Pollo"));
    // Unchanged: leaving the field sends nothing.
    await userEvent.click(field);
    await userEvent.tab();
    expect(changeProductQuantity).not.toHaveBeenCalled();
    await userEvent.clear(field);
    await userEvent.type(field, "2 kg{Enter}");
    expect(changeProductQuantity).toHaveBeenCalledWith({ id: POLLO.id, quantity: "2 kg" });
  });
});

describe("what the review found", () => {
  test("an old «Deshacer» of «Olvidar» shows what the server says now, not the snapshot", async () => {
    vi.mocked(forgetShoppingProduct).mockResolvedValue(ok(CAFE));
    // Meanwhile the owner put Café on the list: the server answers with it as needed.
    vi.mocked(undoForgetProduct).mockResolvedValue(ok({ ...CAFE, status: "needed" }));
    render(<Screen />);
    await userEvent.click(screen.getByText(COPY.savedTitle));
    await userEvent.click(screen.getByRole("button", { name: COPY.forgetName("Café") }));
    await userEvent.click(await screen.findByRole("button", { name: COPY.undo }));
    await waitFor(() =>
      expect(document.querySelector('[data-shopping-category="otros"]')).not.toBeNull(),
    );
    // It is on the list, not in «Productos guardados».
    expect(
      document
        .querySelector("[data-shopping-saved]")!
        .querySelector(`[data-shopping-row="${CAFE.id}"]`),
    ).toBeNull();
  });

  test("tapping a suggestion keeps focus in the add field, even with the saved list open", async () => {
    vi.mocked(addShoppingProduct).mockResolvedValue(
      ok({ product: { ...CAFE, status: "needed" }, created: false, alreadyOnList: false }),
    );
    render(<Screen />);
    await userEvent.click(screen.getByText(COPY.savedTitle));
    const name = screen.getByRole("textbox", { name: COPY.nameLabel });
    await userEvent.type(name, "caf");
    await userEvent.click(
      await screen.findByRole("button", { name: COPY.suggestionName("Café", "Otros") }),
    );
    await waitFor(() => expect(addShoppingProduct).toHaveBeenCalled());
    await waitFor(() =>
      expect(document.querySelector('[data-shopping-category="otros"]')).not.toBeNull(),
    );
    expect(name).toHaveFocus();
  });

  test("a quantity typed while the product is still saving is not shown as if it were saved", async () => {
    let finish!: (value: ReturnType<typeof ok>) => void;
    vi.mocked(markProductBought).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve as typeof finish;
      }),
    );
    render(<Screen products={[POLLO]} />);
    await userEvent.click(boughtKey(POLLO));
    const field = screen.getByLabelText(COPY.quantityName("Pollo"));
    await userEvent.clear(field);
    await userEvent.type(field, "5 kg");
    await userEvent.tab();
    expect(changeProductQuantity).not.toHaveBeenCalled();
    expect(field).toHaveValue("1 kg");
    finish(ok({ ...POLLO, status: "bought" }));
  });

  test("Enter in the quantity saves and keeps focus in the field", async () => {
    vi.mocked(changeProductQuantity).mockResolvedValue(ok({ ...POLLO, quantity: "2 kg" }));
    render(<Screen />);
    const field = screen.getByLabelText(COPY.quantityName("Pollo"));
    await userEvent.clear(field);
    await userEvent.type(field, "2 kg{Enter}");
    expect(changeProductQuantity).toHaveBeenCalledTimes(1);
    expect(field).toHaveFocus();
  });

  test("a refused quantity save does not pull focus away from where the owner is typing", async () => {
    vi.mocked(changeProductQuantity).mockResolvedValue(fail("No se pudo guardar."));
    render(<Screen />);
    const field = screen.getByLabelText(COPY.quantityName("Pollo"));
    await userEvent.clear(field);
    await userEvent.type(field, "9{Enter}");
    await screen.findByText(COPY.notSavedTitle);
    const name = screen.getByRole("textbox", { name: COPY.nameLabel });
    await userEvent.click(name);
    expect(name).toHaveFocus();
  });

  test("what is typed in the add field while it saves is not erased", async () => {
    let finish!: (value: ReturnType<typeof ok>) => void;
    vi.mocked(addShoppingProduct).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve as typeof finish;
      }),
    );
    render(<Screen products={[]} />);
    const name = screen.getByRole("textbox", { name: COPY.nameLabel });
    await userEvent.type(name, "Pan");
    await userEvent.click(screen.getByRole("button", { name: COPY.add }));
    await userEvent.type(name, "{Control>}a{/Control}Sal");
    finish(ok({ product: P(9, "Pan", "otros", "needed"), created: true, alreadyOnList: false }));
    await waitFor(() => expect(addShoppingProduct).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(name).toHaveValue("Sal"));
  });
});
