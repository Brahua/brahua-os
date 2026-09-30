import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import {
  AREA_COLORS,
  AREA_ICON_NAMES,
  AREA_ICONS,
  AreaTag,
  DEFAULT_AREAS,
  formatStat,
  Led,
  SectionLabel,
  StatNumber,
} from "@/design-system";

// Intl may use narrow no-break spaces; normalize them so assertions stay readable.
const normalize = (s: string) => s.replace(/[  ]/g, " ");

describe("areas", () => {
  test("the 8 palettes match the design system's areas", () => {
    expect(AREA_COLORS).toEqual([
      "home",
      "health",
      "finance",
      "learning",
      "work",
      "relationships",
      "travel",
      "hobbies",
    ]);
  });

  test("every default area icon exists in the curated set", () => {
    for (const area of AREA_COLORS) {
      expect(AREA_ICON_NAMES).toContain(DEFAULT_AREAS[area].icon);
      expect(AREA_ICONS[DEFAULT_AREAS[area].icon]).toBeTruthy();
    }
  });
});

describe("Led", () => {
  test("is decorative and carries its area palette class", () => {
    const { container } = render(<Led area="learning" on />);
    const led = container.querySelector(".bo-led");
    expect(led).toHaveAttribute("aria-hidden", "true");
    expect(led).toHaveClass("bo-area--learning", "is-on");
  });

  test("can be the signal LED", () => {
    const { container } = render(<Led signal size="lg" />);
    expect(container.querySelector(".bo-led")).toHaveClass("bo-led--signal", "bo-led--lg");
  });
});

describe("AreaTag", () => {
  test("defaults to the palette's area name and icon", () => {
    const { container } = render(<AreaTag area="travel" />);
    expect(screen.getByText("Planes y Viajes")).toBeInTheDocument();
    expect(container.querySelector(".bo-area-tag")).toHaveClass("bo-area--travel");
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  test("user-created areas reuse a palette with their own name and icon", () => {
    render(<AreaTag area="hobbies" label="Música" icon="music" variant="chip" />);
    expect(screen.getByText("Música").closest(".bo-area-tag")).toHaveClass(
      "bo-area--hobbies",
      "bo-area-tag--chip",
    );
  });
});

describe("SectionLabel", () => {
  test("shows title and counter", () => {
    render(<SectionLabel title="Hábitos" count="2/6" as="h2" />);
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading).toHaveTextContent("Hábitos");
    expect(heading).toHaveTextContent("2/6");
  });
});

describe("StatNumber", () => {
  test("shows string values as is, with unit and label", () => {
    render(<StatNumber value="11" unit="días" label="Racha" />);
    expect(screen.getByText("11")).toBeInTheDocument();
    expect(screen.getByText("días")).toHaveClass("bo-stat__unit");
    expect(screen.getByText("Racha")).toHaveClass("bo-stat__label");
  });

  test("exposes numeric values to screen readers as one formatted string", () => {
    const { container } = render(<StatNumber value={2340} kind="currency" currency="PEN" />);
    const srText = container.querySelector(".bo-stat__value .sr-only");
    expect(normalize(srText?.textContent ?? "")).toBe("S/ 2,340");
    // The animated digits are hidden from assistive tech.
    expect(container.querySelector('.bo-stat__value [aria-hidden="true"]')).not.toBeNull();
  });
});

describe("formatStat", () => {
  test("follows es-PE conventions", () => {
    expect(normalize(formatStat(2340, "currency", "PEN"))).toBe("S/ 2,340");
    expect(normalize(formatStat(12.5, "currency", "USD"))).toBe("USD 12.5");
    expect(formatStat(0.58, "percent")).toBe("58%");
    expect(formatStat(3.14159, "number")).toBe("3.1");
  });
});
