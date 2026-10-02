// T4: the tag field (an editable WAI-ARIA combobox with list autocomplete), the detail's
// "Etiquetas" section (saves the whole set, rolls back if refused), the tags in a row (heard
// through its description) and tags in the quick capture.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, useState } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { Sheet } from "@/design-system";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { createTask, listTaskTargets } from "@/modules/tasks/actions";
import {
  TaskDetailProvider,
  TaskDetailSheetMessages,
} from "@/modules/tasks/components/detail/task-detail-context";
import { TaskTagsSection } from "@/modules/tasks/components/detail/task-tags-section";
import { QuickCaptureSheet } from "@/modules/tasks/components/quick-capture-sheet";
import { TagInput } from "@/modules/tasks/components/tag-input";
import { TaskRow } from "@/modules/tasks/components/task-row";
import { TasksScreen } from "@/modules/tasks/components/tasks-screen";
import { listTaskTags, setTaskTags } from "@/modules/tasks/tag-actions";
import type { TaskItem } from "@/modules/tasks/task-input";
import { TAGS_COPY } from "@/modules/tasks/tags-copy";

vi.mock("@/modules/tasks/actions", () => ({
  createTask: vi.fn(),
  listTaskTargets: vi.fn(),
  editTask: vi.fn(),
}));
vi.mock("@/modules/tasks/tag-actions", () => ({ listTaskTags: vi.fn(), setTaskTags: vi.fn() }));

const NOW = new Date("2026-10-02T15:00:00.000Z");
const KNOWN = ["hogar", "compras", "comida", "salud"];

const task = (values: Partial<TaskItem> = {}): TaskItem => ({
  id: "00000000-0000-4000-8000-000000000001",
  title: "regar plantas",
  priority: "medium",
  dueDate: null,
  doneAt: null,
  createdAt: NOW,
  lifeAreaId: null,
  projectId: null,
  milestoneId: null,
  isNextAction: false,
  area: null,
  project: null,
  recurrence: null,
  tags: [],
  ...values,
});

const tagsOf = (...names: string[]) =>
  names.map((name, index) => ({ id: `tag-${index}-${name}`, name }));

