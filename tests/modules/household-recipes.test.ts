// H3 of `household`: the pure rules of the recipes: the link, the Zod inputs, the filters in the
// URL and «Para hoy».
import { describe, expect, test } from "vitest";
import { acceptableRecipeUrl, recipeDomain } from "@/modules/household/recipe-url";
import { addRecipeInputSchema, editRecipeInputSchema } from "@/modules/household/recipe-input";
import {
  filterRecipes,
  isoWeekday,
  mealsText,
  parseDay,
  parseMeal,
  recipesForToday,
  type RecipeItem,
} from "@/modules/household/recipe-view";
import { recipesPath } from "@/modules/household/routes";

describe("the link", () => {
  test.each(["https://cookpad.com/receta/1", "http://example.com", "  https://example.com/x  "])(
    "%s is accepted (trimmed)",
    (value) => {
      expect(acceptableRecipeUrl(value)).toBe(value.trim());
    },
  );

  test("the scheme is stored in lowercase, because the table's CHECK is case-sensitive", () => {
    expect(acceptableRecipeUrl("HTTPS://Example.com/a?b=c#d")).toBe("https://Example.com/a?b=c#d");
    expect(acceptableRecipeUrl("HtTp://x.co")).toBe("http://x.co");
    expect(addRecipeInputSchema.parse({ name: "Sopa", url: "HTTPS://Cookpad.com/x" }).url).toBe(
      "https://Cookpad.com/x",
    );
  });

  test.each([
    "",
    "   ",
    "javascript:alert(1)",
    "JAVASCRIPT:alert(1)",
    "data:text/html,<script>1</script>",
    "ftp://example.com",
    "file:///etc/passwd",
    "//example.com",
    "example.com",
    "https://",
    "https:// example.com",
    "https://example.com/a b",
    "https://example.com/a\u0000b",
    "https://example.com/a\u0007b",
    "https://example.com/a\u007fb",
    "https://user:pass@example.com",
    "https://tienda.com@evil.example",
    `https://example.com/${"x".repeat(2000)}`,
  ])("%j is refused", (value) => {
    expect(acceptableRecipeUrl(value)).toBeNull();
  });

  test("the domain to show drops www and is null for a bad link", () => {
    expect(recipeDomain("https://www.cookpad.com/receta/1")).toBe("cookpad.com");
    expect(recipeDomain("http://sub.example.org/x")).toBe("sub.example.org");
    expect(recipeDomain("javascript:alert(1)")).toBeNull();
  });
});

describe("the recipe input", () => {
  test("normalizes the name, dedupes and orders the meals and the days, trims the link", () => {
    const parsed = addRecipeInputSchema.parse({
      name: "  Arroz   con pollo ",
      mealTypes: ["dinner", "lunch", "dinner"],
      weekdays: [7, 1, 1, 3],
      url: " https://example.com/r ",
    });
    expect(parsed).toEqual({
      name: "Arroz con pollo",
      mealTypes: ["lunch", "dinner"],
      weekdays: [1, 3, 7],
      url: "https://example.com/r",
    });
  });

  test("everything but the name is optional; an empty link means none", () => {
    expect(addRecipeInputSchema.parse({ name: "Sopa" })).toEqual({
      name: "Sopa",
      mealTypes: [],
      weekdays: [],
      url: null,
    });
    expect(addRecipeInputSchema.parse({ name: "Sopa", url: "" }).url).toBeNull();
    expect(addRecipeInputSchema.parse({ name: "Sopa", url: "  " }).url).toBeNull();
  });

  test("refuses what the table can't hold", () => {
    const bad = (patch: object) =>
      addRecipeInputSchema.safeParse({ name: "Sopa", ...patch }).success;
    expect(bad({ name: "   " })).toBe(false);
    expect(bad({ name: "x".repeat(121) })).toBe(false);
    expect(bad({ name: "So‮pa" })).toBe(false);
    expect(bad({ mealTypes: ["brunch"] })).toBe(false);
    expect(bad({ weekdays: [0] })).toBe(false);
    expect(bad({ weekdays: [8] })).toBe(false);
    expect(bad({ weekdays: [1.5] })).toBe(false);
    expect(bad({ url: "javascript:alert(1)" })).toBe(false);
    expect(bad({ url: "https://user:pw@example.com" })).toBe(false);
    // Positive control: the limits themselves pass.
    expect(
      bad({
        name: "x".repeat(120),
        mealTypes: ["breakfast"],
        weekdays: [1, 7],
        url: "https://a.co",
      }),
    ).toBe(true);
  });

  test("an edit needs the id", () => {
    expect(editRecipeInputSchema.safeParse({ name: "Sopa" }).success).toBe(false);
    expect(
      editRecipeInputSchema.safeParse({ id: "00000000-0000-4000-8000-000000000001", name: "Sopa" })
        .success,
    ).toBe(true);
  });
});

