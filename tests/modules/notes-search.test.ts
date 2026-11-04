// N4 of `notes`: the pure half of the search (src/modules/notes/search.ts). The words sent to
// Postgres are only letters and numbers (tsquery operators, quotes and emoji split words and never
// reach the query), at most 8, each a prefix; fewer than 2 characters in all is no search. The
// fragment splits at the private-use markers (unclosed, missing, stray, nested) into text and marks,
// without Markdown's marks. The list's URL carries `?q=`.
import { describe, expect, test } from "vitest";
import { notesListUrl } from "@/modules/notes/note-list";
import {
  fragmentParts,
  HEADLINE_CLOSE as C,
  HEADLINE_OPEN as O,
  prefixOperand,
  SEARCH_MAX_WORDS,
  SEARCH_QUERY_MAX_LENGTH,
  searchTextFromParam,
  searchWords,
} from "@/modules/notes/search";

describe("searchWords", () => {
  test("keeps runs of letters and numbers, accents included", () => {
    expect(searchWords("políticas de IAM")).toEqual(["políticas", "de", "IAM"]);
    expect(searchWords("año 2026")).toEqual(["año", "2026"]);
    expect(searchWords("Ñandú")).toEqual(["Ñandú"]);
  });

  test.each([
    ["quotes", `"polit" 'gim'`, ["polit", "gim"]],
    ["&", "polit & gim", ["polit", "gim"]],
    ["|", "polit|gim", ["polit", "gim"]],
    ["!", "!polit", ["polit"]],
    [":", "polit:* gim:A", ["polit", "gim", "A"]],
    ["'", "o'neil", ["o", "neil"]],
    ["(", "(polit) (gim", ["polit", "gim"]],
    ["<->", "polit <-> gim <2> x", ["polit", "gim", "2", "x"]],
    ["backslash", "polit\\gim", ["polit", "gim"]],
    ["SQL", "x'; drop table notes; --", ["x", "drop", "table", "notes"]],
    ["emoji", "🙂 polit 🎉gim", ["polit", "gim"]],
    ["underscore and dash", "snake_case kebab-case", ["snake", "case", "kebab", "case"]],
  ])("%s only split words", (_, text, words) => {
    expect(searchWords(text)).toEqual(words);
    for (const word of searchWords(text)) expect(word).toMatch(/^[\p{L}\p{N}]+$/u);
  });

  test("an accent typed as a separate mark joins its letter (NFC)", () => {
    expect(searchWords("políticas")).toEqual(["políticas"]);
  });

  test("at most 8 words: the ninth and later are ignored", () => {
    const words = "uno dos tres cuatro cinco seis siete ocho nueve diez";
    expect(searchWords(words)).toHaveLength(SEARCH_MAX_WORDS);
    expect(searchWords(words).at(-1)).toBe("ocho");
  });

  test("fewer than 2 letters or numbers in all is no search", () => {
    expect(searchWords("")).toEqual([]);
    expect(searchWords("p")).toEqual([]);
    expect(searchWords(" & | ! : ")).toEqual([]);
    expect(searchWords("🙂🙂🙂")).toEqual([]);
    // Two characters, even in two words, are enough.
    expect(searchWords("p")).toEqual([]);
    expect(searchWords("a b")).toEqual(["a", "b"]);
    expect(searchWords("ab")).toEqual(["ab"]);
  });

  test("a very long word is cut (a prefix of itself) and the text is read up to its maximum", () => {
    expect(searchWords("a".repeat(80))).toEqual(["a".repeat(50)]);
    const text = `${"x".repeat(SEARCH_QUERY_MAX_LENGTH)} tail`;
    expect(searchWords(text)).toEqual(["x".repeat(50)]);
  });

  test("each word is a prefix operand", () => {
    expect(prefixOperand("polit")).toBe("polit:*");
  });
});

describe("searchTextFromParam", () => {
  test("trims, cuts and turns a missing value into empty", () => {
    expect(searchTextFromParam(null)).toBe("");
    expect(searchTextFromParam("  polit  ")).toBe("polit");
    expect(searchTextFromParam("y".repeat(300))).toHaveLength(SEARCH_QUERY_MAX_LENGTH);
  });
});

describe("fragmentParts", () => {
  test("splits at the markers into text and marks", () => {
    expect(fragmentParts(`Las ${O}políticas${C} de IAM`)).toEqual([
      { text: "Las ", mark: false },
      { text: "políticas", mark: true },
      { text: " de IAM", mark: false },
    ]);
  });

  test("no markers: one plain part; empty: nothing", () => {
    expect(fragmentParts("Solo texto")).toEqual([{ text: "Solo texto", mark: false }]);
    expect(fragmentParts("")).toEqual([]);
    expect(fragmentParts("   ")).toEqual([]);
  });

  test("an unclosed marker marks to the end; a stray closing one is dropped", () => {
    expect(fragmentParts(`a ${O}b c`)).toEqual([
      { text: "a ", mark: false },
      { text: "b c", mark: true },
    ]);
    expect(fragmentParts(`a ${C}b`)).toEqual([{ text: "a b", mark: false }]);
  });

  test("nested or repeated openings count as one; adjacent marks join", () => {
    expect(fragmentParts(`${O}${O}x${C}${C} y`)).toEqual([
      { text: "x", mark: true },
      { text: " y", mark: false },
    ]);
    expect(fragmentParts(`${O}a${C}${O}b${C}`)).toEqual([{ text: "ab", mark: true }]);
  });

  test("Markdown's marks go, spaces collapse and the ends are trimmed", () => {
    expect(
      fragmentParts(`## Título\n- [ ] las **${O}políticas${C}** de \`IAM\`\n> cita  final `),
    ).toEqual([
      { text: "Título las ", mark: false },
      { text: "políticas", mark: true },
      { text: " de IAM cita final", mark: false },
    ]);
  });

  test("a mark that is only Markdown or spaces disappears", () => {
    expect(fragmentParts(`a ${O}**${C} b`)).toEqual([{ text: "a b", mark: false }]);
  });

  test("text that looks like HTML stays text", () => {
    expect(fragmentParts(`<b>${O}x${C}</b>`)).toEqual([
      { text: "<b>", mark: false },
      { text: "x", mark: true },
      { text: "</b>", mark: false },
    ]);
  });
});

describe("notesListUrl with a search", () => {
  test("?q= goes first, trimmed, with the filters and the page", () => {
    expect(notesListUrl({ kind: "all", areaId: null, q: " polit " })).toBe("/notes?q=polit");
    expect(notesListUrl({ kind: "daily", areaId: "a1", shown: 60, q: "gim & co" })).toBe(
      "/notes?q=gim+%26+co&tipo=diario&area=a1&n=60",
    );
    expect(notesListUrl({ kind: "all", areaId: null, q: "   " })).toBe("/notes");
  });
});
