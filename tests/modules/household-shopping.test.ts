// H2 of `household`: the pure rules of the shopping list: the product key, the Zod inputs, the
// grouping in walking order and the suggestions for the add field.
import { describe, expect, test } from "vitest";
import { productKey } from "@/modules/household/shopping-constants";
import {
  addProductInputSchema,
  restoreToListInputSchema,
  setQuantityInputSchema,
  undoFinishInputSchema,
} from "@/modules/household/shopping-input";
import {
  boughtProducts,
  findByName,
  groupByCategory,
  knownProducts,
  suggestionsFor,
  type ShoppingProduct,
} from "@/modules/household/shopping-view";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const product = (
  n: number,
  name: string,
  category: ShoppingProduct["category"],
  status: ShoppingProduct["status"],
  quantity: string | null = null,
): ShoppingProduct => ({ id: id(n), name, category, quantity, status });

describe("product key", () => {
  test("ignores accents, capitals and extra spaces", () => {
    expect(productKey("  Café   con LECHE ")).toBe("cafe con leche");
    expect(productKey("Añejo")).toBe("anejo");
    expect(productKey("Cafe")).toBe(productKey("café"));
  });
});

describe("«Añadir producto» input", () => {
  test("normalizes the name and a missing quantity stays missing", () => {
    const parsed = addProductInputSchema.parse({ name: "  Leche   entera " });
    expect(parsed).toEqual({ name: "Leche entera" });
    expect("quantity" in parsed).toBe(false);
    expect("category" in parsed).toBe(false);
  });

  test("an empty or blank quantity means none, a typed one is kept", () => {
    expect(addProductInputSchema.parse({ name: "Leche", quantity: "" }).quantity).toBeNull();
    expect(addProductInputSchema.parse({ name: "Leche", quantity: "   " }).quantity).toBeNull();
    expect(addProductInputSchema.parse({ name: "Leche", quantity: " 2  litros " }).quantity).toBe(
      "2 litros",
    );
  });

  test("refuses what the table can't hold", () => {
    const bad = (patch: object) =>
      addProductInputSchema.safeParse({ name: "Leche", ...patch }).success;
    expect(bad({ name: "   " })).toBe(false);
    expect(bad({ name: "x".repeat(81) })).toBe(false);
    expect(bad({ name: "Le‮che" })).toBe(false);
    expect(bad({ quantity: "x".repeat(31) })).toBe(false);
    expect(bad({ category: "ferreteria" })).toBe(false);
    // Positive control: the limits themselves pass.
    expect(bad({ name: "x".repeat(80), quantity: "x".repeat(30), category: "lacteos" })).toBe(true);
  });

  test("setting a quantity requires it to be there (a missing one is not «none»)", () => {
    expect(setQuantityInputSchema.safeParse({ id: id(1) }).success).toBe(false);
    expect(setQuantityInputSchema.parse({ id: id(1), quantity: "" }).quantity).toBeNull();
    expect(setQuantityInputSchema.parse({ id: id(1), quantity: "3" }).quantity).toBe("3");
  });

  test("«Deshacer» inputs: a bought product carries when, a needed one doesn't; ids are a set", () => {
    const at = "2026-10-14T15:00:00.000Z";
    expect(
      restoreToListInputSchema.safeParse({ id: id(1), previousStatus: "bought", boughtAt: at })
        .success,
    ).toBe(true);
    expect(
      restoreToListInputSchema.safeParse({ id: id(1), previousStatus: "needed", boughtAt: null })
        .success,
    ).toBe(true);
    expect(
      restoreToListInputSchema.safeParse({ id: id(1), previousStatus: "bought", boughtAt: null })
        .success,
    ).toBe(false);
    expect(
      restoreToListInputSchema.safeParse({ id: id(1), previousStatus: "needed", boughtAt: at })
        .success,
    ).toBe(false);
    const entry = { id: id(1), boughtAt: at };
    expect(
      undoFinishInputSchema.safeParse({ entries: [entry, { ...entry, id: id(2) }] }).success,
    ).toBe(true);
    expect(undoFinishInputSchema.safeParse({ entries: [entry, entry] }).success).toBe(false);
    expect(
      undoFinishInputSchema.safeParse({ entries: [{ id: id(1), boughtAt: "ayer" }] }).success,
    ).toBe(false);
    const many = Array.from({ length: 501 }, (_, n) => ({ id: id(n), boughtAt: at }));
    expect(undoFinishInputSchema.safeParse({ entries: many }).success).toBe(false);
  });
});

describe("the list", () => {
  const products = [
    product(1, "Jabón", "limpieza", "needed"),
    product(2, "Zanahoria", "verduras", "needed"),
    product(3, "Pollo", "carnes", "needed", "1 kg"),
    product(4, "Acelga", "verduras", "needed"),
    product(5, "Leche", "lacteos", "bought"),
    product(6, "Manzana", "frutas", "idle"),
    product(7, "Café", "otros", "idle"),
  ];

  test("on-list products by category in walking order, by name inside, with no empty section", () => {
    const groups = groupByCategory(products);
    expect(groups.map((group) => group.label)).toEqual(["Verduras", "Carnes", "Limpieza"]);
    expect(groups[0].products.map((p) => p.name)).toEqual(["Acelga", "Zanahoria"]);
    expect(groupByCategory([])).toEqual([]);
  });

  test("bought and known are apart from the list", () => {
    expect(boughtProducts(products).map((p) => p.name)).toEqual(["Leche"]);
    expect(knownProducts(products).map((p) => p.name)).toEqual(["Café", "Manzana"]);
  });
});

describe("suggestions", () => {
  const products = [
    product(1, "Leche", "lacteos", "idle"),
    product(2, "Leche de almendras", "productos_naturales", "idle"),
    product(3, "Cereal de leche", "otros", "idle"),
    product(4, "Lechuga", "verduras", "needed"),
    product(5, "Café", "otros", "idle"),
  ];

  test("only known products, the ones that start with it first, accents and capitals ignored", () => {
    expect(suggestionsFor(products, "lec").map((p) => p.name)).toEqual([
      "Leche",
      "Leche de almendras",
      "Cereal de leche",
    ]);
    expect(suggestionsFor(products, "CAFE").map((p) => p.name)).toEqual(["Café"]);
  });

  test("nothing for one letter, nothing without a match, and a cap of five", () => {
    expect(suggestionsFor(products, "l")).toEqual([]);
    expect(suggestionsFor(products, "zz")).toEqual([]);
    const many = Array.from({ length: 9 }, (_, n) => product(n, `Pan ${n}`, "otros", "idle"));
    expect(suggestionsFor(many, "pan")).toHaveLength(5);
  });

  test("findByName finds a product of any status by its key", () => {
    expect(findByName(products, " lechuga ")?.status).toBe("needed");
    expect(findByName(products, "CAFÉ")?.name).toBe("Café");
    expect(findByName(products, "")).toBeNull();
    expect(findByName(products, "té")).toBeNull();
  });
});