const R = (
  n: number,
  name: string,
  mealTypes: RecipeItem["mealTypes"],
  weekdays: number[],
): RecipeItem => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  name,
  mealTypes,
  weekdays,
  url: null,
});

describe("filters and «Para hoy»", () => {
  const recipes = [
    R(1, "Tallarines", ["lunch"], [1, 4]),
    R(2, "Avena", ["breakfast"], [1, 2, 3, 4, 5]),
    R(3, "Pollo al horno", ["lunch", "dinner"], [7]),
    R(4, "Sin días", [], []),
  ];

  test("the URL's values are parsed strictly", () => {
    expect(parseMeal("lunch")).toBe("lunch");
    expect(parseMeal("brunch")).toBeNull();
    expect(parseMeal(["lunch"])).toBeNull();
    expect(parseMeal(undefined)).toBeNull();
    expect(parseDay("3")).toBe(3);
    expect(parseDay("0")).toBeNull();
    expect(parseDay("8")).toBeNull();
    expect(parseDay("10")).toBeNull();
    expect(parseDay("x")).toBeNull();
  });

  test("a meal and a day filter together, and with none every recipe shows, by name", () => {
    expect(filterRecipes(recipes, null, null).map((r) => r.name)).toEqual([
      "Avena",
      "Pollo al horno",
      "Sin días",
      "Tallarines",
    ]);
    expect(filterRecipes(recipes, "lunch", null).map((r) => r.name)).toEqual([
      "Pollo al horno",
      "Tallarines",
    ]);
    expect(filterRecipes(recipes, null, 1).map((r) => r.name)).toEqual(["Avena", "Tallarines"]);
    expect(filterRecipes(recipes, "lunch", 1).map((r) => r.name)).toEqual(["Tallarines"]);
    expect(filterRecipes(recipes, "snack", null)).toEqual([]);
  });

  test("«Para hoy» follows the weekday of the Lima day, Sunday included", () => {
    expect(isoWeekday("2026-10-12")).toBe(1); // Monday
    expect(isoWeekday("2026-10-18")).toBe(7); // Sunday
    expect(recipesForToday(recipes, "2026-10-12").map((r) => r.name)).toEqual([
      "Avena",
      "Tallarines",
    ]);
    expect(recipesForToday(recipes, "2026-10-18").map((r) => r.name)).toEqual(["Pollo al horno"]);
    expect(recipesForToday(recipes, "2026-10-17")).toEqual([]); // Saturday: nothing
  });

  test("the meals as words, in the order of the day", () => {
    expect(mealsText({ mealTypes: ["dinner", "breakfast"] })).toBe("Desayuno · Cena");
    expect(mealsText({ mealTypes: [] })).toBe("");
  });

  test("the filters' URL keeps what is set", () => {
    expect(recipesPath()).toBe("/household?vista=recetas");
    expect(recipesPath("lunch")).toBe("/household?vista=recetas&tipo=lunch");
    expect(recipesPath(null, 3)).toBe("/household?vista=recetas&dia=3");
    expect(recipesPath("dinner", 7)).toBe("/household?vista=recetas&tipo=dinner&dia=7");
  });
});
