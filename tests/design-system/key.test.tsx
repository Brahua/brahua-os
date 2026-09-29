import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Plus } from "lucide-react";
import { useState } from "react";
import { describe, expect, test, vi } from "vitest";
import { Icon, IconKey, Key } from "@/design-system";

describe("Key", () => {
  test("is a real button that defaults to type=button", () => {
    render(<Key>Guardar</Key>);
    const key = screen.getByRole("button", { name: "Guardar" });
    expect(key.tagName).toBe("BUTTON");
    expect(key).toHaveAttribute("type", "button");
  });

  test("activates with Enter and Space", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Key onClick={onClick}>Guardar</Key>);

    await user.tab();
    expect(screen.getByRole("button", { name: "Guardar" })).toHaveFocus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  test("works as a toggle through aria-pressed", async () => {
    const user = userEvent.setup();
    function Toggle() {
      const [on, setOn] = useState(false);
      return (
        <Key aria-pressed={on} onClick={() => setOn(!on)}>
          Meditación
        </Key>
      );
    }
    render(<Toggle />);
    const key = screen.getByRole("button", { name: "Meditación" });

    expect(key).toHaveAttribute("aria-pressed", "false");
    await user.click(key);
    expect(key).toHaveAttribute("aria-pressed", "true");
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

  test("applies the variant classes", () => {
    render(<Key variant="signal">Capturar</Key>);
    const key = screen.getByRole("button", { name: "Capturar" });
    expect(key).toHaveClass("bg-signal", "text-on-signal", "shadow-key-signal");
  });

  test("renders its child with key styles when asChild is set", () => {
    render(
      <Key asChild>
        <a href="/hoy">Ir a Hoy</a>
      </Key>,
    );
    const link = screen.getByRole("link", { name: "Ir a Hoy" });
    expect(link).toHaveClass("shadow-key");
    expect(link).not.toHaveAttribute("type");
  });
});

describe("IconKey", () => {
  test("exposes its aria-label as the accessible name", () => {
    render(
      <IconKey aria-label="Capturar" variant="signal">
        <Icon icon={Plus} />
      </IconKey>,
    );
    expect(screen.getByRole("button", { name: "Capturar" })).toHaveClass("size-12");
  });
});

describe("Icon", () => {
  test("is hidden from assistive tech when decorative", () => {
    const { container } = render(<Icon icon={Plus} />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("stroke-width", "1.75");
    expect(svg).toHaveAttribute("width", "18");
  });

  test("gets an accessible name when labeled", () => {
    render(<Icon icon={Plus} label="Agregar" size="xl" />);
    expect(screen.getByRole("img", { name: "Agregar" })).toHaveAttribute("width", "24");
  });
});
