// N3 of `notes`: «Convertir en tarea» and the live task checkbox in a note's view, against a fake
// server (the actions mocked; the autosave, the queue, the notices and the focus are the real
// ones). Converting waits for what is pending, sends the version and the item, takes the new body
// and version (the next save carries it: no false conflict), puts the focus on the new checkbox
// and offers «Deshacer»; a refusal says why and changes nothing; a conflict sends nothing. The
// checkbox is optimistic, rolls back when the server refuses, keeps the focus and doesn't open the
// editor; a gone or unknown task has no box.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { Markdown } from "@/lib/markdown/markdown";
import { ScreenServicesProvider } from "@/modules/core/components/screen-services";
import { saveNote } from "@/modules/notes/actions";
import { NoteBody } from "@/modules/notes/components/note-body";
import { NoteDayFooter } from "@/modules/notes/components/note-day-footer";
import { NOTE_TASK_ITEMS } from "@/modules/notes/components/note-task-items";
import type { NoteLineActions } from "@/modules/notes/components/note-task-lines";
import { NOTES_COPY as COPY, NOTES_ERRORS } from "@/modules/notes/copy";
import type { ConvertedLine, NoteTaskToggled, SaveResult } from "@/modules/notes/note-input";

vi.mock("@/modules/notes/actions", () => ({
  saveDailyNote: vi.fn(),
  saveNote: vi.fn(),
  deleteNote: vi.fn(),
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const ID = "00000000-0000-4000-8000-000000000001";
const TASK = "0d6f3a8e-1c2b-4d5e-8f90-123456789abc";
const BODY = "Pendientes:\n\n- [ ] Llamar al banco\n- [ ] Pagar la luz";
const CONVERTED_BODY = `Pendientes:\n\n- [[task:${TASK}|Llamar al banco]]\n- [ ] Pagar la luz`;

const actions = {
  convert: vi.fn<NoteLineActions["convert"]>(),
  undoConvert: vi.fn<NoteLineActions["undoConvert"]>(),
  complete: vi.fn<NoteLineActions["complete"]>(),
  reopen: vi.fn<NoteLineActions["reopen"]>(),
};

function Body({
  body = BODY,
  version = 3,
  noteLinks,
}: {
  body?: string;
  version?: number;
  noteLinks?: React.ComponentProps<typeof Markdown>["noteLinks"];
}) {
  return (
    <ScreenServicesProvider label={COPY.noticesLabel} actionHint={COPY.undoHint}>
      <NoteBody
        note={{ id: ID, body, version }}
        day={null}
        rendered={
          <Markdown noteLinks={noteLinks} unknownNoteLinks="deleted" taskItems={NOTE_TASK_ITEMS}>
            {body}
          </Markdown>
        }
        noteLinks={noteLinks}
        shortcuts={false}
        lineActions={actions}
      />
    </ScreenServicesProvider>
  );
}

const convertKey = (text: string) => screen.getByRole("button", { name: COPY.convertLabel(text) });
const checkbox = (name: string) => screen.getByRole("checkbox", { name: COPY.taskDoneLabel(name) });
const notices = () => screen.getByRole("region", { name: COPY.noticesLabel });

const CONVERTED: ConvertedLine = {
  noteId: ID,
  version: 4,
  body: CONVERTED_BODY,
  taskId: TASK,
  title: "Llamar al banco",
  line: 2,
  original: "- [ ] Llamar al banco",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const toggled = (done: boolean, notice: string): ActionResult<NoteTaskToggled> =>
  ok({ id: TASK, title: "Pagar la luz", done, notice });

let user: ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  user = userEvent.setup();
  for (const action of Object.values(actions)) action.mockReset();
  vi.mocked(saveNote).mockReset();
  vi.mocked(saveNote).mockImplementation(async (input) => {
    const { id, body, version } = input as { id: string; body: string; version: number };
    return ok<SaveResult>({ status: "saved", id, body, version: version + 1 });
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("«Convertir en tarea»", () => {
  test("sends the version, the index and the text; takes the new body; focus on the new checkbox; the next save carries the new version", async () => {
    actions.convert.mockResolvedValue(ok(CONVERTED));
    render(<Body />);
    // Only the items that can become tasks: both, each named by its line.
    expect(convertKey("Pagar la luz")).toBeInTheDocument();
    await user.click(convertKey("Llamar al banco"));
    await waitFor(() =>
      expect(actions.convert).toHaveBeenCalledWith({
        noteId: ID,
        version: 3,
        index: 0,
        text: "Llamar al banco",
      }),
    );
    expect(await within(notices()).findByText(COPY.converted("Llamar al banco"))).toBeVisible();
    // The new task's checkbox (known on the spot, pending) takes the focus.
    await waitFor(() => expect(checkbox("Llamar al banco")).not.toBeChecked());
    await waitFor(() => expect(checkbox("Llamar al banco")).toHaveFocus());
    expect(screen.queryByRole("button", { name: COPY.convertLabel("Llamar al banco") })).toBeNull();

    // Typing afterwards saves over version 4 (what the conversion left), never a false conflict.
    await user.click(screen.getByRole("button", { name: COPY.edit }));
    const field = screen.getByRole("textbox", { name: COPY.bodyLabel });
    expect(field).toHaveValue(CONVERTED_BODY);
    await user.type(field, " fin");
    await user.click(screen.getByRole("button", { name: COPY.done }));
    await waitFor(() =>
      expect(saveNote).toHaveBeenCalledWith({ id: ID, body: `${CONVERTED_BODY} fin`, version: 4 }),
    );
    expect(document.querySelector("[data-note-conflict]")).toBeNull();
  });

  test("a save on its way lands first; the conversion then carries its version", async () => {
    const save = deferred<ActionResult<SaveResult>>();
    vi.mocked(saveNote).mockReturnValueOnce(save.promise);
    actions.convert.mockResolvedValue(ok({ ...CONVERTED, version: 5 }));
    render(<Body />);
    await user.click(screen.getByRole("button", { name: COPY.edit }));
    await user.type(screen.getByRole("textbox", { name: COPY.bodyLabel }), "!");
    await user.click(screen.getByRole("button", { name: COPY.done }));
    await waitFor(() => expect(saveNote).toHaveBeenCalledTimes(1));
    await user.click(convertKey("Llamar al banco"));
    // Nothing is sent while the save is in flight.
    expect(actions.convert).not.toHaveBeenCalled();
    await act(async () =>
      save.resolve(ok({ status: "saved", id: ID, body: `${BODY}!`, version: 4 })),
    );
    await waitFor(() =>
      expect(actions.convert).toHaveBeenCalledWith(
        expect.objectContaining({ version: 4, index: 0 }),
      ),
    );
  });

  test("a refusal («Cambió mientras tanto») says why and changes nothing", async () => {
    actions.convert.mockResolvedValue(fail(NOTES_ERRORS.changed));
    render(<Body />);
    await user.click(convertKey("Llamar al banco"));
    expect(
      await within(notices()).findByText(`${COPY.notConverted} ${NOTES_ERRORS.changed}`),
    ).toBeVisible();
    expect(convertKey("Llamar al banco")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  test("in a conflict the key is unavailable and nothing is sent", async () => {
    vi.mocked(saveNote).mockResolvedValue(
      ok<SaveResult>({ status: "conflict", current: { id: ID, body: "Otra", version: 9 } }),
    );
    render(<Body />);
    await user.click(screen.getByRole("button", { name: COPY.edit }));
    await user.type(screen.getByRole("textbox", { name: COPY.bodyLabel }), "!");
    await user.click(screen.getByRole("button", { name: COPY.done }));
    await waitFor(() => expect(document.querySelector("[data-note-conflict]")).not.toBeNull());
    const key = await screen.findByRole("button", { name: COPY.convertLabel("Llamar al banco") });
    expect(key).toHaveAttribute("aria-disabled", "true");
    await user.click(key);
    expect(actions.convert).not.toHaveBeenCalled();
  });

  test("«Deshacer» sends what the conversion left and the line comes back", async () => {
    actions.convert.mockResolvedValue(ok(CONVERTED));
    actions.undoConvert.mockResolvedValue(ok({ noteId: ID, version: 5, body: BODY }));
    render(<Body />);
    await user.click(convertKey("Llamar al banco"));
    await within(notices()).findByText(COPY.converted("Llamar al banco"));
    await user.click(within(notices()).getByRole("button", { name: COPY.undo }));
    await waitFor(() =>
      expect(actions.undoConvert).toHaveBeenCalledWith({
        noteId: ID,
        version: 4,
        taskId: TASK,
        line: 2,
        original: "- [ ] Llamar al banco",
      }),
    );
    expect(
      await screen.findByRole("button", { name: COPY.convertLabel("Llamar al banco") }),
    ).toBeVisible();
    expect(await within(notices()).findByText(COPY.convertUndone("Llamar al banco"))).toBeVisible();
  });
});

describe("«Ese día»", () => {
  test("the counts in one line, named by its region; both at 0 neutral", () => {
    const { unmount } = render(<NoteDayFooter tasksDone={4} habitsDone={1} />);
    const region = screen.getByRole("region", { name: COPY.dayFooterTitle });
    expect(region).toHaveTextContent("Ese día: 4 tareas hechas · 1 hábito cumplido");
    unmount();
    render(<NoteDayFooter tasksDone={0} habitsDone={0} />);
    expect(screen.getByRole("region", { name: COPY.dayFooterTitle })).toHaveTextContent(
      /^Sin registros ese día$/,
    );
  });
});

describe("the live task checkbox", () => {
  const LINKED = `- [[task:${TASK}|Pagar luz]]\n- [[task:00000000-0000-4000-8000-000000000099|Borrada]]`;
  const links = (done: boolean) => ({
    [`task:${TASK}`]: { name: "Pagar la luz", href: `/tasks/${TASK}`, deleted: false, done },
    "task:00000000-0000-4000-8000-000000000099": {
      name: "Borrada",
      href: "/tasks/00000000-0000-4000-8000-000000000099",
      deleted: true,
      done: false,
    },
  });

  test("marking it completes the task (optimistic), keeps the focus and offers «Deshacer»", async () => {
    const answer = deferred<ActionResult<NoteTaskToggled>>();
    actions.complete.mockReturnValue(answer.promise);
    actions.reopen.mockResolvedValue(toggled(false, "«Pagar la luz» volvió a estar pendiente."));
    render(<Body body={LINKED} noteLinks={links(false)} />);
    // A task that is gone has no box (its text is struck through).
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(screen.getByText("Borrada (ya no existe)").closest("li")).toHaveClass("is-gone");

    await user.click(checkbox("Pagar la luz"));
    expect(checkbox("Pagar la luz")).toBeChecked();
    expect(checkbox("Pagar la luz")).toHaveFocus();
    expect(actions.complete).toHaveBeenCalledWith({ id: TASK });
    // The view didn't turn into the editor.
    expect(screen.queryByRole("textbox", { name: COPY.bodyLabel })).toBeNull();
    await act(async () => answer.resolve(toggled(true, "«Pagar la luz» está hecha.")));
    expect(await within(notices()).findByText("«Pagar la luz» está hecha.")).toBeVisible();
    expect(checkbox("Pagar la luz")).toBeChecked();

    await user.click(within(notices()).getByRole("button", { name: COPY.undo }));
    await waitFor(() => expect(actions.reopen).toHaveBeenCalledWith({ id: TASK }));
    await waitFor(() => expect(checkbox("Pagar la luz")).not.toBeChecked());
  });

  test("a refusal rolls the box back and says why; the focus stays", async () => {
    actions.complete.mockResolvedValue(fail("Esta tarea ya no existe (se eliminó)."));
    render(<Body body={LINKED} noteLinks={links(false)} />);
    await user.click(checkbox("Pagar la luz"));
    expect(
      await within(notices()).findByText(
        `${COPY.notToggled} Esta tarea ya no existe (se eliminó).`,
      ),
    ).toBeVisible();
    // The rollback lands when the transition ends: asserted inside waitFor.
    await waitFor(() => expect(checkbox("Pagar la luz")).not.toBeChecked());
    expect(checkbox("Pagar la luz")).toHaveFocus();
  });

  test("unmarking a done task reopens it with `tasks`' undo", async () => {
    actions.reopen.mockResolvedValue(toggled(false, "«Pagar la luz» volvió a estar pendiente."));
    render(<Body body={LINKED} noteLinks={links(true)} />);
    expect(checkbox("Pagar la luz")).toBeChecked();
    await user.click(checkbox("Pagar la luz"));
    await waitFor(() => expect(actions.reopen).toHaveBeenCalledWith({ id: TASK }));
    await waitFor(() => expect(checkbox("Pagar la luz")).not.toBeChecked());
    expect(actions.complete).not.toHaveBeenCalled();
  });

  test("a link nobody resolved (no state) has no box", () => {
    render(<Body body={`- [[task:${TASK}|Pagar luz]]`} noteLinks={{}} />);
    // unknownNoteLinks="deleted" with resolutions: the server looked and found nothing (gone).
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});
