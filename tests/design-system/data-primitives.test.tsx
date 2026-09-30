import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChevronRight } from "lucide-react";
import { describe, expect, test, vi } from "vitest";
import { formatStat, Icon, ListRow, SectionLabel } from "@/design-system";

// Intl may use narrow no-break spaces; normalize them so assertions stay readable.
const normalize = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");

describe("formatStat", () => {
  test("formats PEN with the S/ symbol", () => {
    expect(normalize(formatStat(2340, "currency", "PEN"))).toBe("S/ 2,340");
  });

  test("formats USD with its ISO code so it is never confused with soles", () => {
    expect(normalize(formatStat(12.5, "currency", "USD"))).toBe("USD 12.5");
  });

  test("formats percentages from fractions without decimals", () => {
    expect(formatStat(0.58, "percent")).toBe("58%");
  });

  test("formats plain numbers with at most one decimal", () => {
    expect(formatStat(42, "number")).toBe("42");
    expect(formatStat(3.14159, "number")).toBe("3.1");
  });
});

describe("SectionLabel", () => {
  test("renders a heading by default", () => {
    render(<SectionLabel>Hábitos</SectionLabel>);
    expect(screen.getByRole("heading", { level: 2, name: "Hábitos" })).toBeInTheDocument();
  });

  test("includes the counter in the accessible name", () => {
    render(<SectionLabel count="2/6">Hábitos</SectionLabel>);
    const heading = screen.getByRole("heading", { level: 2 });
    expect(normalize(heading.textContent ?? "")).toContain("2/6");
  });

  test("can render as a non-heading element", () => {
    render(<SectionLabel as="span">Prioridades</SectionLabel>);
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.getByText("Prioridades")).toBeInTheDocument();
  });
});

describe("ListRow", () => {
  test("is a button by default and fires on click", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <ListRow description="3 activas" onClick={onClick}>
        Metas
      </ListRow>,
    );
    const row = screen.getByRole("button", { name: /Metas/ });
    expect(row).toHaveAttribute("type", "button");
    await user.click(row);
    expect(onClick).toHaveBeenCalledOnce();
  });

  test("renders a link with the same layout when href is set", () => {
    render(
      <ListRow href="/finance" trailing={<Icon icon={ChevronRight} />} description="Septiembre">
        Finanzas
      </ListRow>,
    );
    const link = screen.getByRole("link", { name: /Finanzas/ });
    expect(link).toHaveAttribute("href", "/finance");
    expect(link).toHaveTextContent("Septiembre");
  });

  test("uses the dense layout on fine pointers when asked", () => {
    render(<ListRow density="fine">Notas</ListRow>);
    expect(screen.getByRole("button", { name: "Notas" })).toHaveClass("min-h-10");
  });
});
