// T4: tag names (normalized like names, then lowercase; 1–30 characters as Postgres counts them;
// no commas, control or bidi characters), the set of a task (unique, at most 10), the filter's
// `?etiqueta=` and the suggestions.
import { describe, expect, test } from "vitest";
import { allViewHref, parseFilterParams, resolveFilters } from "@/modules/tasks/task-filters";
import { createTaskInputSchema, type TaskItem, type TaskTargets } from "@/modules/tasks/task-input";
import { matchesFilters, NO_FILTERS } from "@/modules/tasks/task-views";
import {
  normalizeTagName,
  setTaskTagsInputSchema,
  suggestTags,
  tagNameProblem,
  tagNameSchema,
  taskTagsSchema,
  TASK_TAGS_MAX,
} from "@/modules/tasks/task-tags";
import { TAGS_COPY } from "@/modules/tasks/tags-copy";

const ID = "00000000-0000-4000-8000-000000000001";

describe("normalizeTagName", () => {
  test.each([
    ["  Compras  ", "compras"],
    ["LIMPIEZA\tDE   casa\n", "limpieza de casa"],
    ["Educación", "educación"],
    // NFC: "e" + combining acute becomes one "é".
    ["café", "café"],
    ["ÑANDÚ", "ñandú"],
    // Lowercasing can decompose: NFC comes after it ("İ" → "i" + U+0307 stays two code points).
    ["İSTANBUL", "i\u0307stanbul"],
    // Final sigma in context; the titlecase digraph ǅ becomes ǆ.
    ["ΟΔΟΣ", "οδος".slice(0, 3) + "ς"],
    ["ǅemal", "ǆemal"],
  ])("%j → %j", (input, expected) => {
    expect(normalizeTagName(input)).toBe(expected);
  });
});

describe("tagNameSchema", () => {
  test("normalizes", () => {
    expect(tagNameSchema.parse("  Super   Mercado ")).toBe("super mercado");
  });

  test("1–30 characters, counted like Postgres (code points: an emoji is one)", () => {
    expect(tagNameSchema.safeParse("a".repeat(30)).success).toBe(true);
    expect(tagNameSchema.safeParse("a".repeat(31)).error?.issues[0]?.message).toBe(
      TAGS_COPY.errors.tooLong,
    );
    // 30 emoji are 60 UTF-16 units but 30 characters for char_length().
    expect(tagNameSchema.safeParse("🌱".repeat(30)).success).toBe(true);
    expect(tagNameSchema.safeParse("🌱".repeat(31)).success).toBe(false);
  });

  test.each([
    ["", TAGS_COPY.errors.empty],
    ["   ", TAGS_COPY.errors.empty],
    ["a,b", TAGS_COPY.errors.comma],
    ["a\u0000b", TAGS_COPY.errors.invisible],
    ["a​b", TAGS_COPY.errors.invisible],
    // Bidi overrides and isolates reorder the text.
    ["abc‮dcb", TAGS_COPY.errors.invisible],
    ["abc⁦x", TAGS_COPY.errors.invisible],
  ])("%j is refused", (input, message) => {
    expect(tagNameSchema.safeParse(input).error?.issues[0]?.message).toBe(message);
  });

  test("not a string, or absurdly long, is refused before normalizing", () => {
    expect(tagNameSchema.safeParse(3).success).toBe(false);
    expect(tagNameSchema.safeParse(" ".repeat(201)).success).toBe(false);
  });

  test("tagNameProblem says nothing about a fine name", () => {
    expect(tagNameProblem("compras")).toBeNull();
  });
});

describe("taskTagsSchema", () => {
  test("a set: duplicates after normalizing count once, in the order first given", () => {
    expect(taskTagsSchema.parse(["Hogar", "compras", " hogar ", "HOGAR"])).toEqual([
      "hogar",
      "compras",
    ]);
  });

  test("duplicates are dropped before counting: 11 sent, 10 distinct, is fine", () => {
    const ten = Array.from({ length: 10 }, (_, index) => `t${index}`);
    expect(taskTagsSchema.parse([...ten, "T0"])).toEqual(ten);
  });

  test(`at most ${TASK_TAGS_MAX}`, () => {
    const ten = Array.from({ length: 10 }, (_, index) => `t${index}`);
    expect(taskTagsSchema.parse(ten)).toHaveLength(10);
    expect(taskTagsSchema.safeParse([...ten, "t10"]).error?.issues[0]?.message).toBe(
      TAGS_COPY.errors.tooMany,
    );
  });

  test("an empty list clears them; one bad name refuses the whole set (with its path)", () => {
    expect(taskTagsSchema.parse([])).toEqual([]);
    const result = taskTagsSchema.safeParse(["ok", "a,b"]);
    expect(result.error?.issues[0]?.path).toEqual([1]);
  });

  test("not a list is refused", () => {
    expect(taskTagsSchema.safeParse("compras").error?.issues[0]?.message).toBe(
      TAGS_COPY.errors.list,
    );
  });
});

