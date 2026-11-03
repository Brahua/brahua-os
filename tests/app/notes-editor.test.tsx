// N1 of `notes`: a note's body as the owner uses it, against a fake server (the actions mocked; the
// queue, the timers, the notices and the focus handling are the real ones). View and editor
// («Editar», `E`, a tap, «Listo», Esc with focus back), the autosave (1 s after the last key, on
// blur, one in flight and the newest waiting, the version it carries), a day's first save, the
// indicator, a failure that keeps the text, the conflict with its draft, delete, and the timers
// left behind on unmount.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fail, ok } from "@/lib/action-result";
import { requestNavigation } from "@/lib/navigation-guard";
import { ScreenServicesProvider } from "@/modules/core/components/screen-services";
import { deleteNote, saveDailyNote, saveNote } from "@/modules/notes/actions";
import { NoteBody } from "@/modules/notes/components/note-body";
import { NOTES_COPY as COPY } from "@/modules/notes/copy";
import type { SaveResult } from "@/modules/notes/note-input";

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
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => router,
}));

const ID = "00000000-0000-4000-8000-000000000001";
const DAY = "2026-11-03";

type Props = Partial<React.ComponentProps<typeof NoteBody>>;

function Body(props: Props) {
  return (
    <ScreenServicesProvider label={COPY.noticesLabel} actionHint={COPY.undoHint}>
      <NoteBody
        note={{ id: ID, body: "Hola **mundo**", version: 3 }}
        day={null}
        rendered={<p data-testid="server-render">Hola mundo</p>}
        shortcuts
        {...props}
      />
    </ScreenServicesProvider>
  );
}

const textarea = () => screen.getByRole("textbox", { name: COPY.bodyLabel });
const status = () => document.querySelector("[data-note-save-status]")!;
const announcer = () => document.querySelector("[data-screen-announcer]")!;
const saved = (body: string, version: number, id = ID): ReturnType<typeof ok<SaveResult>> =>
  ok({ status: "saved", id, body, version });

let user: ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
  user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  for (const action of [saveDailyNote, saveNote, deleteNote]) vi.mocked(action).mockReset();
  // Whatever a test leaves typed is saved when it unmounts: answer it like the server would.
  vi.mocked(saveNote).mockImplementation(async (input) => {
    const { id, body, version } = input as { id: string; body: string; version: number };
    return saved(body, version + 1, id);
  });
  router.push.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Runs the pending timers (the 1 s autosave) and lets the save settle. */
async function tick(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

describe("view and editor", () => {
  test("a note with text shows the server's render; «Editar» opens the textarea, focused", async () => {
    render(<Body />);
    expect(screen.getByTestId("server-render")).toBeVisible();
    expect(screen.queryByRole("textbox", { name: COPY.bodyLabel })).toBeNull();
    await user.click(screen.getByRole("button", { name: COPY.edit }));
    expect(textarea()).toHaveFocus();
    expect(textarea()).toHaveValue("Hola **mundo**");
  });

  test("«Listo» and Esc go back to the view and focus «Editar»", async () => {
    render(<Body />);
    await user.click(screen.getByRole("button", { name: COPY.edit }));
    await user.click(screen.getByRole("button", { name: COPY.done }));
    await waitFor(() => expect(screen.getByRole("button", { name: COPY.edit })).toHaveFocus());
    await user.click(screen.getByRole("button", { name: COPY.edit }));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.getByRole("button", { name: COPY.edit })).toHaveFocus());
    expect(screen.getByTestId("server-render")).toBeVisible();
  });

  test("a tap on the text opens the editor; a link inside it doesn't", async () => {
    render(
      <Body
        rendered={
          <p>
            Texto con <a href="#enlace">un enlace</a>
          </p>
        }
      />,
    );
    await user.click(screen.getByRole("link", { name: "un enlace" }));
    expect(screen.queryByRole("textbox", { name: COPY.bodyLabel })).toBeNull();
    await user.click(screen.getByText(/Texto con/));
    expect(textarea()).toHaveFocus();
  });

  test("an empty note opens straight in the editor", () => {
    render(<Body note={{ id: null, body: "", version: 0 }} day={DAY} rendered={null} />);
    expect(textarea()).toBeVisible();
    expect(screen.getByRole("button", { name: COPY.done })).toBeVisible();
  });

  test("`E` opens the editor; not while typing, not with shortcuts off", async () => {
    const { unmount } = render(<Body />);
    // The key is named and shown on «Editar».
    const edit = screen.getByRole("button", { name: COPY.edit });
    expect(edit).toHaveAttribute("aria-keyshortcuts", "E");
    expect(edit.querySelector("kbd")).toHaveTextContent("E");
    await user.keyboard("e");
    expect(textarea()).toHaveFocus();
    // Typing an «e» in the field is text, not the key.
    await user.keyboard("e");
    expect(textarea()).toHaveValue("Hola **mundo**e");
    unmount();
    render(<Body shortcuts={false} />);
    expect(screen.getByRole("button", { name: COPY.edit })).not.toHaveAttribute(
      "aria-keyshortcuts",
    );
    await user.keyboard("e");
    expect(screen.queryByRole("textbox", { name: COPY.bodyLabel })).toBeNull();
  });
});

