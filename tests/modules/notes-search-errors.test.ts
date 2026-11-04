// N4 of `notes` (security review): a failing search never sends the words searched to the logs or to
// the page. Drizzle's error carries the query's parameters; `searchNotes` logs only the error's name
// and code (`describeError`) and throws a new error without `cause`. Also: the limit is capped and
// a capped page offers no «Ver más».
import { beforeEach, describe, expect, test, vi } from "vitest";
import { searchNotes } from "@/modules/notes/queries";
import { SEARCH_MAX_SHOWN } from "@/modules/notes/search";
import { selectNoteSearch } from "@/modules/notes/search-data";

vi.mock("@/lib/auth", () => ({ requireOwner: vi.fn(async () => undefined) }));
vi.mock("@/lib/db", () => ({ getDb: vi.fn(() => ({})) }));
vi.mock("@/modules/notes/search-data", () => ({ selectNoteSearch: vi.fn() }));

const SECRET = "presupuestosecreto";
const filter = { text: SECRET, kind: "all" as const, areaId: null, shown: 30 };

beforeEach(() => {
  vi.mocked(selectNoteSearch).mockReset();
});

describe("searchNotes", () => {
  test("a failing query logs its name and code, never the words; the page gets no cause", async () => {
    vi.mocked(selectNoteSearch).mockRejectedValue(
      Object.assign(new Error(`Failed query: select … params: ${SECRET}:*,${SECRET}:*`), {
        cause: Object.assign(new Error(`syntax error near "${SECRET}"`), {
          code: "57014",
          detail: SECRET,
        }),
      }),
    );
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const error = await searchNotes(filter).then(
        () => null,
        (thrown: unknown) => thrown as Error,
      );
      expect(error?.message).toBe("notes_search_failed");
      expect(error?.cause).toBeUndefined();
      expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain(SECRET);
      const logged = spy.mock.calls.map((call) => JSON.stringify(call)).join("\n");
      expect(logged).toContain("notes_search_failed");
      expect(logged).toContain("57014");
      expect(logged).not.toContain(SECRET);
    } finally {
      spy.mockRestore();
    }
  });

  test("the limit never passes the cap, and a capped page offers no «Ver más»", async () => {
    vi.mocked(selectNoteSearch).mockResolvedValue({ items: [], more: true });
    expect(await searchNotes({ ...filter, shown: 3_000 })).toEqual({ items: [], more: false });
    expect(vi.mocked(selectNoteSearch).mock.calls[0][1].limit).toBe(SEARCH_MAX_SHOWN);
    // Positive control: under the cap, «más» comes through.
    expect(await searchNotes({ ...filter, shown: 60 })).toEqual({ items: [], more: true });
    expect(vi.mocked(selectNoteSearch).mock.calls[1][1].limit).toBe(60);
  });

  test("a text with no word to search never queries", async () => {
    expect(await searchNotes({ ...filter, text: "a b &" })).toEqual({ items: [], more: false });
    expect(selectNoteSearch).not.toHaveBeenCalled();
  });

  test("an area id that is not a uuid doesn't filter", async () => {
    vi.mocked(selectNoteSearch).mockResolvedValue({ items: [], more: false });
    await searchNotes({ ...filter, areaId: "nope" });
    expect(vi.mocked(selectNoteSearch).mock.calls[0][1].areaId).toBeNull();
  });
});
