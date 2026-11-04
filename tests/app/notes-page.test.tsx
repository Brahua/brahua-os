// N1 of `notes`: /notes and /notes/[key] as pages (queries mocked: what they read, the 404s and
// the authorization) and their screens as the owner uses them against a fake server (actions
// mocked): the list with its filters in the URL, «Ver más» with the focus on the first new row,
// «Nueva nota», the deleted note's «Deshacer», a daily note's header, and a knowledge note's title,
// area and «Fijar».
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import NoteNotFound from "@/app/(app)/notes/[key]/not-found";
import NotePage, { generateMetadata } from "@/app/(app)/notes/[key]/page";
import NotesPage, { metadata } from "@/app/(app)/notes/page";
import { fail, ok } from "@/lib/action-result";
import { requireOwner } from "@/lib/auth";
import { ownerDateKey } from "@/lib/time";
import { ScreenServicesProvider } from "@/modules/core/components/screen-services";
import {
  createNote,
  pinNote,
  renameNote,
  restoreNote,
  saveDailyNote,
  setNoteArea,
} from "@/modules/notes/actions";
import { markDayLink, takeDayLink } from "@/modules/notes/components/day-focus";
import { NotesScreen } from "@/modules/notes/components/notes-screen";
import { getTodayNoteState } from "@/modules/notes/contracts";
import { NOTES_COPY as COPY, NOTES_ERRORS } from "@/modules/notes/copy";
import { addDays, dailyTitle } from "@/modules/notes/note-day";
import type { NoteArea, NoteItem, NoteListItem } from "@/modules/notes/note-input";
import type { NoteSearchItem } from "@/modules/notes/search";
import {
  getDailyNote,
  getDailyNoteDay,
  getDeletedNote,
  getLinkedFrom,
  getNoteLinkResolutions,
  getPageNote,
  listNoteAreas,
  listNotes,
  searchNotes,
} from "@/modules/notes/queries";
import { NOTE_LINK_SOURCES } from "@/lib/note-link-sources";
import { getDayFooterSlot } from "@/lib/note-extensions";

vi.mock("@/lib/auth", () => ({ requireOwner: vi.fn() }));
vi.mock("@/modules/notes/queries", () => ({
  listNotes: vi.fn(),
  getDailyNote: vi.fn(),
  getPageNote: vi.fn(),
  getDeletedNote: vi.fn(),
  listNoteAreas: vi.fn(),
  getNoteLinkResolutions: vi.fn(),
  getLinkedFrom: vi.fn(),
  getDailyNoteDay: vi.fn(),
  searchNotes: vi.fn(),
}));
// N2: the link sources' root and the picker's action (tested on their own).
vi.mock("@/lib/note-link-sources", () => ({ NOTE_LINK_SOURCES: [] }));
vi.mock("@/lib/note-link-actions", () => ({ searchNoteLinks: vi.fn() }));
vi.mock("@/modules/notes/contracts", () => ({ getTodayNoteState: vi.fn() }));
// N3: the footer's root and the line controls' actions (tested on their own).
vi.mock("@/lib/note-extensions", () => ({
  getDayFooterSlot: vi.fn(async (day: string) => <p data-day-footer={day}>Ese día</p>),
}));
vi.mock("@/lib/note-task-actions", () => ({
  convertNoteLineToTask: vi.fn(),
  undoNoteLineToTask: vi.fn(),
  completeNoteTask: vi.fn(),
  reopenNoteTask: vi.fn(),
}));
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
const cookieJar = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "bo_shortcuts" && cookieJar.value ? { value: cookieJar.value } : undefined,
  }),
}));
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => router,
}));

/** Lima's day for this run (the screens refuse days that haven't come). */
const TODAY = ownerDateKey(new Date());
const YESTERDAY = addDays(TODAY, -1);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const AREAS: NoteArea[] = [
  {
    id: id(901),
    name: "Aprendizaje y Desarrollo profesional",
    color: "learning",
    icon: "book-open",
  },
  { id: id(902), name: "Hogar", color: "home", icon: "house" },
] as NoteArea[];

function row(n: number, patch: Partial<NoteListItem> = {}): NoteListItem {
  return {
    id: id(n),
    kind: "page",
    day: null,
    title: `Nota ${n}`,
    excerpt: `Texto ${n}`,
    pinned: false,
    editedOn: TODAY,
    areaName: null,
    ...patch,
  };
}

const PAGE: NoteItem = {
  id: id(1),
  kind: "page",
  day: null,
  title: "Apuntes IAM",
  body: "Las **policies** se evalúan",
  version: 2,
  area: null,
  pinned: false,
};

