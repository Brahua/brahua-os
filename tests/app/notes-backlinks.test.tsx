// N2 of `notes`: «Mencionado en N notas» (`<NoteMentions>`, the root the five detail pages render)
// and the list it shares with «Enlazada desde»; the picker's merge of every source (at most 8, in
// turns, grouped in the sources' order); and the name-search helpers every source uses.
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ACCENTED, escapeLike, PLAIN } from "@/lib/link-search";
import { NoteMentions } from "@/lib/note-extensions";
import { foldSearchText } from "@/lib/text";
import { getNoteMentions, type NoteLinkSource } from "@/modules/notes/contracts";
import { NOTES_COPY as COPY } from "@/modules/notes/copy";
import { searchLinkTargets } from "@/modules/notes/links";

vi.mock("@/modules/notes/contracts", () => ({
  getNoteMentions: vi.fn(),
  getTodayNoteState: vi.fn(),
}));

const PROJECT = "00000000-0000-4000-8000-000000000101";

beforeEach(() => {
  vi.mocked(getNoteMentions).mockReset();
});

describe("<NoteMentions>", () => {
  test("«Mencionado en 2 notas» with a link to each note (a daily note by its date, marked)", async () => {
    vi.mocked(getNoteMentions).mockResolvedValue([
      { id: "n1", kind: "daily", name: "Lunes 3 de noviembre", href: "/notes/2026-11-03" },
      { id: "n2", kind: "page", name: "Apuntes IAM", href: "/notes/n2" },
    ]);
    render(await NoteMentions({ type: "project", id: PROJECT, className: "max-w-160" }));
    expect(getNoteMentions).toHaveBeenCalledWith("project", PROJECT);
    const section = screen.getByRole("region", { name: "Mencionado en 2 notas" });
    expect(section).toHaveClass("max-w-160");
    const rows = within(section).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByRole("link", { name: "Lunes 3 de noviembre" })).toHaveAttribute(
      "href",
      "/notes/2026-11-03",
    );
    expect(rows[0]).toHaveTextContent(COPY.linkDailyHint);
    expect(within(rows[1]).getByRole("link", { name: "Apuntes IAM" })).toHaveAttribute(
      "href",
      "/notes/n2",
    );
    expect(rows[1]).not.toHaveTextContent(COPY.linkDailyHint);
  });

  test("one mention is singular; none renders nothing", async () => {
    vi.mocked(getNoteMentions).mockResolvedValue([
      { id: "n1", kind: "page", name: "Ideas", href: "/notes/n1" },
    ]);
    const { unmount } = render(await NoteMentions({ type: "task", id: PROJECT }));
    expect(screen.getByRole("heading", { name: "Mencionado en 1 nota" })).toBeInTheDocument();
    unmount();

    vi.mocked(getNoteMentions).mockResolvedValue([]);
    const { container } = render(await NoteMentions({ type: "habit", id: PROJECT }));
    expect(container).toBeEmptyDOMElement();
  });
});

function source(
  type: NoteLinkSource["type"],
  names: string[],
  calls: { q: string; limit: number }[] = [],
): NoteLinkSource {
  return {
    type,
    label: COPY.linkTypeLabels[type],
    search: async (_db, q, limit) => {
      calls.push({ q, limit });
      return names.map((name, index) => ({ id: `${type}-${index}`, name }));
    },
    resolve: async () => [],
  };
}

describe("searchLinkTargets (the picker's merge)", () => {
  test("every source is asked for 8; at most 8 in all, taken in turns, grouped in order", async () => {
    const calls: { q: string; limit: number }[] = [];
    const groups = await searchLinkTargets(
      {} as never,
      [
        source("note", [], calls),
        source("project", ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8"], calls),
        source("task", ["T1", "T2", "T3", "T4", "T5", "T6"], calls),
        source("goal", ["G1"], calls),
      ],
      "ru",
    );
    expect(calls).toEqual(Array.from({ length: 4 }, () => ({ q: "ru", limit: 8 })));
    expect(groups.map((group) => [group.type, group.items.map((item) => item.name)])).toEqual([
      ["project", ["P1", "P2", "P3", "P4"]],
      ["task", ["T1", "T2", "T3"]],
      ["goal", ["G1"]],
    ]);
    expect(groups[0]).toMatchObject({ label: "Proyectos" });
    expect(groups[0].items[0]).toEqual({ id: "project-0", name: "P1", hint: null });
  });

  test("a single type can fill the list; blank text asks nobody", async () => {
    const calls: { q: string; limit: number }[] = [];
    const many = Array.from({ length: 12 }, (_, index) => `N${index}`);
    const groups = await searchLinkTargets({} as never, [source("note", many, calls)], "n");
    expect(groups[0].items).toHaveLength(8);
    expect(await searchLinkTargets({} as never, [source("note", many, calls)], "   ")).toEqual([]);
    expect(calls).toHaveLength(1);
  });
});

describe("name search helpers", () => {
  test("the typed text is folded like the column: no accents, lowercase, single spaces", () => {
    expect(foldSearchText("  Educación   FÍSICA  Ñandú ")).toBe("educacion fisica nandu");
  });

  test("the SQL fold maps each accented letter to its plain one (same length, same folding)", () => {
    expect([...ACCENTED]).toHaveLength([...PLAIN].length);
    const mismatches = [...ACCENTED].filter(
      (letter, index) => foldSearchText(letter) !== PLAIN[index],
    );
    expect(mismatches).toEqual([]);
  });

  test("LIKE wildcards typed by the owner match themselves", () => {
    expect(escapeLike("100%_a\\b")).toBe("100\\%\\_a\\\\b");
    expect(escapeLike("ruta")).toBe("ruta");
  });
});
