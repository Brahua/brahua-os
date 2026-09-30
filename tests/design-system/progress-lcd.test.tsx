import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { DayCell, DotMatrix, Lcd, ProgressRing, SegmentBar, Toast } from "@/design-system";

describe("ProgressRing", () => {
  test("is a labeled progressbar, clamped to 0–100", () => {
    const { rerender } = render(<ProgressRing value={42.4} />);
    const ring = screen.getByRole("progressbar", { name: "Progreso del día" });
    expect(ring).toHaveAttribute("aria-valuenow", "42");
    expect(ring.style.getPropertyValue("--value")).toBe("42");

    rerender(<ProgressRing value={140} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });
});

describe("SegmentBar", () => {
  test("is a meter with one segment per unit", () => {
    const { container } = render(<SegmentBar total={6} filled={4} next />);
    const meter = screen.getByRole("meter", { name: "4 de 6" });
    expect(meter).toHaveAttribute("aria-valuemax", "6");
    expect(container.querySelectorAll(".bo-segbar__seg")).toHaveLength(6);
    expect(container.querySelectorAll(".bo-segbar__seg.is-filled")).toHaveLength(4);
    expect(container.querySelectorAll(".bo-segbar__seg")[4]).toHaveClass("is-next");
  });
});

describe("DotMatrix", () => {
  test("announces each day with its full name and progress", () => {
    render(
      <DotMatrix
        days={[
          { label: "L", name: "lunes 28", done: 9, complete: true },
          { label: "M", name: "martes 29", done: 3, state: "today" },
          { label: "X", name: "miércoles 30", state: "upcoming" },
        ]}
      />,
    );
    expect(screen.getByRole("list", { name: "Semana" })).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: "martes 29 (hoy): 3 de 9" })).toHaveClass(
      "is-today",
    );
    expect(screen.getByRole("listitem", { name: "miércoles 30: 0 de 9" })).toHaveClass(
      "is-upcoming",
    );
  });
});

describe("DayCell", () => {
  test("describes each state in words; rest is never an error", () => {
    render(
      <>
        <DayCell state="done" label="lunes" />
        <DayCell state="rest" label="martes" />
        <DayCell state="done" today label="miércoles" />
      </>,
    );
    expect(screen.getByRole("img", { name: "lunes: hecho" })).toHaveClass("is-done");
    expect(screen.getByRole("img", { name: "martes: descanso" })).toHaveClass("is-rest");
    expect(screen.getByRole("img", { name: "miércoles: hoy, hecho" })).toHaveClass("is-today");
  });
});

describe("Lcd", () => {
  test("strip is a polite status region with tag, text and meta", () => {
    render(
      <Lcd tag="Hoy" meta="3/9">
        Te faltan 6 para cerrar el día.
      </Lcd>,
    );
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("Hoy");
    expect(status).toHaveTextContent("3/9");
  });

  test("block panels are not live regions by default", () => {
    render(
      <Lcd block>
        <p>Semana 40</p>
      </Lcd>,
    );
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("Toast", () => {
  test("runs the undo action", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(<Toast title="Tarea guardada · hoy" text="Comprar cuerdas" onAction={onAction} />);
    await user.click(screen.getByRole("button", { name: "Deshacer" }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  test("hides the action when there is none", () => {
    render(<Toast title="Listo" text="Guardado" />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
