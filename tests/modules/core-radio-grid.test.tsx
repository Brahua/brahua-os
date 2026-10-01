import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { RadioGrid, type RadioGridOption } from "@/modules/core/components/radio-grid";

const OPTIONS: RadioGridOption<string>[] = Array.from({ length: 10 }, (_, i) => ({
  value: `o${i}`,
  label: `Opción ${i}`,
  children: i,
}));

function Grid({ initial = null }: { initial?: string | null }) {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <>
      <span id="label">Opciones</span>
      <RadioGrid options={OPTIONS} value={value} onValueChange={setValue} labelledBy="label" />
    </>
  );
}

/** Lays the options out in rows of `columns` (jsdom has no layout). */
function layOut(columns: number) {
  const spy = vi.spyOn(HTMLElement.prototype, "offsetTop", "get");
  spy.mockImplementation(function (this: HTMLElement) {
    const radios = screen.queryAllByRole("radio");
    return Math.floor(radios.indexOf(this) / columns) * 50;
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

const radio = (i: number) => screen.getByRole("radio", { name: `Opción ${i}` });

test("is a named radio group; with nothing checked the first option is the tab stop", () => {
  render(<Grid />);
  expect(screen.getByRole("radiogroup", { name: "Opciones" })).toBeInTheDocument();
  expect(radio(0)).toHaveAttribute("tabindex", "0");
  expect(screen.getAllByRole("radio").filter((r) => r.tabIndex === 0)).toHaveLength(1);
  expect(screen.queryAllByRole("radio", { checked: true })).toEqual([]);
});

test("the checked option is the tab stop and shows as an activated key", () => {
  render(<Grid initial="o3" />);
  expect(radio(3)).toBeChecked();
  expect(radio(3)).toHaveClass("bo-key", "is-on");
  expect(radio(3)).toHaveAttribute("tabindex", "0");
  expect(radio(0)).toHaveAttribute("tabindex", "-1");
});

test("↑/↓ move by rows in a grid and stop at the edges; ←/→ wrap", async () => {
  const user = userEvent.setup();
  render(<Grid initial="o1" />);
  layOut(4);
  radio(1).focus();

  await user.keyboard("{ArrowDown}");
  expect(radio(5)).toHaveFocus();
  expect(radio(5)).toBeChecked();
  await user.keyboard("{ArrowDown}");
  expect(radio(9)).toBeChecked();
  await user.keyboard("{ArrowDown}"); // no row below
  expect(radio(9)).toBeChecked();
  await user.keyboard("{ArrowUp}{ArrowUp}{ArrowUp}");
  expect(radio(1)).toBeChecked();
  await user.keyboard("{ArrowLeft}{ArrowLeft}");
  expect(radio(9)).toBeChecked();
  await user.keyboard("{ArrowRight}");
  expect(radio(0)).toBeChecked();
});

test("on a single row, ↑/↓ act like ←/→", async () => {
  const user = userEvent.setup();
  render(<Grid initial="o0" />);
  radio(0).focus();
  await user.keyboard("{ArrowDown}");
  expect(radio(1)).toBeChecked();
  await user.keyboard("{ArrowUp}{ArrowUp}");
  expect(radio(9)).toBeChecked();
});

test("Space picks the focused option when nothing is checked yet", async () => {
  const user = userEvent.setup();
  render(<Grid />);
  await user.tab();
  expect(radio(0)).toHaveFocus();
  await user.keyboard(" ");
  expect(radio(0)).toBeChecked();
});
