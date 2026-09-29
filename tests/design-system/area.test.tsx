import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { AREA_COLORS, AREA_ICON_NAMES, AREA_ICONS, AreaTag, Led } from "@/design-system";

const DEFAULT_AREA_ICONS = [
  "house",
  "heart-pulse",
  "wallet",
  "graduation-cap",
  "briefcase",
  "users",
  "plane",
  "audio-waveform",
] as const;

describe("area icons", () => {
  test("include the 8 default life-area icons", () => {
    for (const name of DEFAULT_AREA_ICONS) {
      expect(AREA_ICON_NAMES).toContain(name);
    }
  });

  test("offer a curated set of around 40+ icons, all real components", () => {
    expect(AREA_ICON_NAMES.length).toBeGreaterThanOrEqual(40);
    for (const name of AREA_ICON_NAMES) {
      expect(AREA_ICONS[name], name).toBeTruthy();
    }
  });
});

describe("Led", () => {
  test("is decorative and exposes its area tones as CSS variables", () => {
    const { container } = render(<Led color="blue" />);
    const led = container.querySelector("[data-led]") as HTMLElement;

    expect(led).toHaveAttribute("aria-hidden", "true");
    expect(led.style.getPropertyValue("--led")).toBe("var(--color-area-blue-led)");
    expect(led.style.getPropertyValue("--ink")).toBe("var(--color-area-blue-ink)");
  });

  test.each(AREA_COLORS)("renders the %s color", (color) => {
    const { container } = render(<Led color={color} />);
    expect(container.querySelector(`[data-led="${color}"]`)).not.toBeNull();
  });
});

describe("AreaTag", () => {
  test("shows the area name next to its icon", () => {
    render(<AreaTag name="Aprendizaje" color="blue" icon="graduation-cap" />);
    expect(screen.getByText("Aprendizaje")).toBeVisible();
    expect(screen.getByText("Aprendizaje")).not.toHaveClass("sr-only");
  });

  test("keeps the name for screen readers when it is visually hidden", () => {
    render(<AreaTag name="Salud y Bienestar" color="green" icon="heart-pulse" showName={false} />);
    expect(screen.getByText("Salud y Bienestar")).toHaveClass("sr-only");
  });

  test("marks icon and LED as decorative", () => {
    const { container } = render(<AreaTag name="Hogar" color="amber" icon="house" />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector("[data-led]")).toHaveAttribute("aria-hidden", "true");
  });
});