describe("setTaskTagsInputSchema and capture", () => {
  test("a uuid and the set", () => {
    expect(setTaskTagsInputSchema.parse({ id: ID, tags: ["A"] })).toEqual({ id: ID, tags: ["a"] });
    expect(setTaskTagsInputSchema.safeParse({ id: "x", tags: [] }).success).toBe(false);
    expect(setTaskTagsInputSchema.safeParse({ id: ID }).success).toBe(false);
  });

  test("the capture takes optional tags", () => {
    expect(createTaskInputSchema.parse({ title: "x" }).tags).toBeUndefined();
    expect(createTaskInputSchema.parse({ title: "x", tags: ["Compras"] }).tags).toEqual([
      "compras",
    ]);
    const refused = createTaskInputSchema.safeParse({ title: "x", tags: ["a".repeat(31)] });
    expect(refused.error?.issues[0]?.path).toEqual(["tags", 0]);
  });
});

describe("the tag filter of Todas (?etiqueta=<tagId>)", () => {
  const HOGAR = { id: ID, name: "hogar" };
  const COMPRAS = { id: "00000000-0000-4000-8000-000000000002", name: "compras" };
  const OLD = { id: "00000000-0000-4000-8000-000000000003", name: "vieja" };
  const TARGETS: TaskTargets = { areas: [], projects: [] };
  const item = (id: string, tags: { id: string; name: string }[]): TaskItem => ({
    id,
    title: id,
    priority: "medium",
    dueDate: null,
    dueTime: null,
    doneAt: null,
    createdAt: new Date(0),
    lifeAreaId: null,
    projectId: null,
    milestoneId: null,
    isNextAction: false,
    area: null,
    project: null,
    recurrence: null,
    tags,
  });
  const a = item("a", [HOGAR, COMPRAS]);
  const b = item("b", [HOGAR]);
  const c = item("c", []);
  const pending = [a, b, c];
  const none = { area: null, project: null, tagId: null };

  test("the URL: a uuid (lowercased), anything else is no filter", () => {
    expect(parseFilterParams({ etiqueta: ID.toUpperCase() }).tagId).toBe(ID);
    expect(parseFilterParams({ etiqueta: "compras" }).tagId).toBeNull();
    expect(parseFilterParams({ etiqueta: [ID, ID] }).tagId).toBeNull();
    expect(parseFilterParams({}).tagId).toBeNull();
  });

  test("offers the tags of the pending tasks, by name; filters by id", () => {
    const { filters, choices } = resolveFilters({ ...none, tagId: ID }, TARGETS, pending);
    expect(choices.tags).toEqual([COMPRAS, HOGAR]);
    expect(filters).toEqual({ ...NO_FILTERS, tagId: ID });
    expect(pending.filter((task) => matchesFilters(task, filters)).map((task) => task.id)).toEqual([
      "a",
      "b",
    ]);
  });

  test("an unknown id falls back to all", () => {
    const unknown = "00000000-0000-4000-8000-000000000009";
    expect(resolveFilters({ ...none, tagId: unknown }, TARGETS, pending).filters).toEqual(
      NO_FILTERS,
    );
  });

  test("the one in the URL stays offered once its last pending task is done", () => {
    const { filters, choices } = resolveFilters({ ...none, tagId: OLD.id }, TARGETS, pending, [
      HOGAR,
      OLD,
    ]);
    expect(choices.tags.map((tag) => tag.name)).toEqual(["compras", "hogar", "vieja"]);
    expect(filters.tagId).toBe(OLD.id);
    expect(pending.filter((task) => matchesFilters(task, filters))).toEqual([]);
  });

  test("links keep the area and the project; the id goes in through URLSearchParams", () => {
    expect(allViewHref({ area: "home", project: null, tagId: ID })).toBe(
      `/tasks?vista=todas&area=home&etiqueta=${ID}`,
    );
    expect(allViewHref({ ...none, tagId: null })).toBe("/tasks?vista=todas");
    // Even if a value ever needed encoding, it stays one parameter.
    const odd = new URL(allViewHref({ ...none, tagId: "a&b #1?" }), "http://x");
    expect(odd.searchParams.get("etiqueta")).toBe("a&b #1?");
  });
});

describe("suggestTags", () => {
  const known = ["hogar", "compras", "salud", "comida", "trabajo", "casa", "bicicleta"];

  test("with nothing typed, the first ones (the most used) not chosen yet", () => {
    expect(suggestTags(known, "", ["hogar"], 3)).toEqual(["compras", "salud", "comida"]);
  });

  test("those that start with it first, then those that contain it; never the chosen ones", () => {
    expect(suggestTags(known, "co", [])).toEqual(["compras", "comida"]);
    expect(suggestTags(["vaca", "boca", "casa"], "Ca", [])).toEqual(["casa", "vaca", "boca"]);
    expect(suggestTags(known, "a", ["casa"])).toEqual([
      "hogar",
      "compras",
      "salud",
      "comida",
      "trabajo",
      "bicicleta",
    ]);
    expect(suggestTags(known, "  COMP ", ["compras"])).toEqual([]);
  });

  test("at most `limit`", () => {
    expect(suggestTags(known, "a", [], 2)).toHaveLength(2);
  });
});
