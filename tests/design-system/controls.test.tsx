import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, test, vi } from "vitest";
import {
  Key,
  ListRow,
  SegmentedControl,
  Sheet,
  Switch,
  TextArea,
  TextField,
} from "@/design-system";

describe("Switch", () => {
  test("is a labeled switch that toggles", async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Switch label="Recordatorio de revisión" onCheckedChange={onCheckedChange} />);
    const sw = screen.getByRole("switch", { name: "Recordatorio de revisión" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    await user.click(sw);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
});

describe("SegmentedControl", () => {
  function Tabs() {
    const [value, setValue] = useState<"active" | "paused" | "ideas">("active");
    return (
      <SegmentedControl
        label="Estado del proyecto"
        value={value}
        onValueChange={setValue}
        options={[
          { value: "active", label: "Activos", count: 3 },
          { value: "paused", label: "Pausados", count: 2 },
          { value: "ideas", label: "Ideas", count: 4 },
        ]}
      />
    );
  }

  test("exposes tabs with the selected one in the tab order", () => {
    render(<Tabs />);
    expect(screen.getByRole("tablist", { name: "Estado del proyecto" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Activos/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Activos/ })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: /Pausados/ })).toHaveAttribute("tabindex", "-1");
  });

  test("arrow keys, Home and End move the selection and focus", async () => {
    const user = userEvent.setup();
    render(<Tabs />);
    await user.click(screen.getByRole("tab", { name: /Activos/ }));

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: /Pausados/ })).toHaveFocus();
    expect(screen.getByRole("tab", { name: /Pausados/ })).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: /Ideas/ })).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: /Activos/ })).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{Home}{ArrowLeft}");
    expect(screen.getByRole("tab", { name: /Ideas/ })).toHaveAttribute("aria-selected", "true");
  });

  test("radio mode uses radiogroup semantics", () => {
    render(
      <SegmentedControl
        mode="radio"
        label="Tema"
        value="dark"
        options={[
          { value: "dark", label: "Oscuro" },
          { value: "light", label: "Claro" },
        ]}
      />,
    );
    expect(screen.getByRole("radio", { name: "Oscuro" })).toHaveAttribute("aria-checked", "true");
  });
});

describe("TextField", () => {
  test("links label and help text", () => {
    render(<TextField label="Tarea" help="Se guarda en Hoy" />);
    const input = screen.getByLabelText("Tarea");
    expect(input).toHaveAccessibleDescription("Se guarda en Hoy");
    expect(input).toHaveAttribute("aria-invalid", "false");
  });

  test("announces errors without red: orange border class + message", () => {
    const { container } = render(<TextField label="Monto" error="Ingresa un número" />);
    const input = screen.getByLabelText("Monto");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Ingresa un número");
    expect(container.querySelector(".bo-field")).toHaveClass("is-error");
  });

  test("TextArea is a labeled multi-line field", () => {
    render(<TextArea label="Nota" />);
    expect(screen.getByLabelText("Nota").tagName).toBe("TEXTAREA");
  });
});

describe("Sheet", () => {
  function Capture() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Key onClick={() => setOpen(true)}>Capturar</Key>
        <Sheet open={open} onOpenChange={setOpen} title="Captura rápida">
          <TextField label="Tarea" />
        </Sheet>
      </>
    );
  }

  test("opens as a titled dialog, closes with Esc and returns focus", async () => {
    const user = userEvent.setup();
    render(<Capture />);
    const trigger = screen.getByRole("button", { name: "Capturar" });

    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "Captura rápida" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    // Radix restores focus asynchronously after unmounting the focus scope.
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  test("closes with its close button", async () => {
    const user = userEvent.setup();
    render(<Capture />);
    await user.click(screen.getByRole("button", { name: "Capturar" }));
    await user.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("ListRow", () => {
  test("is a link with href", () => {
    render(<ListRow href="/finance" title="Finanzas" subtitle="S/ 2,340 de S/ 3,000" />);
    expect(screen.getByRole("link", { name: /Finanzas/ })).toHaveAttribute("href", "/finance");
  });

  test("is a button with onClick", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<ListRow title="Metas" onClick={onClick} compact />);
    const row = screen.getByRole("button", { name: /Metas/ });
    expect(row).toHaveClass("bo-row--compact");
    await user.click(row);
    expect(onClick).toHaveBeenCalledOnce();
  });

  test("is a static row otherwise", () => {
    render(<ListRow title="Notas" />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Notas").closest(".bo-row")).not.toBeNull();
  });
});