beforeEach(() => {
  takeDayLink();
  for (const fn of [createNote, pinNote, renameNote, restoreNote, setNoteArea, saveDailyNote]) {
    vi.mocked(fn).mockReset();
  }
  router.push.mockReset();
  router.replace.mockReset();
  cookieJar.value = undefined;
  vi.mocked(requireOwner)
    .mockReset()
    .mockResolvedValue(undefined as never);
  vi.mocked(listNotes).mockReset().mockResolvedValue({ items: [], more: false });
  vi.mocked(getDailyNote).mockReset().mockResolvedValue(null);
  vi.mocked(getPageNote).mockReset().mockResolvedValue(null);
  vi.mocked(getDeletedNote).mockReset().mockResolvedValue(null);
  vi.mocked(listNoteAreas).mockReset().mockResolvedValue(AREAS);
  vi.mocked(getTodayNoteState).mockReset().mockResolvedValue({ day: TODAY, hasText: false });
  vi.mocked(getNoteLinkResolutions).mockReset().mockResolvedValue({});
  vi.mocked(getLinkedFrom).mockReset().mockResolvedValue([]);
  vi.mocked(getDailyNoteDay).mockReset().mockResolvedValue(null);
  vi.mocked(searchNotes).mockReset().mockResolvedValue({ items: [], more: false });
});

const search = (params: Record<string, string> = {}) =>
  ({ searchParams: Promise.resolve(params) }) as never;
const keyParams = (key: string) => ({ params: Promise.resolve({ key }) }) as never;
const announcer = () => document.querySelector("[data-screen-announcer]")!;

describe("/notes", () => {
  test("checks the owner first, reads the first 30 of every kind, and titles itself", async () => {
    render(await NotesPage(search()));
    expect(requireOwner).toHaveBeenCalled();
    expect(listNotes).toHaveBeenCalledWith({ kind: "all", areaId: null, shown: 30 });
    expect(getDeletedNote).not.toHaveBeenCalled();
    expect(metadata.title).toBe("Notas · brahua-os");
    expect(screen.getByRole("heading", { level: 1, name: "Notas" })).toBeVisible();
  });

  test("no notes: «Escribe lo que pasó hoy» with «Nota de hoy»", async () => {
    render(await NotesPage(search()));
    const empty = document.querySelector<HTMLElement>("[data-notes-empty]")!;
    expect(within(empty).getByRole("heading", { name: COPY.emptyTitle })).toBeVisible();
    expect(within(empty).getByRole("link", { name: COPY.todayNote })).toHaveAttribute(
      "href",
      `/notes/${TODAY}`,
    );
  });

  test("the filters come from the URL; an unknown area shows everything", async () => {
    render(await NotesPage(search({ tipo: "notas", area: id(902), n: "60" })));
    expect(listNotes).toHaveBeenCalledWith({ kind: "page", areaId: id(902), shown: 60 });
    vi.mocked(listNotes).mockClear();
    render(await NotesPage(search({ tipo: "x", area: id(999) })));
    expect(listNotes).toHaveBeenCalledWith({ kind: "all", areaId: null, shown: 30 });
  });

  test("today's note with text: «Seguir la nota de hoy»", async () => {
    vi.mocked(getTodayNoteState).mockResolvedValue({ day: TODAY, hasText: true });
    render(await NotesPage(search()));
    expect(screen.getByRole("link", { name: COPY.continueTodayNote })).toBeVisible();
  });

  test("?deleted=<id> offers «Deshacer», which restores exactly that note", async () => {
    vi.mocked(getDeletedNote).mockResolvedValue({
      id: id(1),
      kind: "page",
      day: null,
      title: "Apuntes IAM",
    });
    vi.mocked(restoreNote).mockResolvedValue(
      ok({ id: id(1), kind: "page", day: null, title: "Apuntes IAM" }),
    );
    render(await NotesPage(search({ deleted: id(1) })));
    expect(getDeletedNote).toHaveBeenCalledWith(id(1));
    expect(await screen.findByText(COPY.deleted("Apuntes IAM"))).toBeVisible();
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1, name: "Notas" })).toHaveFocus(),
    );
    await userEvent.click(screen.getByRole("button", { name: COPY.undo }));
    expect(restoreNote).toHaveBeenCalledWith({ id: id(1) });
    expect(await screen.findByText(COPY.restored("Apuntes IAM"))).toBeVisible();
  });

  test("a refused owner never reads anything", async () => {
    vi.mocked(requireOwner).mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(NotesPage(search())).rejects.toThrow("NEXT_REDIRECT");
    expect(listNotes).not.toHaveBeenCalled();
    expect(getTodayNoteState).not.toHaveBeenCalled();
  });
});

function List(props: Partial<React.ComponentProps<typeof NotesScreen>>) {
  return (
    <ScreenServicesProvider label={COPY.noticesLabel} actionHint={COPY.undoHint}>
      <NotesScreen
        items={[]}
        more={false}
        kind="all"
        areaId={null}
        areas={AREAS}
        shown={30}
        today={TODAY}
        todayHasText={false}
        headingId="notes-title"
        {...props}
      />
    </ScreenServicesProvider>
  );
}