beforeEach(() => {
  window.matchMedia = vi.fn((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  vi.mocked(listTaskTags).mockReset().mockResolvedValue(ok(KNOWN));
  vi.mocked(setTaskTags).mockReset();
  vi.mocked(listTaskTargets)
    .mockReset()
    .mockResolvedValue(ok({ areas: [], projects: [] }));
  vi.mocked(createTask).mockReset();
});

/** The tag field alone (controlled), inside a sheet like everywhere it is used. */
function Field({ initial = [] as string[], known = KNOWN as string[] | null }) {
  const [value, setValue] = useState(initial);
  const [open, setOpen] = useState(true);
  return (
    <>
      <p data-testid="sheet-open">{String(open)}</p>
      <Sheet open={open} onOpenChange={setOpen} title="Hoja">
        <TagInput
          id="tags"
          label="Etiquetas"
          value={value}
          onValueChange={setValue}
          known={known}
        />
        <button type="button">Después</button>
      </Sheet>
    </>
  );
}

const combobox = () => screen.getByRole("combobox", { name: "Etiquetas" });
const listbox = () => screen.getByRole("listbox", { hidden: true });
const chips = () =>
  screen.queryByRole("list", { name: TAGS_COPY.chosenList })
    ? within(screen.getByRole("list", { name: TAGS_COPY.chosenList }))
        .getAllByRole("listitem")
        .map((item) => item.textContent)
    : [];
const tagStatus = () => document.querySelector("[data-tag-status]")!;

describe("TagInput (combobox)", () => {
  test("WAI-ARIA wiring: combobox with list autocomplete, a listbox it controls, closed at first", () => {
    render(<Field />);
    const input = combobox();
    expect(input).toHaveAttribute("aria-autocomplete", "list");
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(input).toHaveAttribute("aria-controls", listbox().id);
    expect(input).not.toHaveAttribute("aria-activedescendant");
    expect(listbox()).not.toBeVisible();
    expect(input).toHaveAccessibleDescription(TAGS_COPY.help);
  });

  test("typing suggests the matching tags (starting ones first); no automatic selection", async () => {
    const user = userEvent.setup();
    render(<Field />);
    await user.type(combobox(), "co");
    expect(combobox()).toHaveAttribute("aria-expanded", "true");
    const options = within(listbox()).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["compras", "comida"]);
    expect(options.every((option) => option.getAttribute("aria-selected") === "false")).toBe(true);
    expect(combobox()).not.toHaveAttribute("aria-activedescendant");
  });

  test("↓/↑ move the active option (focus stays in the field); Enter adds it", async () => {
    const user = userEvent.setup();
    render(<Field />);
    await user.type(combobox(), "co");
    await user.keyboard("{ArrowDown}");
    let options = within(listbox()).getAllByRole("option");
    expect(combobox()).toHaveAttribute("aria-activedescendant", options[0].id);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowDown}");
    expect(combobox()).toHaveAttribute("aria-activedescendant", options[1].id);
    await user.keyboard("{ArrowDown}");
    expect(combobox()).toHaveAttribute("aria-activedescendant", options[0].id);
    await user.keyboard("{ArrowUp}");
    options = within(listbox()).getAllByRole("option");
    expect(combobox()).toHaveAttribute("aria-activedescendant", options[1].id);
    expect(combobox()).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(chips()).toEqual(["comida"]);
    expect(combobox()).toHaveValue("");
    expect(combobox()).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(tagStatus()).toHaveTextContent(TAGS_COPY.added("comida")));
  });

  test("↓ with nothing typed opens the most used ones", async () => {
    const user = userEvent.setup();
    render(<Field initial={["hogar"]} />);
    await user.click(combobox());
    await user.keyboard("{ArrowDown}");
    expect(
      within(listbox())
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["compras", "comida", "salud"]);
  });

  test("Enter adds what was typed, normalized (a new tag); a comma too", async () => {
    const user = userEvent.setup();
    render(<Field />);
    await user.type(combobox(), "  Super   Mercado {Enter}");
    await user.type(combobox(), "Plantas,");
    expect(chips()).toEqual(["super mercado", "plantas"]);
    expect(combobox()).toHaveValue("");
    expect(combobox()).toHaveAccessibleDescription(`${TAGS_COPY.help} ${TAGS_COPY.count(2)}`);
  });

  test("pasting a list with commas adds each one and keeps the rest typed", async () => {
    const user = userEvent.setup();
    render(<Field />);
    await user.click(combobox());
    await user.paste("hogar, compras,salud");
    expect(chips()).toEqual(["hogar", "compras"]);
    expect(combobox()).toHaveValue("salud");
  });

  test("a click on a suggestion adds it and keeps focus in the field", async () => {
    const user = userEvent.setup();
    render(<Field />);
    await user.type(combobox(), "sa");
    await user.click(within(listbox()).getByRole("option", { name: "salud" }));
    expect(chips()).toEqual(["salud"]);
    expect(combobox()).toHaveFocus();
  });

  test("one already there is not added twice (and it says so)", async () => {
    const user = userEvent.setup();
    render(<Field initial={["hogar"]} />);
    await user.type(combobox(), "HOGAR{Enter}");
    expect(chips()).toEqual(["hogar"]);
    await waitFor(() => expect(tagStatus()).toHaveTextContent(TAGS_COPY.already("hogar")));
  });

  test("an invalid name stays in the field with its error; nothing is added", async () => {
    const user = userEvent.setup();
    render(<Field />);
    await user.type(combobox(), `${"a".repeat(31)}{Enter}`);
    expect(chips()).toEqual([]);
    expect(combobox()).toHaveValue("a".repeat(31));
    expect(combobox()).toHaveAttribute("aria-invalid", "true");
    expect(combobox()).toHaveAccessibleDescription(TAGS_COPY.errors.tooLong);
    await user.type(combobox(), "{Backspace}");
    expect(combobox()).toHaveAttribute("aria-invalid", "false");
  });

  test("at most 10: the eleventh is refused with the reason", async () => {
    const user = userEvent.setup();
    const ten = Array.from({ length: 10 }, (_, index) => `t${index}`);
    render(<Field initial={ten} />);
    expect(combobox()).toHaveAccessibleDescription(TAGS_COPY.full);
    await user.type(combobox(), "otra{Enter}");
    expect(chips()).toHaveLength(10);
    expect(combobox()).toHaveAccessibleDescription(TAGS_COPY.full);
    expect(combobox()).toHaveAttribute("aria-invalid", "true");
  });

  test("each chip's key removes it and says so; focus to the next chip's key, or the field after the last", async () => {
    const user = userEvent.setup();
    render(<Field initial={["hogar", "compras"]} />);
    await user.click(screen.getByRole("button", { name: TAGS_COPY.remove("hogar") }));
    expect(chips()).toEqual(["compras"]);
    expect(screen.getByRole("button", { name: TAGS_COPY.remove("compras") })).toHaveFocus();
    await waitFor(() => expect(tagStatus()).toHaveTextContent(TAGS_COPY.removed("hogar")));
    await user.keyboard("{Enter}");
    expect(chips()).toEqual([]);
    expect(combobox()).toHaveFocus();
  });

  test("the number of suggestions is said once the list settles while typing", async () => {
    const user = userEvent.setup();
    render(<Field />);
    await user.type(combobox(), "co");
    await waitFor(() => expect(tagStatus()).toHaveTextContent(TAGS_COPY.suggestionsCount(2)));
    await user.type(combobox(), "m");
    await waitFor(() => expect(tagStatus()).toHaveTextContent(TAGS_COPY.suggestionsCount(2)));
    await user.type(combobox(), "p");
    await waitFor(() => expect(tagStatus()).toHaveTextContent(TAGS_COPY.suggestionsCount(1)));
  });

  test("a tag created here is suggested again after removing it (before the server knows it)", async () => {
    const user = userEvent.setup();
    render(<Field />);
    await user.type(combobox(), "nueva{Enter}");
    await user.click(screen.getByRole("button", { name: TAGS_COPY.remove("nueva") }));
    await user.type(combobox(), "nu");
    expect(
      within(listbox())
        .getAllByRole("option")
        .map((one) => one.textContent),
    ).toEqual(["nueva"]);
  });

  test("a paste refused halfway keeps only the refused part and the rest in the field", async () => {
    const user = userEvent.setup();
    render(<Field />);
    await user.click(combobox());
    await user.paste(`hogar, ${"a".repeat(31)}, salud`);
    expect(chips()).toEqual(["hogar"]);
    expect(combobox()).toHaveValue(` ${"a".repeat(31)}, salud`);
    expect(combobox()).toHaveAccessibleDescription(TAGS_COPY.errors.tooLong);
  });

  test("Esc closes the open list, not the sheet; a second Esc closes the sheet", async () => {
    const user = userEvent.setup();
    render(<Field />);
    await user.type(combobox(), "co");
    expect(combobox()).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Escape}");
    expect(combobox()).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("sheet-open")).toHaveTextContent("true");
    await user.keyboard("{Escape}");
    expect(screen.getByTestId("sheet-open")).toHaveTextContent("false");
  });

  test("leaving the field adds what was typed (nothing written is lost)", async () => {
    const user = userEvent.setup();
    render(<Field />);
    await user.type(combobox(), "plantas");
    await user.tab();
    expect(chips()).toEqual(["plantas"]);
    expect(combobox()).toHaveValue("");
  });

  test("keyboard only: Tab reaches the field, then each chip's key", async () => {
    const user = userEvent.setup();
    render(<Field initial={["hogar"]} />);
    combobox().focus();
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: TAGS_COPY.remove("hogar") })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(chips()).toEqual([]);
    expect(combobox()).toHaveFocus();
  });

  test("while the suggestions load it still adds what is typed", async () => {
    const user = userEvent.setup();
    render(<Field known={null} />);
    await user.type(combobox(), "x{Enter}");
    expect(chips()).toEqual(["x"]);
    expect(combobox()).toHaveAttribute("aria-expanded", "false");
  });
});

