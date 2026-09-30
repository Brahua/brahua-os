import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Plus, Search } from "lucide-react";
import { useState } from "react";
import { describe, expect, test, vi } from "vitest";
import { Icon, IconKey, Kbd, Key, Tooltip } from "@/design-system";

describe("Key", () => {
  test("is a button with the design-system classes", () => {
    render(<Key>Guardar</Key>);
    const key = screen.getByRole("button", { name: "Guardar" });
    expect(key).toHaveAttribute("type", "button");
    expect(key).toHaveClass("bo-key");
    expect(key).not.toHaveAttribute("aria-pressed");
  });

  test("maps variant, size and block to modifier classes", () => {
    render(
      <Key variant="signal" size="lg" block>
        Capturar
      </Key>,
    );
    expect(screen.getByRole("button", { name: "Capturar" })).toHaveClass(
      "bo-key",
      "bo-key--signal",
      "bo-key--lg",
      "bo-key--block",
    );
  });

  test("toggle mode reports and flips aria-pressed", async () => {
    const user = userEvent.setup();
    function Toggle() {
      const [on, setOn] = useState(false);
      return (
        <Key toggle pressed={on} onPressedChange={setOn}>
          Meditación
        </Key>
      );
    }
    render(<Toggle />);
    const key = screen.getByRole("button", { name: "Meditación" });

    expect(key).toHaveAttribute("aria-pressed", "false");
    await user.click(key);
    expect(key).toHaveAttribute("aria-pressed", "true");
    // Focus stays on the key, so the keyboard keeps toggling it.
    await user.keyboard(" ");
    expect(key).toHaveAttribute("aria-pressed", "false");
    await user.keyboard("{Enter}");
    expect(key).toHaveAttribute("aria-pressed", "true");
  });

  test("still calls onClick in toggle mode", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Key toggle onClick={onClick}>
        Ejercicio
      </Key>,
    );
    await user.click(screen.getByRole("button", { name: "Ejercicio" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  test("renders an icon and a shortcut that stay out of the accessible name", () => {
    render(
      <Key icon={Plus} shortcut="C" variant="signal">
        Capturar
      </Key>,
    );
    const key = screen.getByRole("button", { name: "Capturar" });
    expect(key.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(key.querySelector("kbd")).toHaveClass("bo-kbd--on-signal");
  });

  test("does not fire when disabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Key disabled onClick={onClick}>
        Guardar
      </Key>,
    );
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  test("renders its child with key classes when asChild is set", () => {
    render(
      <Key asChild variant="ghost">
        <a href="/today">Ir a Hoy</a>
      </Key>,
    );
    expect(screen.getByRole("link", { name: "Ir a Hoy" })).toHaveClass("bo-key", "bo-key--ghost");
  });
});

describe("IconKey", () => {
  test("uses its label as the accessible name, without a duplicate tooltip announcement", () => {
    render(<IconKey icon={Search} label="Buscar" shortcut={["⌘", "K"]} />);
    const key = screen.getByRole("button", { name: "Buscar" });
    expect(key).toHaveClass("bo-key", "bo-key--icon");
    expect(key).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  test("supports toggle mode", async () => {
    const user = userEvent.setup();
    const onPressedChange = vi.fn();
    render(<IconKey icon={Search} label="Filtrar" toggle onPressedChange={onPressedChange} />);
    await user.click(screen.getByRole("button", { name: "Filtrar" }));
    expect(onPressedChange).toHaveBeenCalledWith(true);
  });
});

describe("Kbd", () => {
  test("renders one key or a group of keys", () => {
    const { container, rerender } = render(<Kbd keys="C" />);
    expect(container.querySelectorAll("kbd.bo-kbd")).toHaveLength(1);

    rerender(<Kbd keys={["⌘", "K"]} />);
    expect(container.querySelector(".bo-kbd-group")).not.toBeNull();
    expect(container.querySelectorAll("kbd.bo-kbd")).toHaveLength(2);
  });
});

describe("Tooltip", () => {
  test("describes its trigger", () => {
    render(
      <Tooltip label="Contraer barra" shortcut="[">
        <button type="button">Barra</button>
      </Tooltip>,
    );
    const tooltip = screen.getByRole("tooltip");
    expect(screen.getByRole("button", { name: "Barra" })).toHaveAttribute(
      "aria-describedby",
      tooltip.id,
    );
    expect(tooltip).toHaveTextContent("Contraer barra");
  });
});

describe("Icon", () => {
  test("is decorative by default, with the design-system stroke and size class", () => {
    const { container } = render(<Icon icon={Plus} size="xl" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("stroke-width", "1.75");
    expect(svg).toHaveClass("bo-icon", "bo-icon--xl");
  });

  test("gets an accessible name when labeled", () => {
    render(<Icon icon={Plus} label="Agregar" />);
    expect(screen.getByRole("img", { name: "Agregar" })).toBeInTheDocument();
  });
});