describe("the list", () => {
  test("rows: a daily note by its date, a page by its title; pinned and area shown", () => {
    render(
      <List
        items={[
          row(1, { title: "Apuntes IAM", pinned: true, areaName: "Hogar" }),
          row(2, { kind: "daily", day: YESTERDAY, title: null, excerpt: "", editedOn: YESTERDAY }),
        ]}
      />,
    );
    const pinned = screen.getByRole("link", { name: /Apuntes IAM/ });
    expect(pinned).toHaveAttribute("href", `/notes/${id(1)}`);
    expect(within(pinned).getByText(COPY.pinned)).toBeVisible();
    expect(within(pinned).getByText("Hogar")).toBeVisible();
    expect(within(pinned).getByText("Hoy")).toBeVisible();
    const daily = screen.getByRole("link", { name: new RegExp(dailyTitle(YESTERDAY, TODAY)) });
    expect(daily).toHaveAttribute("href", `/notes/${YESTERDAY}`);
    expect(within(daily).getByText(COPY.noText)).toBeVisible();
    expect(within(daily).getByText("Ayer")).toBeVisible();
  });

  test("the kind and area filters write the URL", async () => {
    render(<List items={[row(1)]} />);
    await userEvent.click(screen.getByRole("radio", { name: COPY.kindDaily }));
    expect(router.replace).toHaveBeenLastCalledWith("/notes?tipo=diario", { scroll: false });
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: COPY.areaFilterLabel }),
      "Hogar",
    );
    expect(router.replace).toHaveBeenLastCalledWith(`/notes?area=${id(902)}`, { scroll: false });
  });

  test("filters with no match: «Quitar filtros» goes back to every note, focus on the filter", async () => {
    const { rerender } = render(<List kind="daily" />);
    expect(screen.getByText(COPY.emptyFiltered)).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: COPY.clearFilters }));
    expect(router.replace).toHaveBeenLastCalledWith("/notes", { scroll: false });
    // The server answers with every note: the key left, the focus goes to the kind filter.
    rerender(<List items={[row(1), row(2)]} />);
    await waitFor(() => expect(screen.getByRole("radio", { name: COPY.kindAll })).toHaveFocus());
    await waitFor(() => expect(announcer()).toHaveTextContent("2 notas"));
  });

  test("a filter change announces what the list holds now", async () => {
    const { rerender } = render(<List items={[row(1), row(2)]} />);
    await userEvent.click(screen.getByRole("radio", { name: COPY.kindPage }));
    rerender(<List items={[row(1)]} kind="page" />);
    await waitFor(() => expect(announcer()).toHaveTextContent("1 nota"));
    await userEvent.click(screen.getByRole("radio", { name: COPY.kindDaily }));
    rerender(<List items={[]} kind="daily" />);
    await waitFor(() => expect(announcer()).toHaveTextContent(COPY.emptyFiltered));
  });

  test("an empty list has one primary «Nota de hoy» (the header's)", () => {
    render(<List />);
    const links = screen.getAllByRole("link", { name: COPY.todayNote });
    expect(links).toHaveLength(2);
    expect(links.filter((link) => link.classList.contains("bo-key--signal"))).toHaveLength(1);
  });

  test("with shortcuts on, «Nota de hoy» shows N from 1024 px", () => {
    window.matchMedia = vi.fn((query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    const { unmount } = render(<List items={[row(1)]} shortcuts />);
    const key = screen.getByRole("link", { name: COPY.todayNote });
    expect(key).toHaveAttribute("aria-keyshortcuts", "N");
    expect(within(key).getByText("N")).toBeInTheDocument();
    unmount();
    render(<List items={[row(1)]} />);
    expect(screen.getByRole("link", { name: COPY.todayNote })).not.toHaveAttribute(
      "aria-keyshortcuts",
    );
  });

  test("«Ver más» asks for 30 more and lands on the first new row", async () => {
    const first = Array.from({ length: 30 }, (_, index) => row(index + 1));
    const { rerender } = render(<List items={first} more />);
    await userEvent.click(screen.getByRole("button", { name: COPY.showMore }));
    expect(router.replace).toHaveBeenLastCalledWith("/notes?n=60", { scroll: false });
    rerender(<List items={[...first, row(31), row(32)]} shown={60} />);
    await waitFor(() => expect(screen.getByRole("link", { name: /Nota 31/ })).toHaveFocus());
    expect(screen.queryByRole("button", { name: COPY.showMore })).toBeNull();
  });

  test("«Nueva nota»: a title and an area create the note and open it", async () => {
    vi.mocked(createNote).mockResolvedValue(ok({ id: id(7) }));
    render(<List items={[row(1)]} />);
    await userEvent.click(screen.getByRole("button", { name: COPY.newNote }));
    const sheet = await screen.findByRole("dialog", { name: COPY.newNoteTitle });
    expect(within(sheet).getByRole("textbox", { name: COPY.titleLabel })).toHaveFocus();
    // Empty: the title is asked for, nothing is sent.
    await userEvent.click(within(sheet).getByRole("button", { name: COPY.create }));
    expect(await within(sheet).findByText("Ponle un título.")).toBeVisible();
    expect(createNote).not.toHaveBeenCalled();
    await userEvent.type(
      within(sheet).getByRole("textbox", { name: COPY.titleLabel }),
      " Apuntes IAM ",
    );
    await userEvent.selectOptions(
      within(sheet).getByRole("combobox", { name: COPY.areaLabel }),
      AREAS[0].name,
    );
    await userEvent.click(within(sheet).getByRole("button", { name: COPY.create }));
    expect(createNote).toHaveBeenCalledWith({ title: "Apuntes IAM", areaId: id(901) });
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/notes/${id(7)}`));
  });

  test("«Nueva nota» refused for an area archived meanwhile: the error is on the area", async () => {
    vi.mocked(createNote).mockResolvedValue({
      ok: false,
      error: "Revisa los campos marcados.",
      fieldErrors: { areaId: ["Esa área ya no está disponible. Elige otra o ninguna."] },
    });
    render(<List items={[row(1)]} />);
    await userEvent.click(screen.getByRole("button", { name: COPY.newNote }));
    const sheet = await screen.findByRole("dialog", { name: COPY.newNoteTitle });
    await userEvent.type(within(sheet).getByRole("textbox", { name: COPY.titleLabel }), "A");
    await userEvent.click(within(sheet).getByRole("button", { name: COPY.create }));
    expect(
      await within(sheet).findByText("Esa área ya no está disponible. Elige otra o ninguna."),
    ).toBeVisible();
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe("/notes/[key]", () => {
  test("a day that hasn't come, a malformed key or a missing note is a 404", async () => {
    await expect(NotePage(keyParams(addDays(TODAY, 1)))).rejects.toThrow();
    await expect(NotePage(keyParams("2026-02-30"))).rejects.toThrow();
    await expect(NotePage(keyParams("hoy"))).rejects.toThrow();
    await expect(NotePage(keyParams(id(5)))).rejects.toThrow();
    expect(getPageNote).toHaveBeenCalledWith(id(5));
    expect(getDailyNote).not.toHaveBeenCalled();
    expect((await generateMetadata(keyParams("hoy"))).title).toBe(COPY.notFoundTitle);
  });

  test("today without a note: its date, no «Día siguiente», and the editor open and empty", async () => {
    render(await NotePage(keyParams(TODAY)));
    expect(getDailyNote).toHaveBeenCalledWith(TODAY);
    expect(screen.getByRole("heading", { level: 1, name: dailyTitle(TODAY, TODAY) })).toBeVisible();
    expect(screen.getByRole("link", { name: COPY.previousDay })).toHaveAttribute(
      "href",
      `/notes/${YESTERDAY}`,
    );
    expect(screen.queryByRole("link", { name: COPY.nextDay })).toBeNull();
    expect(screen.getByRole("textbox", { name: COPY.bodyLabel })).toHaveValue("");
    // Reached on purpose: the cursor is in the text (SPEC-notes, story 1).
    expect(screen.getByRole("textbox", { name: COPY.bodyLabel })).toHaveFocus();
    expect(screen.queryByRole("button", { name: COPY.delete })).toBeNull();
    expect((await generateMetadata(keyParams(TODAY))).title).toBe(
      `${dailyTitle(TODAY, TODAY)} · brahua-os`,
    );
  });

  test("a past day with text: rendered on the server, «Día siguiente», and the day picker", async () => {
    vi.mocked(getDailyNote).mockResolvedValue({
      id: id(3),
      kind: "daily",
      day: YESTERDAY,
      title: null,
      body: "# Reunión\n\nHablé con **Ana**",
      version: 4,
      area: null,
      pinned: false,
    });
    render(await NotePage(keyParams(YESTERDAY)));
    // Headings in the note start at h2 (the date is the h1).
    expect(screen.getByRole("heading", { level: 2, name: "Reunión" })).toBeVisible();
    expect(screen.queryByRole("textbox", { name: COPY.bodyLabel })).toBeNull();
    expect(screen.getByRole("link", { name: COPY.nextDay })).toHaveAttribute(
      "href",
      `/notes/${TODAY}`,
    );
    const picker = screen.getByLabelText(COPY.goToDayLabel, { selector: "input" });
    expect(picker).toHaveAttribute("max", TODAY);
    await userEvent.clear(picker);
    await userEvent.type(picker, addDays(TODAY, -5));
    await userEvent.click(screen.getByRole("button", { name: COPY.go }));
    expect(router.push).toHaveBeenCalledWith(`/notes/${addDays(TODAY, -5)}`);
    expect(screen.getByRole("button", { name: COPY.delete })).toBeVisible();
  });

  test("«Ir» refuses a future, empty or too old day on the field, with the focus there", async () => {
    render(await NotePage(keyParams(YESTERDAY)));
    const picker = screen.getByLabelText(COPY.goToDayLabel, { selector: "input" });
    for (const value of [addDays(TODAY, 1), "", "1999-12-31"]) {
      fireEvent.change(picker, { target: { value } });
      await userEvent.click(screen.getByRole("button", { name: COPY.go }));
      expect(picker).toHaveAttribute("aria-invalid", "true");
      expect(picker).toHaveAccessibleDescription(NOTES_ERRORS.day);
      expect(picker).toHaveFocus();
    }
    expect(router.push).not.toHaveBeenCalled();
    // Changing the value clears the error.
    fireEvent.change(picker, { target: { value: addDays(TODAY, -3) } });
    expect(picker).toHaveAttribute("aria-invalid", "false");
  });

  test("«Ir» goes through the unsaved-changes guard", async () => {
    vi.mocked(saveDailyNote).mockReturnValue(new Promise(() => {}));
    render(await NotePage(keyParams(TODAY)));
    await userEvent.type(screen.getByRole("textbox", { name: COPY.bodyLabel }), "Hoy");
    const picker = screen.getByLabelText(COPY.goToDayLabel, { selector: "input" });
    fireEvent.change(picker, { target: { value: YESTERDAY } });
    await userEvent.click(screen.getByRole("button", { name: COPY.go }));
    expect(await screen.findByText(COPY.leaveTitle)).toBeVisible();
    expect(router.push).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: COPY.leave }));
    expect(router.push).toHaveBeenCalledWith(`/notes/${YESTERDAY}`);
  });

  test("arriving through «Día anterior»: focus on the same link, never the empty editor", async () => {
    markDayLink("previous");
    render(await NotePage(keyParams(YESTERDAY)));
    await waitFor(() => expect(screen.getByRole("link", { name: COPY.previousDay })).toHaveFocus());
    expect(screen.getByRole("textbox", { name: COPY.bodyLabel })).not.toHaveFocus();
  });

  test("arriving at today through «Día siguiente» (not there today): focus on the h1", async () => {
    markDayLink("next");
    render(await NotePage(keyParams(TODAY)));
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1, name: dailyTitle(TODAY, TODAY) }),
      ).toHaveFocus(),
    );
  });

  test("a day link marks itself only on a plain click", async () => {
    render(await NotePage(keyParams(YESTERDAY)));
    const link = screen.getByRole("link", { name: COPY.nextDay });
    link.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(link, { metaKey: true });
    expect(takeDayLink()).toBeNull();
    fireEvent.click(link);
    expect(takeDayLink()).toBe("next");
  });

  test("the 404 goes back with «Ir a Notas»", () => {
    render(<NoteNotFound />);
    expect(screen.getByRole("link", { name: COPY.goToList })).toHaveAttribute("href", "/notes");
  });

  test("the `E` key follows the shortcuts cookie", async () => {
    vi.mocked(getPageNote).mockResolvedValue(PAGE);
    cookieJar.value = "off";
    const { unmount } = render(await NotePage(keyParams(id(1))));
    await userEvent.keyboard("e");
    expect(screen.queryByRole("textbox", { name: COPY.bodyLabel })).toBeNull();
    unmount();
    cookieJar.value = undefined;
    render(await NotePage(keyParams(id(1))));
    await userEvent.keyboard("e");
    expect(screen.getByRole("textbox", { name: COPY.bodyLabel })).toHaveFocus();
  });

  test("a knowledge note: its title, «Cambiar título» with Enter and Esc", async () => {
    vi.mocked(getPageNote).mockResolvedValue(PAGE);
    vi.mocked(renameNote).mockResolvedValue(ok({ ...PAGE, title: "Apuntes IAM AWS" }));
    render(await NotePage(keyParams(id(1))));
    expect(screen.getByRole("heading", { level: 1, name: "Apuntes IAM" })).toBeVisible();
    expect((await generateMetadata(keyParams(id(1)))).title).toBe("Apuntes IAM · brahua-os");

    const renameKey = screen.getByRole("button", { name: COPY.rename });
    await userEvent.click(renameKey);
    const field = screen.getByRole("textbox", { name: COPY.titleLabel });
    expect(field).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.getByRole("button", { name: COPY.rename })).toHaveFocus());
    expect(renameNote).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: COPY.rename }));
    await userEvent.type(screen.getByRole("textbox", { name: COPY.titleLabel }), " AWS{Enter}");
    expect(renameNote).toHaveBeenCalledWith({ id: id(1), title: "Apuntes IAM AWS" });
    await waitFor(() => expect(screen.getByRole("button", { name: COPY.rename })).toHaveFocus());
  });

  test("a refused title stays in the field with the reason", async () => {
    vi.mocked(getPageNote).mockResolvedValue(PAGE);
    vi.mocked(renameNote).mockResolvedValue(fail("Esta nota ya no existe (se eliminó)."));
    render(await NotePage(keyParams(id(1))));
    await userEvent.click(screen.getByRole("button", { name: COPY.rename }));
    await userEvent.type(screen.getByRole("textbox", { name: COPY.titleLabel }), "!{Enter}");
    expect(await screen.findByText("Esta nota ya no existe (se eliminó).")).toBeVisible();
    expect(screen.getByRole("textbox", { name: COPY.titleLabel })).toHaveValue("Apuntes IAM!");
  });

  test("«Fijar» and the area show at once and go back if the server refuses", async () => {
    vi.mocked(getPageNote).mockResolvedValue(PAGE);
    vi.mocked(pinNote).mockResolvedValue(ok({ ...PAGE, pinned: true }));
    vi.mocked(setNoteArea).mockResolvedValue(fail("Esa área ya no está disponible."));
    render(await NotePage(keyParams(id(1))));
    await userEvent.click(screen.getByRole("button", { name: COPY.pin }));
    expect(pinNote).toHaveBeenCalledWith({ id: id(1), pinned: true });
    const area = screen.getByRole("combobox", { name: COPY.areaLabel });
    await userEvent.selectOptions(area, "Hogar");
    expect(setNoteArea).toHaveBeenCalledWith({ id: id(1), areaId: id(902) });
    expect(
      await screen.findByText(`${COPY.notSaved.area} Esa área ya no está disponible.`),
    ).toBeVisible();
    await waitFor(() => expect(area).toHaveValue(""));
  });

  test("an archived area the note keeps is offered, marked «(archivada)»", async () => {
    const old = { id: id(950), name: "Viejo", color: "home", icon: "house" } as NoteArea;
    vi.mocked(getPageNote).mockResolvedValue({ ...PAGE, area: old });
    render(await NotePage(keyParams(id(1))));
    const area = screen.getByRole("combobox", { name: COPY.areaLabel });
    expect(area).toHaveValue(id(950));
    expect(within(area).getByRole("option", { name: "Viejo (archivada)" })).toBeInTheDocument();
  });

  test("a refused owner never reads the note", async () => {
    vi.mocked(requireOwner).mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(NotePage(keyParams(TODAY))).rejects.toThrow("NEXT_REDIRECT");
    expect(getDailyNote).not.toHaveBeenCalled();
    await act(async () => {});
  });
});

describe("/notes/[key]: links (N2)", () => {
  const TARGET = id(700);

  test("the body's links are resolved on the server (through the root's sources) and drawn with the current name", async () => {
    const body = `Ver [[project:${TARGET}|Nombre viejo]] y [[task:${id(701)}|Llamar]]`;
    vi.mocked(getPageNote).mockResolvedValue({ ...PAGE, body });
    vi.mocked(getNoteLinkResolutions).mockResolvedValue({
      [`project:${TARGET}`]: { name: "Ruta AWS + IA", href: `/projects/${TARGET}`, deleted: false },
      [`task:${id(701)}`]: { name: "Llamar", href: `/tasks/${id(701)}`, deleted: true },
    });
    render(await NotePage(keyParams(id(1))));
    expect(getNoteLinkResolutions).toHaveBeenCalledWith(NOTE_LINK_SOURCES, body);
    expect(screen.getByRole("link", { name: "Ruta AWS + IA" })).toHaveAttribute(
      "href",
      `/projects/${TARGET}`,
    );
    expect(screen.getByText(/Llamar \(ya no existe\)/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Llamar/ })).toBeNull();
  });

  test("«Enlazada desde» lists the notes linking here; without any, no section", async () => {
    vi.mocked(getPageNote).mockResolvedValue(PAGE);
    vi.mocked(getLinkedFrom).mockResolvedValue([
      { id: id(2), kind: "daily", name: "Lunes 3 de noviembre", href: "/notes/2026-11-03" },
      { id: id(3), kind: "page", name: "Ideas", href: `/notes/${id(3)}` },
    ]);
    const { unmount } = render(await NotePage(keyParams(id(1))));
    expect(getLinkedFrom).toHaveBeenCalledWith(id(1));
    const section = screen.getByRole("region", { name: COPY.linkedFromTitle });
    expect(within(section).getByRole("link", { name: "Lunes 3 de noviembre" })).toHaveAttribute(
      "href",
      "/notes/2026-11-03",
    );
    expect(within(section).getByRole("link", { name: "Ideas" })).toHaveAttribute(
      "href",
      `/notes/${id(3)}`,
    );
    unmount();

    vi.mocked(getLinkedFrom).mockResolvedValue([]);
    render(await NotePage(keyParams(id(1))));
    expect(screen.queryByRole("region", { name: COPY.linkedFromTitle })).toBeNull();
  });

  test("a day without a note has no «Enlazada desde» (nothing is read)", async () => {
    render(await NotePage(keyParams(TODAY)));
    expect(getLinkedFrom).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: COPY.linkedFromTitle })).toBeNull();
  });

  test("N3: a daily page ends with «Ese día» (read for its day, with or without a note); a knowledge note has none", async () => {
    const { container, unmount } = render(await NotePage(keyParams(YESTERDAY)));
    expect(getDayFooterSlot).toHaveBeenCalledWith(YESTERDAY);
    expect(container.querySelector(`[data-day-footer="${YESTERDAY}"]`)).not.toBeNull();
    unmount();

    vi.mocked(getDayFooterSlot).mockClear();
    vi.mocked(getPageNote).mockResolvedValue(PAGE);
    const page = render(await NotePage(keyParams(id(1))));
    expect(getDayFooterSlot).not.toHaveBeenCalled();
    expect(page.container.querySelector("[data-day-footer]")).toBeNull();
  });

  test("N3: the server render draws «Convertir en tarea» and the task's real checkbox", async () => {
    const task = id(720);
    vi.mocked(getDailyNote).mockResolvedValue({
      ...PAGE,
      kind: "daily",
      day: YESTERDAY,
      title: null,
      body: `- [ ] Llamar al banco\n- [[task:${task}|Pagar luz]]`,
    });
    vi.mocked(getNoteLinkResolutions).mockResolvedValue({
      [`task:${task}`]: {
        name: "Pagar la luz",
        href: `/tasks/${task}`,
        deleted: false,
        done: true,
      },
    });
    render(await NotePage(keyParams(YESTERDAY)));
    expect(
      screen.getByRole("button", { name: COPY.convertLabel("Llamar al banco") }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: COPY.taskDoneLabel("Pagar la luz") }),
    ).toBeChecked();
  });

  test("a daily note's id (a link drawn without resolution) opens its day", async () => {
    vi.mocked(getDailyNoteDay).mockResolvedValue(YESTERDAY);
    await expect(NotePage(keyParams(id(9)))).rejects.toMatchObject({
      digest: expect.stringContaining(`/notes/${YESTERDAY}`),
    });
    expect(getDailyNoteDay).toHaveBeenCalledWith(id(9));
  });
});

function result(n: number, patch: Partial<NoteSearchItem> = {}): NoteSearchItem {
  return {
    ...row(n),
    excerpt: "",
    fragment: [
      { text: "Las ", mark: false },
      { text: "políticas", mark: true },
      { text: " de IAM", mark: false },
    ],
    ...patch,
  };
}

describe("the search (N4)", () => {
  test("?q= searches with the filters instead of reading the list", async () => {
    vi.mocked(searchNotes).mockResolvedValue({ items: [result(1)], more: false });
    render(await NotesPage(search({ q: "polit", tipo: "notas", area: id(902) })));
    expect(searchNotes).toHaveBeenCalledWith({
      text: "polit",
      kind: "page",
      areaId: id(902),
      shown: 30,
    });
    expect(listNotes).not.toHaveBeenCalled();
    expect(screen.getByRole("searchbox", { name: COPY.searchLabel })).toHaveValue("polit");
    const results = screen.getByRole("list", { name: COPY.searchResultsLabel });
    expect(within(results).getByRole("link", { name: /Nota 1/ })).toHaveAttribute(
      "href",
      `/notes/${id(1)}`,
    );
    expect(document.querySelector("[data-notes-list]")).toBeNull();
  });

  test("fewer than 2 letters or numbers searches nothing and says so", async () => {
    render(await NotesPage(search({ q: " p & " })));
    expect(searchNotes).not.toHaveBeenCalled();
    expect(listNotes).not.toHaveBeenCalled();
    expect(screen.getByText(COPY.searchTooShort)).toBeVisible();
  });

  test("a long ?q= is cut at 200 characters before searching", async () => {
    render(await NotesPage(search({ q: "a".repeat(300) })));
    expect(vi.mocked(searchNotes).mock.calls[0][0].text).toHaveLength(200);
  });

  test("a refused owner never searches", async () => {
    vi.mocked(requireOwner).mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(NotesPage(search({ q: "polit" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(searchNotes).not.toHaveBeenCalled();
  });

  test("Enter searches: the trimmed text goes to the URL with the filters", async () => {
    render(<List items={[row(1)]} kind="daily" />);
    const field = screen.getByRole("searchbox", { name: COPY.searchLabel });
    await userEvent.type(field, "  políticas iam {Enter}");
    expect(router.replace).toHaveBeenLastCalledWith(
      `/notes?${new URLSearchParams({ q: "políticas iam", tipo: "diario" })}`,
      { scroll: false },
    );
  });

  test("«Buscar» searches too; an empty field searches nothing", async () => {
    render(<List items={[row(1)]} />);
    await userEvent.click(screen.getByRole("button", { name: COPY.searchSubmit }));
    expect(router.replace).not.toHaveBeenCalled();
    await userEvent.type(screen.getByRole("searchbox", { name: COPY.searchLabel }), "gim");
    await userEvent.click(screen.getByRole("button", { name: COPY.searchSubmit }));
    expect(router.replace).toHaveBeenLastCalledWith("/notes?q=gim", { scroll: false });
  });

  test("the results replace the list, with the found words in <mark> and text never as HTML", () => {
    render(
      <List
        items={[row(9, { title: "No debe verse" })]}
        query="polit"
        search={{
          items: [
            result(1, { title: "Apuntes IAM" }),
            result(2, {
              kind: "daily",
              day: YESTERDAY,
              title: null,
              fragment: [{ text: "<b>no es HTML</b>", mark: false }],
            }),
          ],
          more: false,
          tooShort: false,
        }}
      />,
    );
    expect(screen.queryByText("No debe verse")).toBeNull();
    const first = screen.getByRole("link", { name: /Apuntes IAM/ });
    const mark = first.querySelector("mark")!;
    expect(mark).toHaveTextContent("políticas");
    expect(mark).toHaveClass("bo-note-search-mark");
    expect(first).toHaveTextContent("Las políticas de IAM");
    const daily = screen.getByRole("link", { name: new RegExp(dailyTitle(YESTERDAY, TODAY)) });
    expect(daily).toHaveAttribute("href", `/notes/${YESTERDAY}`);
    expect(within(daily).getByText("<b>no es HTML</b>")).toBeVisible();
    expect(daily.querySelector("b")).toBeNull();
    // The empty states of the list don't show while searching.
    expect(document.querySelector("[data-notes-empty]")).toBeNull();
  });

  test("a search announces how many results arrived", async () => {
    const { rerender } = render(<List items={[row(1)]} />);
    await userEvent.type(screen.getByRole("searchbox", { name: COPY.searchLabel }), "polit{Enter}");
    rerender(
      <List
        query="polit"
        search={{ items: [result(1), result(2)], more: false, tooShort: false }}
      />,
    );
    await waitFor(() => expect(announcer()).toHaveTextContent("2 resultados"));
  });

  test("no results: a neutral message, announced; with filters, «Quitar filtros» keeps the search", async () => {
    const { rerender } = render(<List kind="page" />);
    await userEvent.type(screen.getByRole("searchbox", { name: COPY.searchLabel }), "zzz{Enter}");
    rerender(<List kind="page" query="zzz" search={{ items: [], more: false, tooShort: false }} />);
    expect(screen.getByText(COPY.searchNoResultsFiltered("zzz"))).toBeVisible();
    await waitFor(() => expect(announcer()).toHaveTextContent(COPY.searchNoResultsFiltered("zzz")));
    await userEvent.click(screen.getByRole("button", { name: COPY.clearFilters }));
    expect(router.replace).toHaveBeenLastCalledWith("/notes?q=zzz", { scroll: false });
    rerender(<List query="zzz" search={{ items: [], more: false, tooShort: false }} />);
    expect(screen.getByText(COPY.searchNoResults("zzz"))).toBeVisible();
    await waitFor(() => expect(screen.getByRole("radio", { name: COPY.kindAll })).toHaveFocus());
  });

  test("a text too short is announced", async () => {
    const { rerender } = render(<List items={[row(1)]} />);
    await userEvent.type(screen.getByRole("searchbox", { name: COPY.searchLabel }), "p{Enter}");
    rerender(<List query="p" search={{ items: [], more: false, tooShort: true }} />);
    expect(screen.getByText(COPY.searchTooShort)).toBeVisible();
    await waitFor(() => expect(announcer()).toHaveTextContent(COPY.searchTooShort));
  });

  test("«Limpiar búsqueda» goes back to the list and puts the focus in the field", async () => {
    const searching = { items: [result(1)], more: false, tooShort: false };
    const { rerender } = render(<List kind="daily" query="polit" search={searching} />);
    await userEvent.click(screen.getByRole("button", { name: COPY.searchClear }));
    expect(router.replace).toHaveBeenLastCalledWith("/notes?tipo=diario", { scroll: false });
    const field = screen.getByRole("searchbox", { name: COPY.searchLabel });
    expect(field).toHaveFocus();
    expect(field).toHaveValue("");
    // The server answers with the list: the field keeps the focus and the key leaves.
    rerender(<List kind="daily" items={[row(1)]} />);
    expect(field).toHaveFocus();
    expect(screen.queryByRole("button", { name: COPY.searchClear })).toBeNull();
    await waitFor(() => expect(announcer()).toHaveTextContent("1 nota"));
  });

  test("emptying the field while searching goes back to the list (the focus stays)", async () => {
    render(<List query="polit" search={{ items: [result(1)], more: false, tooShort: false }} />);
    const field = screen.getByRole("searchbox", { name: COPY.searchLabel });
    await userEvent.clear(field);
    expect(router.replace).toHaveBeenLastCalledWith("/notes", { scroll: false });
    expect(field).toHaveFocus();
  });

  test("the field follows the URL (the browser's back, another search)", () => {
    const { rerender } = render(
      <List query="polit" search={{ items: [], more: false, tooShort: false }} />,
    );
    const field = screen.getByRole("searchbox", { name: COPY.searchLabel });
    expect(field).toHaveValue("polit");
    rerender(<List query="gim" search={{ items: [], more: false, tooShort: false }} />);
    expect(field).toHaveValue("gim");
    rerender(<List items={[row(1)]} />);
    expect(field).toHaveValue("");
  });

  test("filters and «Ver más» keep the search; the first new result takes the focus", async () => {
    const firstPage = Array.from({ length: 30 }, (_, index) => result(index + 1));
    const { rerender } = render(
      <List query="polit" search={{ items: firstPage, more: true, tooShort: false }} />,
    );
    await userEvent.click(screen.getByRole("radio", { name: COPY.kindPage }));
    expect(router.replace).toHaveBeenLastCalledWith("/notes?q=polit&tipo=notas", {
      scroll: false,
    });
    await userEvent.click(screen.getByRole("button", { name: COPY.showMore }));
    expect(router.replace).toHaveBeenLastCalledWith("/notes?q=polit&n=60", { scroll: false });
    const more = [...firstPage, result(31, { title: "Nota nueva" })];
    rerender(
      <List query="polit" shown={60} search={{ items: more, more: false, tooShort: false }} />,
    );
    await waitFor(() => expect(screen.getByRole("link", { name: /Nota nueva/ })).toHaveFocus());
  });
});