/** The detail's section with a fake `setTaskTags` the test answers. */
function renderSection(initial: TaskItem) {
  const answers: ((result: ActionResult<TaskItem>) => void)[] = [];
  vi.mocked(setTaskTags).mockImplementation(() => new Promise((resolve) => answers.push(resolve)));
  render(
    <TasksScreen now={NOW} targets={{ areas: [], projects: [] }}>
      <TaskDetailProvider task={initial} host="sheet" onDeleted={vi.fn()}>
        <TaskDetailSheetMessages />
        <TaskTagsSection />
      </TaskDetailProvider>
    </TasksScreen>,
  );
  return {
    async answer(result: ActionResult<TaskItem>) {
      const next = answers.shift();
      if (!next) throw new Error("No pending setTaskTags");
      await act(async () => next(result));
    },
  };
}

const sectionInput = () => screen.getByRole("combobox", { name: TAGS_COPY.inputLabel });

describe("detail: Etiquetas", () => {
  test("a heading, the chips; adding saves the whole set at once and adopts the answer", async () => {
    const user = userEvent.setup();
    const server = renderSection(task({ tags: tagsOf("hogar") }));
    expect(screen.getByRole("heading", { level: 3, name: TAGS_COPY.label })).toBeInTheDocument();
    await waitFor(() => expect(listTaskTags).toHaveBeenCalled());
    await user.type(sectionInput(), "Compras{Enter}");
    expect(setTaskTags).toHaveBeenCalledWith({ id: task().id, tags: ["hogar", "compras"] });
    // Shown at once.
    expect(chips()).toEqual(["hogar", "compras"]);
    await server.answer(ok(task({ tags: tagsOf("compras", "hogar") })));
    expect(chips()).toEqual(["compras", "hogar"]);
  });

  test("a refused save rolls back and says why inside the sheet", async () => {
    const user = userEvent.setup();
    const server = renderSection(task({ tags: tagsOf("hogar") }));
    await user.click(screen.getByRole("button", { name: TAGS_COPY.remove("hogar") }));
    expect(setTaskTags).toHaveBeenCalledWith({ id: task().id, tags: [] });
    expect(chips()).toEqual([]);
    await server.answer(fail("Esta tarea ya no existe (se eliminó)."));
    expect(chips()).toEqual(["hogar"]);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "No se pudo guardar las etiquetas; volvió a como estaba. Esta tarea ya no existe (se eliminó).",
    );
  });

  test("two quick edits: the one in flight, then the last (one queue key)", async () => {
    const user = userEvent.setup();
    const server = renderSection(task());
    await user.type(sectionInput(), "a{Enter}");
    await user.type(sectionInput(), "b{Enter}");
    await user.type(sectionInput(), "c{Enter}");
    expect(chips()).toEqual(["a", "b", "c"]);
    await server.answer(ok(task({ tags: tagsOf("a") })));
    await waitFor(() => expect(setTaskTags).toHaveBeenCalledTimes(2));
    expect(setTaskTags).toHaveBeenLastCalledWith({ id: task().id, tags: ["a", "b", "c"] });
    await server.answer(ok(task({ tags: tagsOf("a", "b", "c") })));
    expect(chips()).toEqual(["a", "b", "c"]);
  });
});

