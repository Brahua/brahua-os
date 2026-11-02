// L3 of `learning`: the pure part of what it offers other modules. A track's share of its project
// (SPEC-learning "Proyecto": one unit like a task) and the composition root that registers its
// progress source by name (never a side-effect-only import, which the bundler would drop).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { trackShare } from "@/modules/learning/today-summary";

describe("trackShare", () => {
  test.each([
    ["half the syllabus", { kind: "course", status: "active", done: 20, total: 40 }, 0.5],
    ["nothing checked", { kind: "certification", status: "waiting", done: 0, total: 40 }, 0],
    [
      "every step checked but not finished",
      { kind: "book", status: "active", done: 3, total: 3 },
      1,
    ],
    ["finished, whatever is checked", { kind: "course", status: "done", done: 1, total: 40 }, 1],
    ["no syllabus yet", { kind: "course", status: "active", done: 0, total: 0 }, 0],
    ["a practice", { kind: "practice", status: "active", done: 0, total: 0 }, 0],
    ["a finished practice", { kind: "practice", status: "done", done: 0, total: 0 }, 1],
    ["a bad pair never passes one", { kind: "course", status: "active", done: 9, total: 3 }, 1],
  ] as const)("%s", (_, track, share) => {
    expect(trackShare(track)).toBe(share);
  });
});

describe("composition root", () => {
  test("src/lib/progress-sources.ts registers learning's source by name", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../../src/lib/progress-sources.ts"),
      "utf8",
    );
    expect(source).toMatch(
      /import \{ learningProgressSource \} from "@\/modules\/learning\/progress-source";/,
    );
    expect(source).toMatch(/SOURCES: readonly ProgressSource\[\] = \[[^\]]*learningProgressSource/);
  });
});
