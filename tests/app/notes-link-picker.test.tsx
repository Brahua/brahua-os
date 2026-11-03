// N2 of `notes`: the `[[` picker in the note editor (SPEC-notes "Selector `[[`"), against a fake
// search (the Server Action is a prop). It opens on `[[` + text, searches 150 ms after the last key,
// ignores answers to older text, moves with the arrows, chooses with Enter, Tab or a tap, closes with
// Esc without leaving the editor, keeps the focus in the field and leaves the cursor after the link,
// which the autosave then saves like any text.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ok, type ActionResult } from "@/lib/action-result";
import { ScreenServicesProvider } from "@/modules/core/components/screen-services";
import { saveNote } from "@/modules/notes/actions";
import type { NoteLinkGroup } from "@/modules/notes/contracts";
import { NoteBody } from "@/modules/notes/components/note-body";
import { NOTES_COPY as COPY } from "@/modules/notes/copy";
import { findLinkQuery, insertLink, parseDayQuery } from "@/modules/notes/note-link-search";

vi.mock("@/modules/notes/actions", () => ({
  saveDailyNote: vi.fn(),
  saveNote: vi.fn(),
  deleteNote: vi.fn(),
  restoreNote: vi.fn(),
  createNote: vi.fn(),
  renameNote: vi.fn(),
  setNoteArea: vi.fn(),
  pinNote: vi.fn(),
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const ID = "00000000-0000-4000-8000-000000000001";
const P1 = "00000000-0000-4000-8000-000000000101";
const P2 = "00000000-0000-4000-8000-000000000102";
const T1 = "00000000-0000-4000-8000-000000000201";

const GROUPS: NoteLinkGroup[] = [
  {
    type: "project",
    label: "Proyectos",
    items: [
      { id: P1, name: "Ruta AWS + IA", hint: null },
      { id: P2, name: "Rumbo 2027", hint: "Terminado" },
    ],
  },
  { type: "task", label: "Tareas", items: [{ id: T1, name: "Revisar ruta", hint: "Hecha" }] },
];

type Search = (input: { q: string }) => Promise<ActionResult<NoteLinkGroup[]>>;

function Body({ search, body = "" }: { search: Search; body?: string }) {
  return (
    <ScreenServicesProvider label={COPY.noticesLabel} actionHint={COPY.undoHint}>
      <NoteBody
        note={{ id: ID, body, version: 3 }}
        day={null}
        rendered={null}
        shortcuts={false}
        searchLinks={search}
      />
    </ScreenServicesProvider>
  );
}

const field = () => screen.getByLabelText(COPY.bodyLabel) as HTMLTextAreaElement;
const listbox = () => screen.queryByRole("listbox", { name: COPY.linkPickerLabel });
const announcer = () => document.querySelector("[data-screen-announcer]")!;

let user: ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
  user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  vi.mocked(saveNote).mockReset();
  vi.mocked(saveNote).mockImplementation(async (input) => {
    const { id, body, version } = input as { id: string; body: string; version: number };
    return ok({ status: "saved" as const, id, body, version: version + 1 });
  });
});

afterEach(() => {
  vi.useRealTimers();
});

async function tick(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

/** user-event reads `[` and `{` as key syntax: doubled, they are typed as they are. */
const literal = (text: string) => text.replace(/[[{]/g, (character) => character + character);

/** Types text as it is into the editor. */
async function typeText(text: string, options?: Parameters<typeof user.type>[2]) {
  await user.type(field(), literal(text), options);
}

/** Types into the (focused) editor and lets the 150 ms search run. */
async function typeAndSearch(text: string) {
  await typeText(text);
  await tick(150);
}

describe("pure helpers", () => {
  test("findLinkQuery: the `[[` being typed before the cursor", () => {
    expect(findLinkQuery("Hablé con [[Ru", 14)).toEqual({ start: 10, query: "Ru" });
    expect(findLinkQuery("[[Ru", 2)).toBe(null); // nothing typed yet
    expect(findLinkQuery("[[  ", 4)).toBe(null); // only spaces
    expect(findLinkQuery("[[Ru]", 5)).toBe(null);
    expect(findLinkQuery("[[Ru\nta", 7)).toBe(null);
    const inside = `[[project:${P1}|Ruta`;
    expect(findLinkQuery(inside, inside.length)).toBe(null); // inside a link
    const after = `[[project:${P1}|Ruta]] y`;
    expect(findLinkQuery(after, after.length)).toBe(null); // after a finished link
    expect(findLinkQuery(`[[${"a".repeat(81)}`, 83)).toBe(null); // too long
    expect(findLinkQuery("a [[x b [[Ru", 12)).toEqual({ start: 8, query: "Ru" });
  });

  test("insertLink replaces `[[texto` and puts the cursor right after the link", () => {
    const text = "Hablé con [[Ru y luego";
    const next = insertLink(text, { start: 10, query: "Ru" }, 14, {
      type: "project",
      id: P1,
      name: "Ruta [AWS] | IA",
    });
    const link = `[[project:${P1}|Ruta AWS IA]]`;
    expect(next.text).toBe(`Hablé con ${link} y luego`);
    expect(next.caret).toBe(10 + link.length);
  });

  test.each([
    ["2026-11-03", { kind: "iso", prefix: "2026-11-03" }],
    ["2026-11", { kind: "iso", prefix: "2026-11" }],
    ["3 nov", { kind: "dayMonth", day: 3, month: 11, year: null }],
    ["3 de noviembre", { kind: "dayMonth", day: 3, month: 11, year: null }],
    ["03 Nov. 2026", { kind: "dayMonth", day: 3, month: 11, year: 2026 }],
    ["15 set", { kind: "dayMonth", day: 15, month: 9, year: null }],
    ["1 ene de 2025", { kind: "dayMonth", day: 1, month: 1, year: 2025 }],
    ["Ruta", null],
    ["3 xyz", null],
    ["40 nov", null],
  ])("parseDayQuery(%s)", (text, expected) => {
    expect(parseDayQuery(text)).toEqual(expected);
  });
});

describe("the picker", () => {
  test("`[[` + text opens a grouped list under the field; the field is the combobox and keeps the focus", async () => {
    const search = vi.fn<Search>(async () => ok(GROUPS));
    render(<Body search={search} />);
    // At rest the field is a plain text box (no combobox role).
    expect(screen.getByRole("textbox", { name: COPY.bodyLabel })).not.toHaveAttribute("role");
    await typeText("Hablé con [[");
    await tick(200);
    expect(search).not.toHaveBeenCalled();
    expect(listbox()).toBeNull();
    await typeAndSearch("Ru");
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith({ q: "Ru" });
    const combo = screen.getByRole("combobox", { name: COPY.bodyLabel });
    expect(combo).toHaveFocus();
    expect(combo).toHaveAttribute("aria-expanded", "true");
    expect(combo).toHaveAttribute("aria-controls", listbox()!.id);
    expect(screen.getByRole("group", { name: "Proyectos" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Tareas" })).toBeInTheDocument();
    const options = screen.getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "Ruta AWS + IA",
      "Rumbo 2027Terminado",
      "Revisar rutaHecha",
    ]);
    expect(combo).toHaveAttribute("aria-activedescendant", options[0].id);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(announcer()).toHaveTextContent(COPY.linkResults(3)));
  });

  test("a burst of keys searches once, 150 ms after the last one", async () => {
    const search = vi.fn<Search>(async () => ok(GROUPS));
    render(<Body search={search} />);
    await typeText("[[Rut");
    expect(search).not.toHaveBeenCalled();
    await tick(150);
    // Not once per key («R», «Ru», «Rut»): only the last text.
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith({ q: "Rut" });
  });

  test("arrows move (and wrap), Enter chooses: `[[texto` becomes the link, cursor after it, then saved", async () => {
    render(<Body search={async () => ok(GROUPS)} />);
    await typeAndSearch("Hablé con [[Ru");
    const combo = screen.getByRole("combobox", { name: COPY.bodyLabel });
    await user.keyboard("{ArrowDown}");
    expect(combo).toHaveAttribute("aria-activedescendant", screen.getAllByRole("option")[1].id);
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(combo).toHaveAttribute("aria-activedescendant", screen.getAllByRole("option")[2].id);
    await user.keyboard("{ArrowDown}{Enter}");
    const link = `[[project:${P1}|Ruta AWS + IA]]`;
    expect(field()).toHaveValue(`Hablé con ${link}`);
    expect(field().selectionStart).toBe(`Hablé con ${link}`.length);
    expect(field()).toHaveFocus();
    expect(listbox()).toBeNull();
    expect(field()).not.toHaveAttribute("role");
    await waitFor(() => expect(announcer()).toHaveTextContent(COPY.linkInserted("Ruta AWS + IA")));
    // The autosave runs as with any key press.
    await tick(1000);
    await waitFor(() =>
      expect(saveNote).toHaveBeenCalledWith({ id: ID, body: `Hablé con ${link}`, version: 3 }),
    );
  });

  test("Tab chooses too, and the cursor lands after the link in the middle of the text", async () => {
    render(<Body search={async () => ok(GROUPS)} body=" y luego" />);
    await user.click(screen.getByRole("button", { name: COPY.edit }));
    field().setSelectionRange(0, 0);
    fireEvent.select(field());
    await typeText("Ver [[re", { initialSelectionStart: 0, initialSelectionEnd: 0 });
    await tick(150);
    await user.keyboard("{ArrowUp}{Tab}");
    const link = `[[task:${T1}|Revisar ruta]]`;
    expect(field()).toHaveValue(`Ver ${link} y luego`);
    expect(field().selectionStart).toBe(`Ver ${link}`.length);
    expect(field()).toHaveFocus();
  });

  test("Esc closes the list and stays in the editor; typing more opens it again", async () => {
    render(<Body search={async () => ok(GROUPS)} />);
    await typeAndSearch("[[Ru");
    expect(listbox()).not.toBeNull();
    await user.keyboard("{Escape}");
    expect(listbox()).toBeNull();
    expect(field()).toHaveFocus();
    expect(field()).toHaveValue("[[Ru");
    // Still editing: the editor didn't close (no «Editar» key).
    expect(screen.queryByRole("button", { name: COPY.edit })).toBeNull();
    // Enter after Esc is a line break, not a choice.
    await typeAndSearch("t");
    expect(listbox()).not.toBeNull();
    await user.keyboard("{Escape}{Enter}");
    expect(field()).toHaveValue("[[Rut\n");
    // A second Esc (picker closed) leaves the editor as usual.
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.getByRole("button", { name: COPY.edit })).toHaveFocus());
  });

  test("a tap chooses without taking the focus from the field", async () => {
    render(<Body search={async () => ok(GROUPS)} />);
    await typeAndSearch("[[ru");
    const option = screen.getByRole("option", { name: /Rumbo 2027/ });
    expect(fireEvent.pointerDown(option)).toBe(false); // default prevented: no focus move
    expect(fireEvent.mouseDown(option)).toBe(false);
    await user.click(option);
    expect(field()).toHaveValue(`[[project:${P2}|Rumbo 2027]]`);
    expect(field()).toHaveFocus();
  });

  test("an answer to older text is ignored (out of order)", async () => {
    const answers: Record<string, (value: ActionResult<NoteLinkGroup[]>) => void> = {};
    const search = vi.fn<Search>(({ q }) => new Promise((resolve) => void (answers[q] = resolve)));
    render(<Body search={search} />);
    await typeAndSearch("[[R");
    await typeAndSearch("u");
    expect(Object.keys(answers)).toEqual(["R", "Ru"]);
    await act(async () => answers.Ru(ok([GROUPS[1]])));
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Revisar rutaHecha",
    ]);
    await act(async () => answers.R(ok(GROUPS)));
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  test("nothing found: «Sin coincidencias», announced; Enter is a line break", async () => {
    render(<Body search={async () => ok([])} />);
    await typeAndSearch("[[zzz");
    expect(screen.getByText(COPY.linkNoMatches)).toBeVisible();
    expect(listbox()).toBeNull();
    await waitFor(() => expect(announcer()).toHaveTextContent(COPY.linkNoMatches));
    expect(screen.getByRole("combobox", { name: COPY.bodyLabel })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await user.keyboard("{Enter}");
    expect(field()).toHaveValue("[[zzz\n");
  });

  test("a failed search says so and keeps the text", async () => {
    render(<Body search={async () => Promise.reject(new Error("offline"))} />);
    await typeAndSearch("[[Ru");
    expect(screen.getByText(COPY.linkSearchFailed)).toBeVisible();
    expect(field()).toHaveValue("[[Ru");
  });

  test("leaving the field closes the list; a closing bracket or a line break too", async () => {
    render(<Body search={async () => ok(GROUPS)} />);
    await typeAndSearch("[[Ru");
    expect(listbox()).not.toBeNull();
    await typeText("]");
    expect(listbox()).toBeNull();
    await user.keyboard("{Backspace}");
    await tick(150);
    expect(listbox()).not.toBeNull();
    fireEvent.blur(field());
    expect(listbox()).toBeNull();
  });

  test("an unmount with a search pending leaves no timer behind", async () => {
    const search = vi.fn<Search>(async () => ok(GROUPS));
    const { unmount } = render(<Body search={search} />);
    await typeText("[[Ru");
    unmount();
    await tick(500);
    expect(search).not.toHaveBeenCalled();
  });

  test("without a search (no prop) there is no picker", async () => {
    render(
      <ScreenServicesProvider label={COPY.noticesLabel} actionHint={COPY.undoHint}>
        <NoteBody
          note={{ id: ID, body: "", version: 3 }}
          day={null}
          rendered={null}
          shortcuts={false}
        />
      </ScreenServicesProvider>,
    );
    await typeText("[[Ru");
    await tick(200);
    expect(field()).not.toHaveAttribute("role");
    expect(screen.queryByText(COPY.linkSearching)).toBeNull();
  });
});