describe("row", () => {
  test("compact chips (three and +N), aria-hidden; heard through the title's description", () => {
    render(
      <ul>
        <li>
          <TaskRow
            task={task({ tags: tagsOf("compras", "hogar", "salud", "urgente") })}
            now={NOW}
            onToggle={vi.fn()}
            onOpen={vi.fn()}
          />
        </li>
      </ul>,
    );
    expect(screen.getByRole("link", { name: "regar plantas" })).toHaveAccessibleDescription(
      "Etiquetas: compras, hogar, salud, urgente",
    );
    const shown = document.querySelector("[data-task-tags]")!;
    expect(shown.closest("[aria-hidden]")).not.toBeNull();
    expect([...shown.querySelectorAll(".bo-task-tag")].map((chip) => chip.textContent)).toEqual([
      "compras",
      "hogar",
      "salud",
      "+1",
    ]);
  });

  test("one tag reads in the singular; none shows nothing", () => {
    const { unmount } = render(
      <TaskRow
        task={task({ tags: tagsOf("hogar") })}
        now={NOW}
        onToggle={vi.fn()}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByRole("link")).toHaveAccessibleDescription("Etiqueta: hogar");
    unmount();
    render(<TaskRow task={task()} now={NOW} onToggle={vi.fn()} onOpen={vi.fn()} />);
    expect(document.querySelector("[data-task-tags]")).toBeNull();
  });
});

