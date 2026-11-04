// N3 of `notes`: the quick capture's «Nota» sheet (SPEC-notes "Captura «Nota»") against a fake
// server: the field has the focus, Enter adds the line and leaves the field empty and focused with
// «Se añadió a la nota de hoy.» and «Deshacer» (which sends exactly what was appended and the
// version left), a refusal keeps the text with its reason, the client's own checks never send, an
// undo the server refuses says «Cambió mientras tanto», and the switcher goes first.
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { captureNote, undoCaptureNote } from "@/modules/notes/actions";
import { NoteCaptureSheet } from "@/modules/notes/components/note-capture-sheet";
import { NOTES_COPY as COPY, NOTES_ERRORS } from "@/modules/notes/copy";
import type { CapturedLine } from "@/modules/notes/note-input";

vi.mock("@/modules/notes/actions", () => ({ captureNote: vi.fn(), undoCaptureNote: vi.fn() }));

const NOTE = "00000000-0000-4000-8000-000000000001";
const LINE: CapturedLine = {
  noteId: NOTE,
  day: "2026-11-03",
  version: 4,
  appended: "\n- 18:42 idea: comparar Neon con Supabase",
  created: false,
};

/** Calls to captureNote wait until the test answers them. */
let answers: ((result: ActionResult<CapturedLine>) => void)[] = [];

beforeEach(() => {
  window.matchMedia = vi.fn((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  answers = [];
  vi.mocked(captureNote)
    .mockReset()
    .mockImplementation(() => new Promise((resolve) => answers.push(resolve)));
  vi.mocked(undoCaptureNote).mockReset();
});

async function answer(result: ActionResult<CapturedLine>) {
  const next = answers.shift();
  if (!next) throw new Error("No pending captureNote");
  await act(async () => next(result));
}

function renderSheet() {
  const onOpenChange = vi.fn();
  const view = render(
    <NoteCaptureSheet
      open
      onOpenChange={onOpenChange}
      returnFocusRef={createRef()}
      switcher={<div data-testid="switcher" />}
    />,
  );
  return { onOpenChange, unmount: view.unmount };
}

const field = () => screen.getByRole("textbox", { name: COPY.captureTextLabel });
const status = () => document.querySelector("[data-capture-status]")!;

describe("NoteCaptureSheet", () => {
  test("opens with the field focused, the switcher first and «Añadir a la nota de hoy»", async () => {
    renderSheet();
    const dialog = screen.getByRole("dialog", { name: COPY.captureTitle });
    expect(dialog).toBeInTheDocument();
    await waitFor(() => expect(field()).toHaveFocus());
    expect(screen.getByTestId("switcher").compareDocumentPosition(field())).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.getByRole("button", { name: COPY.captureAdd })).toBeInTheDocument();
  });

  test("Enter adds the line; the field is empty and focused; «Deshacer» removes exactly it", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(field(), "idea: comparar Neon con Supabase{Enter}");
    expect(captureNote).toHaveBeenCalledWith({ text: "idea: comparar Neon con Supabase" });
    expect(status()).toHaveTextContent(COPY.captureAddingStatus);
    // While saving, closing is refused (the answer would be lost).
    await answer(ok(LINE));
    expect(field()).toHaveValue("");
    expect(field()).toHaveFocus();
    const said = COPY.captured("idea: comparar Neon con Supabase");
    expect(said).toBe("Se añadió «idea: comparar Neon con Supabase» a la nota de hoy.");
    await waitFor(() => expect(status()).toHaveTextContent(said));
    const notice = document.querySelector("[data-note-captured]")!;
    expect(notice).toHaveTextContent(said);

    vi.mocked(undoCaptureNote).mockResolvedValue(ok({ noteId: NOTE, version: 5 }));
    await user.click(screen.getByRole("button", { name: COPY.undo }));
    expect(undoCaptureNote).toHaveBeenCalledWith({
      noteId: NOTE,
      day: "2026-11-03",
      version: 4,
      appended: LINE.appended,
    });
    await waitFor(() => expect(document.querySelector("[data-note-captured]")).toBeNull());
    expect(field()).toHaveFocus();
    await waitFor(() => expect(status()).toHaveTextContent(COPY.captureUndone));
  });

  test("a long text is cut with «…» in the notice", () => {
    const long = "a".repeat(80);
    expect(COPY.captured(long)).toBe(`Se añadió «${"a".repeat(59)}…» a la nota de hoy.`);
  });

  test("an error is said once: through the status only while the field has the focus", async () => {
    const user = userEvent.setup();
    const { unmount } = renderSheet();
    await user.type(field(), "   {Enter}");
    await waitFor(() => expect(status()).toHaveTextContent(NOTES_ERRORS.captureEmpty));
    unmount();

    // From the footer key the focus moves to the field (its description reads the error): the
    // status says nothing.
    renderSheet();
    await user.click(screen.getByRole("button", { name: COPY.captureAdd }));
    await waitFor(() => expect(field()).toHaveFocus());
    expect(field()).toHaveAccessibleDescription(expect.stringContaining(NOTES_ERRORS.captureEmpty));
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(status()).not.toHaveTextContent(NOTES_ERRORS.captureEmpty);
  });

  test("text typed while saving stays for the next one", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(field(), "primera{Enter}");
    await user.type(field(), " y otra");
    await answer(ok(LINE));
    expect(field()).toHaveValue("primera y otra");
  });

  test("the client's own checks never send: empty or too long", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(field(), "   {Enter}");
    expect(captureNote).not.toHaveBeenCalled();
    expect(field()).toHaveAccessibleDescription(expect.stringContaining(NOTES_ERRORS.captureEmpty));
    await user.clear(field());
    await user.click(field());
    await user.paste("a".repeat(501));
    await user.keyboard("{Enter}");
    expect(captureNote).not.toHaveBeenCalled();
    expect(field()).toHaveAccessibleDescription(
      expect.stringContaining(NOTES_ERRORS.captureTooLong),
    );
    expect(field()).toHaveFocus();
  });

  test("a refusal keeps the text and says why on the field; a network failure too", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(field(), "idea{Enter}");
    await answer({
      ok: false,
      error: NOTES_ERRORS.bodyFull,
      fieldErrors: { text: [NOTES_ERRORS.bodyFull] },
    });
    expect(field()).toHaveValue("idea");
    expect(field()).toHaveAccessibleDescription(expect.stringContaining(NOTES_ERRORS.bodyFull));
    expect(field()).toHaveFocus();

    vi.mocked(captureNote).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(field()).toHaveAccessibleDescription(expect.stringContaining(COPY.checkConnection)),
    );
    expect(field()).toHaveValue("idea");
  });

  test("an undo the server refuses says why and keeps the notice", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(field(), "idea{Enter}");
    await answer(ok(LINE));
    vi.mocked(undoCaptureNote).mockResolvedValue(fail(NOTES_ERRORS.changed));
    await user.click(screen.getByRole("button", { name: COPY.undo }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      `${COPY.notUndone} ${NOTES_ERRORS.changed}`,
    );
    expect(document.querySelector("[data-note-captured]")).not.toBeNull();
  });
});
