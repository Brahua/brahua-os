// N3 of `notes`: the renderer's task item controls (src/lib/markdown: `taskItems`). The renderer
// numbers task items exactly as `parseTaskItems` (the server's side) does, hands the controls the
// index and the text, draws a task link item with its state (and none when the task is gone or
// unknown), and changes nothing without `taskItems` (projects' and tasks' notes).
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { Markdown, type MarkdownTaskItems } from "@/lib/markdown/markdown";
import { parseTaskItems } from "@/lib/markdown/task-items";

const TASK = "0d6f3a8e-1c2b-4d5e-8f90-123456789abc";
const GONE = "11111111-2222-4333-8444-555555555555";

const RENDERERS: MarkdownTaskItems = {
  open: ({ index, text }) => <button type="button" data-open={index}>{`convertir ${text}`}</button>,
  linked: ({ id, name, done }) => (
    <span data-linked={id} data-done={String(done)}>
      {`casilla ${name}`}
    </span>
  ),
};

const opens = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>("[data-open]")].map((element) => [
    Number(element.dataset.open),
    element.textContent,
  ]);

describe("task item controls", () => {
  test("each item that can become a task gets its index and text, the same as the server's", () => {
    const docs = [
      "- [ ] Uno\n- [x] Dos\n  - [ ] Tres\n\n```\n- [ ] código\n```\n\n> - [ ] Cuatro",
      `Texto\n\n1. [ ] Uno [[project:${TASK}|con enlace]]\n2. [ ] Dos\nsigue\n3. [ ] Tres`,
      "- [ ] A\r\n- [ ] B\r\n\r\n* [X] C\r\n* [ ] D",
    ];
    for (const doc of docs) {
      const { container, unmount } = render(<Markdown taskItems={RENDERERS}>{doc}</Markdown>);
      const expected = parseTaskItems(doc)
        .filter((item) => item.text !== null)
        .map((item) => [item.index, `convertir ${item.text}`]);
      expect(opens(container), doc).toEqual(expected);
      unmount();
    }
    // A spot check of the first one.
    const { container } = render(<Markdown taskItems={RENDERERS}>{docs[0]}</Markdown>);
    expect(opens(container)).toEqual([
      [0, "convertir Uno"],
      [2, "convertir Tres"],
      [3, "convertir Cuatro"],
    ]);
  });

  test("a task link item: its current name and state; gone: struck, no control; unknown: done null", () => {
    const body = [
      `- [[task:${TASK}|Nombre guardado]]`,
      `- [[task:${GONE}|Borrada]]`,
      `- Ver [[task:${TASK}|en medio]]`,
    ].join("\n");
    const { container, unmount } = render(
      <Markdown
        taskItems={RENDERERS}
        unknownNoteLinks="deleted"
        noteLinks={{
          [`task:${TASK}`]: {
            name: "Pagar la luz",
            href: `/tasks/${TASK}`,
            deleted: false,
            done: true,
          },
          [`task:${GONE}`]: { name: "Borrada", href: `/tasks/${GONE}`, deleted: true, done: false },
        }}
      >
        {body}
      </Markdown>,
    );
    const linked = container.querySelectorAll<HTMLElement>("[data-linked]");
    // Only the item that starts with the link (not the one with a link in the middle).
    expect(linked).toHaveLength(1);
    expect(linked[0].dataset.done).toBe("true");
    expect(linked[0]).toHaveTextContent("casilla Pagar la luz");
    // The link itself still opens the task (both items link to it).
    for (const link of screen.getAllByRole("link", { name: "Pagar la luz" })) {
      expect(link).toHaveAttribute("href", `/tasks/${TASK}`);
    }
    const gone = container.querySelector(`li[data-md-task="${GONE}"]`);
    expect(gone).toHaveClass("bo-md-task-linked", "is-gone");
    expect(gone).toHaveTextContent("Borrada (ya no existe)");
    expect(gone?.querySelector("[data-linked]")).toBeNull();
    unmount();

    // The editor's text: a link nobody resolved yet is drawn with its saved name, state unknown.
    render(<Markdown taskItems={RENDERERS}>{`- [[task:${TASK}|Nombre guardado]]`}</Markdown>);
    const unknown = document.querySelector<HTMLElement>("[data-linked]");
    expect(unknown?.dataset.done).toBe("null");
    expect(unknown).toHaveTextContent("casilla Nombre guardado");
  });

  test("without `taskItems` nothing changes: no marks, no controls", () => {
    const body = `- [ ] Uno\n- [[task:${TASK}|Dos]]`;
    const { container } = render(<Markdown>{body}</Markdown>);
    expect(
      container.querySelector("[data-md-item], [data-md-task], .bo-md-task-linked"),
    ).toBeNull();
    expect(container.querySelector("[data-open], [data-linked]")).toBeNull();
    // The read-only box of a task item is still there.
    expect(container.querySelector(".bo-md-check")).not.toBeNull();
  });

  test("the marks can't be written in a note: raw HTML never becomes an item", () => {
    const body = '<ul><li data-md-item="0">forjado</li></ul>\n\n- [ ] Real';
    const { container } = render(<Markdown taskItems={RENDERERS}>{body}</Markdown>);
    expect(opens(container)).toEqual([[0, "convertir Real"]]);
    // The rendered list items carry no mark attribute at all.
    expect(container.querySelector("[data-md-item]")).toBeNull();
  });
});