describe("quick capture", () => {
  test("tags under Más detalles go with the task; then the field is empty again", async () => {
    const user = userEvent.setup();
    let answer: (result: ActionResult<TaskItem>) => void = () => {};
    vi.mocked(createTask).mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    render(<QuickCaptureSheet open onOpenChange={vi.fn()} returnFocusRef={createRef()} />);
    await user.click(screen.getByRole("button", { name: "Más detalles" }));
    const field = screen.getByRole("combobox", { name: TAGS_COPY.label });
    await user.type(field, "Compras{Enter}hog");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(chips()).toEqual(["compras", "hogar"]);
    await user.type(screen.getByRole("textbox", { name: "¿Qué hay que hacer?" }), "pilas{Enter}");
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({ title: "pilas", tags: ["compras", "hogar"] }),
    );
    await act(async () => answer(ok(task({ title: "pilas" }))));
    expect(chips()).toEqual([]);
  });

  test("Enter in the tag field with nothing typed and the list closed doesn't save", async () => {
    const user = userEvent.setup();
    render(<QuickCaptureSheet open onOpenChange={vi.fn()} returnFocusRef={createRef()} />);
    await user.type(screen.getByRole("textbox", { name: "¿Qué hay que hacer?" }), "pilas");
    await user.click(screen.getByRole("button", { name: "Más detalles" }));
    const field = screen.getByRole("combobox", { name: TAGS_COPY.label });
    field.focus();
    await user.keyboard("{Enter}");
    expect(field).toHaveAttribute("aria-expanded", "false");
    expect(createTask).not.toHaveBeenCalled();
  });

  test("a server refusal of a tag opens Más detalles with the error on the field", async () => {
    const user = userEvent.setup();
    vi.mocked(createTask).mockResolvedValue({
      ok: false,
      error: "Revisa los campos marcados.",
      fieldErrors: { "tags.0": [TAGS_COPY.errors.tooLong] },
    });
    render(<QuickCaptureSheet open onOpenChange={vi.fn()} returnFocusRef={createRef()} />);
    await user.click(screen.getByRole("button", { name: "Más detalles" }));
    await user.type(screen.getByRole("combobox", { name: TAGS_COPY.label }), "x{Enter}");
    await user.type(screen.getByRole("textbox", { name: "¿Qué hay que hacer?" }), "pilas{Enter}");
    const field = screen.getByRole("combobox", { name: TAGS_COPY.label });
    await waitFor(() => expect(field).toHaveAccessibleDescription(TAGS_COPY.errors.tooLong));
    await waitFor(() => expect(field).toHaveFocus());
  });
});