describe("autosave", () => {
  test("1 s after the last key, with the version it edited; the next save carries the new one", async () => {
    vi.mocked(saveNote)
      .mockResolvedValueOnce(saved("Hola **mundo**!", 4))
      .mockResolvedValueOnce(saved("Hola **mundo**!?", 5));
    render(<Body />);
    await user.click(screen.getByRole("button", { name: COPY.edit }));
    await user.type(textarea(), "!");
    // Wide margins: the fake clock also moves with real time (shouldAdvanceTime), and a loaded CI
    // runner can take a while between the key press and the next line.
    await tick(500);
    expect(saveNote).not.toHaveBeenCalled();
    await tick(600);
    await waitFor(() =>
      expect(saveNote).toHaveBeenCalledWith({ id: ID, body: "Hola **mundo**!", version: 3 }),
    );
    await waitFor(() => expect(status()).toHaveTextContent(COPY.saved));
    await user.type(textarea(), "?");
    await tick(1000);
    await waitFor(() =>
      expect(saveNote).toHaveBeenLastCalledWith({ id: ID, body: "Hola **mundo**!?", version: 4 }),
    );
    expect(saveNote).toHaveBeenCalledTimes(2);
  });

  test("leaving the field saves at once; the indicator says «Guardando…» while it runs", async () => {
    let resolve!: (value: Awaited<ReturnType<typeof saveNote>>) => void;
    vi.mocked(saveNote).mockReturnValue(new Promise((done) => (resolve = done)));
    render(<Body />);
    await user.click(screen.getByRole("button", { name: COPY.edit }));
    await user.type(textarea(), " y más");
    await user.tab();
    await waitFor(() => expect(saveNote).toHaveBeenCalledTimes(1));
    expect(status()).toHaveTextContent(COPY.saving);
    expect(document.querySelector("[data-saving]")).not.toBeNull();
    await act(async () => resolve(saved("Hola **mundo** y más", 4)));
    await waitFor(() => expect(status()).toHaveTextContent(COPY.saved));
    expect(document.querySelector("[data-saving]")).toBeNull();
  });

  test("a burst while one is in flight sends only the newest text after it", async () => {
    let resolveFirst!: (value: Awaited<ReturnType<typeof saveNote>>) => void;
    vi.mocked(saveNote)
      .mockReturnValueOnce(new Promise((done) => (resolveFirst = done)))
      .mockResolvedValueOnce(saved("Hola **mundo** abc", 5));
    render(<Body />);
    await user.click(screen.getByRole("button", { name: COPY.edit }));
    await user.type(textarea(), " a");
    await tick(1000);
    await waitFor(() => expect(saveNote).toHaveBeenCalledTimes(1));
    await user.type(textarea(), "b");
    await tick(1000);
    await user.type(textarea(), "c");
    await tick(1000);
    await act(async () => resolveFirst(saved("Hola **mundo** a", 4)));
    await waitFor(() => expect(saveNote).toHaveBeenCalledTimes(2));
    expect(saveNote).toHaveBeenLastCalledWith({ id: ID, body: "Hola **mundo** abc", version: 4 });
    await waitFor(() => expect(status()).toHaveTextContent(COPY.saved));
  });

  test("a day without a note: the first save creates it, the next saves by its id", async () => {
    vi.mocked(saveDailyNote).mockResolvedValueOnce(saved("Hoy", 1, "new-id"));
    vi.mocked(saveNote).mockResolvedValueOnce(saved("Hoy fue", 2, "new-id"));
    render(<Body note={{ id: null, body: "", version: 0 }} day={DAY} rendered={null} />);
    expect(screen.queryByRole("button", { name: COPY.delete })).toBeNull();
    await user.type(textarea(), "Hoy");
    await tick(1000);
    await waitFor(() => expect(saveDailyNote).toHaveBeenCalledWith({ day: DAY, body: "Hoy" }));
    // Created: «Eliminar» shows.
    expect(await screen.findByRole("button", { name: COPY.delete })).toBeVisible();
    await user.type(textarea(), " fue");
    await tick(1000);
    await waitFor(() =>
      expect(saveNote).toHaveBeenCalledWith({ id: "new-id", body: "Hoy fue", version: 1 }),
    );
    expect(saveDailyNote).toHaveBeenCalledTimes(1);
  });

  test("only spaces on an empty day send nothing (never an empty note)", async () => {
    render(<Body note={{ id: null, body: "", version: 0 }} day={DAY} rendered={null} />);
    await user.type(textarea(), "   ");
    await tick(1000);
    await user.tab();
    expect(saveDailyNote).not.toHaveBeenCalled();
  });

  test("a failure keeps the text and says «Sin guardar: …»; the next key tries again", async () => {
    vi.mocked(saveNote)
      .mockResolvedValueOnce(fail("No se pudo guardar. Inténtalo de nuevo en un momento."))
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(saved("Hola **mundo** 123", 4));
    render(<Body />);
    await user.click(screen.getByRole("button", { name: COPY.edit }));
    await user.type(textarea(), " 1");
    await tick(1000);
    await waitFor(() =>
      expect(status()).toHaveTextContent(
        "Sin guardar: No se pudo guardar. Inténtalo de nuevo en un momento.",
      ),
    );
    expect(textarea()).toHaveValue("Hola **mundo** 1");
    await user.type(textarea(), "2");
    await tick(1000);
    await waitFor(() => expect(status()).toHaveTextContent(COPY.unsaved(COPY.checkConnection)));
    await user.type(textarea(), "3");
    await tick(1000);
    await waitFor(() => expect(status()).toHaveTextContent(COPY.saved));
    expect(saveNote).toHaveBeenLastCalledWith({ id: ID, body: "Hola **mundo** 123", version: 3 });
  });

  test("unmounting saves what is pending once and leaves no timer behind", async () => {
    vi.mocked(saveNote).mockResolvedValue(saved("Hola **mundo**!", 4));
    const { unmount } = render(<Body />);
    await user.click(screen.getByRole("button", { name: COPY.edit }));
    await user.type(textarea(), "!");
    unmount();
    await waitFor(() => expect(saveNote).toHaveBeenCalledTimes(1));
    await tick(5000);
    expect(saveNote).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("leaving with something unsaved", () => {
  test("nothing pending: an in-app navigation goes ahead (positive control)", () => {
    render(<Body />);
    const go = vi.fn();
    requestNavigation("/notes", go);
    expect(go).toHaveBeenCalledTimes(1);
  });

  test("text not saved yet: asks, saves, and goes ahead once the save lands", async () => {
    let resolve!: (value: Awaited<ReturnType<typeof saveNote>>) => void;
    vi.mocked(saveNote).mockReturnValueOnce(new Promise((done) => (resolve = done)));
    render(<Body />);
    await user.click(screen.getByRole("button", { name: COPY.edit }));
    await user.type(textarea(), "!");
    const go = vi.fn();
    act(() => requestNavigation("/notes", go));
    expect(go).not.toHaveBeenCalled();
    expect(await screen.findByText(COPY.leaveTitle)).toBeVisible();
    expect(screen.getByRole("button", { name: COPY.stay })).toHaveFocus();
    // The question saved what was pending at once (no 1 s wait).
    expect(saveNote).toHaveBeenCalledWith({ id: ID, body: "Hola **mundo**!", version: 3 });
    await act(async () => resolve(saved("Hola **mundo**!", 4)));
    await waitFor(() => expect(go).toHaveBeenCalledTimes(1));
  });

  test("«Seguir editando» stays, with the focus back in the text", async () => {
    vi.mocked(saveNote).mockReturnValueOnce(new Promise(() => {}));
    render(<Body />);
    await user.click(screen.getByRole("button", { name: COPY.edit }));
    await user.type(textarea(), "!");
    const go = vi.fn();
    act(() => requestNavigation("/notes", go));
    await user.click(await screen.findByRole("button", { name: COPY.stay }));
    await waitFor(() => expect(textarea()).toHaveFocus());
    expect(screen.queryByText(COPY.leaveTitle)).toBeNull();
    expect(go).not.toHaveBeenCalled();
  });
});

describe("two devices", () => {
  const STORED = { id: ID, body: "Texto del otro dispositivo", version: 7 };

  async function conflictAfterTyping() {
    vi.mocked(saveNote).mockResolvedValueOnce(ok({ status: "conflict", current: STORED }));
    render(<Body />);
    await user.click(screen.getByRole("button", { name: COPY.edit }));
    await user.type(textarea(), " mío");
    await tick(1000);
    expect(await screen.findByText(COPY.conflictTitle)).toBeVisible();
  }

  test("a conflict stops the autosave and keeps the text; «Quedarme con la mía» overwrites", async () => {
    await conflictAfterTyping();
    // The owner was typing: the focus stays in the text and the notice is announced.
    expect(textarea()).toHaveFocus();
    await waitFor(() =>
      expect(announcer()).toHaveTextContent(`${COPY.conflictTitle}. ${COPY.conflictText}`),
    );
    expect(textarea()).toHaveValue("Hola **mundo** mío");
    // More typing doesn't save while the owner hasn't decided.
    await user.type(textarea(), "!");
    await tick(2000);
    expect(saveNote).toHaveBeenCalledTimes(1);
    vi.mocked(saveNote).mockResolvedValueOnce(saved("Hola **mundo** mío!", 8));
    await user.click(screen.getByRole("button", { name: COPY.keepMine }));
    await waitFor(() =>
      expect(saveNote).toHaveBeenLastCalledWith({
        id: ID,
        body: "Hola **mundo** mío!",
        version: 7,
      }),
    );
    await waitFor(() => expect(status()).toHaveTextContent(COPY.saved));
    expect(screen.queryByText(COPY.conflictTitle)).toBeNull();
  });

  test("«Ver la versión guardada» shows it and keeps the local text as a draft", async () => {
    await conflictAfterTyping();
    await user.click(screen.getByRole("button", { name: COPY.viewSaved }));
    expect(await screen.findByText("Texto del otro dispositivo")).toBeVisible();
    expect(screen.getByRole("textbox", { name: COPY.draftLabel })).toHaveValue(
      "Hola **mundo** mío",
    );
    expect(screen.getByRole("button", { name: COPY.edit })).toHaveFocus();
    // The next edit saves on top of the stored version.
    vi.mocked(saveNote).mockResolvedValueOnce(saved("Texto del otro dispositivo.", 8));
    await user.click(screen.getByRole("button", { name: COPY.edit }));
    await user.type(textarea(), ".");
    await tick(1000);
    await waitFor(() =>
      expect(saveNote).toHaveBeenLastCalledWith({
        id: ID,
        body: "Texto del otro dispositivo.",
        version: 7,
      }),
    );
    await waitFor(() => expect(status()).toHaveTextContent(COPY.saved));
    // Everything typed is saved, but the draft kept aside isn't: leaving still asks.
    const go = vi.fn();
    act(() => requestNavigation("/notes", go));
    expect(go).not.toHaveBeenCalled();
    expect(await screen.findByText(COPY.leaveTitle)).toBeVisible();
    await user.click(screen.getByRole("button", { name: COPY.stay }));
    await user.click(screen.getByRole("button", { name: COPY.discardDraft }));
    expect(screen.queryByRole("textbox", { name: COPY.draftLabel })).toBeNull();
    // The key left: the focus goes to the text.
    await waitFor(() => expect(textarea()).toHaveFocus());
    // Nothing unsaved now (positive control): the navigation goes ahead.
    requestNavigation("/notes", go);
    expect(go).toHaveBeenCalledTimes(1);
  });

  test("a conflict while the focus is outside the editor takes the focus to the notice", async () => {
    vi.mocked(saveNote).mockResolvedValueOnce(ok({ status: "conflict", current: STORED }));
    render(<Body />);
    await user.click(screen.getByRole("button", { name: COPY.edit }));
    await user.type(textarea(), " mío");
    // Leaving the field saves at once: the focus is on the next control when the answer comes.
    await user.tab();
    await waitFor(() => expect(screen.getByText(COPY.conflictTitle)).toHaveFocus());
  });

  test("a day's first save that finds a note: the conflict, «Eliminar» for it, and «Quedarme con la mía»", async () => {
    const theirs = { id: "their-id", body: "Escrito en el celular", version: 2 };
    vi.mocked(saveDailyNote).mockResolvedValueOnce(ok({ status: "conflict", current: theirs }));
    render(<Body note={{ id: null, body: "", version: 0 }} day={DAY} rendered={null} />);
    expect(screen.queryByRole("button", { name: COPY.delete })).toBeNull();
    await user.type(textarea(), "Desde la laptop");
    await tick(1000);
    expect(await screen.findByText(COPY.conflictTitle)).toBeVisible();
    expect(screen.getByRole("button", { name: COPY.delete })).toBeVisible();
    await user.click(screen.getByRole("button", { name: COPY.keepMine }));
    await waitFor(() =>
      expect(saveNote).toHaveBeenLastCalledWith({
        id: "their-id",
        body: "Desde la laptop",
        version: 2,
      }),
    );
  });
});

describe("events, retries and announcements", () => {
  test("hiding the page and `pagehide` save what is pending at once", async () => {
    render(<Body />);
    await user.click(screen.getByRole("button", { name: COPY.edit }));
    await user.type(textarea(), "!");
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(saveNote).toHaveBeenCalledTimes(1));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    await user.type(textarea(), "?");
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    await waitFor(() => expect(saveNote).toHaveBeenCalledTimes(2));
    expect(saveNote).toHaveBeenLastCalledWith({ id: ID, body: "Hola **mundo**!?", version: 4 });
  });

  test("a failed save: «Reintentar» tries again and gives the focus back to the text", async () => {
    vi.mocked(saveNote).mockRejectedValueOnce(new Error("network"));
    render(<Body />);
    await user.click(screen.getByRole("button", { name: COPY.edit }));
    await user.type(textarea(), "!");
    await tick(1000);
    const retry = await screen.findByRole("button", { name: COPY.retry });
    await user.click(retry);
    await waitFor(() => expect(saveNote).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(status()).toHaveTextContent(COPY.saved));
    expect(screen.queryByRole("button", { name: COPY.retry })).toBeNull();
    expect(textarea()).toHaveFocus();
  });

  test("back online, a failed save is tried again", async () => {
    vi.mocked(saveNote).mockRejectedValueOnce(new Error("network"));
    render(<Body />);
    await user.click(screen.getByRole("button", { name: COPY.edit }));
    await user.type(textarea(), "!");
    await tick(1000);
    await screen.findByRole("button", { name: COPY.retry });
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => expect(saveNote).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(status()).toHaveTextContent(COPY.saved));
    // Recovering from a failure is announced.
    await waitFor(() => expect(announcer()).toHaveTextContent(COPY.saved));
  });

  test("«Guardando…» is only visual; the same failure is announced once, not on every pause", async () => {
    vi.mocked(saveNote).mockResolvedValue(
      fail("No se pudo guardar. Inténtalo de nuevo en un momento."),
    );
    const messages: string[] = [];
    const observer = new MutationObserver(() => {
      const text = announcer().textContent;
      if (text) messages.push(text);
    });
    render(<Body />);
    observer.observe(announcer(), { childList: true, characterData: true, subtree: true });
    expect(status()).not.toHaveAttribute("role");
    expect(status()).not.toHaveAttribute("aria-live");
    await user.click(screen.getByRole("button", { name: COPY.edit }));
    for (const key of ["1", "2", "3"]) {
      await user.type(textarea(), key);
      await tick(1000);
      await waitFor(() => expect(saveNote).toHaveBeenCalled());
    }
    await waitFor(() => expect(saveNote).toHaveBeenCalledTimes(3));
    await tick(200);
    observer.disconnect();
    expect(messages).toEqual([
      COPY.unsaved("No se pudo guardar. Inténtalo de nuevo en un momento."),
    ]);
  });

  test("«Listo» with a save pending saves it now and says «Guardado» once it lands", async () => {
    render(<Body />);
    await user.click(screen.getByRole("button", { name: COPY.edit }));
    await user.type(textarea(), "!");
    await user.click(screen.getByRole("button", { name: COPY.done }));
    // No 1 s wait: closing saved it.
    await waitFor(() =>
      expect(saveNote).toHaveBeenCalledWith({ id: ID, body: "Hola **mundo**!", version: 3 }),
    );
    await waitFor(() => expect(announcer()).toHaveTextContent(COPY.saved));
  });

  test("Esc with a save pending saves it too", async () => {
    render(<Body />);
    await user.click(screen.getByRole("button", { name: COPY.edit }));
    await user.type(textarea(), "?");
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(saveNote).toHaveBeenCalledWith({ id: ID, body: "Hola **mundo**?", version: 3 }),
    );
  });

  test("over 50 000 characters: the editor says it and sends nothing", async () => {
    render(<Body />);
    await user.click(screen.getByRole("button", { name: COPY.edit }));
    act(() => {
      fireEvent.change(textarea(), { target: { value: "x".repeat(50_001) } });
    });
    await tick(1000);
    expect(saveNote).not.toHaveBeenCalled();
    expect(screen.getAllByText(COPY.overLimit(50_001, 50_000)).length).toBeGreaterThan(0);
    expect(textarea()).toHaveAttribute("aria-invalid", "true");
    expect(status()).toHaveTextContent(COPY.unsaved(COPY.overLimit(50_001, 50_000)));
  });

  test("an empty note mounts with the cursor in the text", () => {
    render(<Body note={{ id: null, body: "", version: 0 }} day={DAY} rendered={null} />);
    expect(textarea()).toHaveFocus();
  });
});

describe("delete", () => {
  test("«Eliminar» deletes by id and goes to the list with ?deleted=<id>", async () => {
    vi.mocked(deleteNote).mockResolvedValue(
      ok({ id: ID, kind: "page", day: null, title: "Apuntes" }),
    );
    render(<Body />);
    await user.click(screen.getByRole("button", { name: COPY.delete }));
    expect(deleteNote).toHaveBeenCalledWith({ id: ID });
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/notes?deleted=${ID}`));
  });

  test("a refused delete stays and says why", async () => {
    vi.mocked(deleteNote).mockResolvedValue(fail("Esta nota ya no existe (se eliminó)."));
    render(<Body />);
    await user.click(screen.getByRole("button", { name: COPY.delete }));
    expect(
      await screen.findByText(`${COPY.notSaved.delete} Esta nota ya no existe (se eliminó).`),
    ).toBeVisible();
    expect(router.push).not.toHaveBeenCalled();
  });

  test("after a refused delete the autosave still works", async () => {
    vi.mocked(deleteNote).mockResolvedValue(
      fail("No se pudo guardar. Inténtalo de nuevo en un momento."),
    );
    render(<Body />);
    await user.click(screen.getByRole("button", { name: COPY.delete }));
    await screen.findByText(/No se eliminó la nota/);
    await user.click(screen.getByRole("button", { name: COPY.edit }));
    await user.type(textarea(), "!");
    await tick(1000);
    await waitFor(() =>
      expect(saveNote).toHaveBeenCalledWith({ id: ID, body: "Hola **mundo**!", version: 3 }),
    );
  });

  test("the last second of text is saved before the delete", async () => {
    const order: string[] = [];
    vi.mocked(saveNote).mockImplementation(async () => {
      order.push("save");
      return saved("Hola **mundo**!", 4);
    });
    vi.mocked(deleteNote).mockImplementation(async () => {
      order.push("delete");
      return ok({ id: ID, kind: "page", day: null, title: "Apuntes" });
    });
    render(<Body />);
    await user.click(screen.getByRole("button", { name: COPY.edit }));
    await user.type(textarea(), "!");
    // Before the 1 s autosave.
    await user.click(screen.getByRole("button", { name: COPY.delete }));
    await waitFor(() => expect(router.push).toHaveBeenCalled());
    expect(order).toEqual(["save", "delete"]);
  });
});
