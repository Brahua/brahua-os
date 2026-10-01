import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { AreaFilter } from "@/app/(app)/projects/_components/area-filter";
import type { AreaFilterOption } from "@/modules/projects/project-list";

const HEALTH: AreaFilterOption = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "health",
  name: "Salud",
  color: "health",
  icon: "heart-pulse",
  archived: false,
};
const WORK: AreaFilterOption = {
  id: "22222222-2222-4222-8222-222222222222",
  slug: "work y más",
  name: "Trabajo",
  color: "work",
  icon: "briefcase",
  archived: true,
};
const OPTIONS = [HEALTH, WORK];

let desktop = false;
beforeEach(() => {
  desktop = false;
  window.matchMedia = vi.fn((query: string) => ({
    matches: desktop,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
});

// While the sheet is open the rest of the page is aria-hidden (modal), the trigger included.
const trigger = () => screen.getByRole("button", { name: /^Filtrar por área/, hidden: true });
const dialog = () => screen.getByRole("dialog", { name: "Filtrar por área" });
const option = (name: string | RegExp) => within(dialog()).getByRole("link", { name });

/** Renders the filter and opens its sheet; resolves once the (lazy) sheet is there. */
async function openFilter(selectedId: string | null = null) {
  const user = userEvent.setup();
  const view = render(<AreaFilter options={OPTIONS} selectedId={selectedId} />);
  await user.click(trigger());
  await screen.findByRole("dialog");
  return { user, ...view };
}

describe("AreaFilter", () => {
  test("one compact trigger that says what is on, closed at first", () => {
    render(<AreaFilter options={OPTIONS} selectedId={HEALTH.id} />);
    expect(trigger()).toHaveAccessibleName("Filtrar por área: Salud");
    expect(trigger()).toHaveTextContent("Área:Salud");
    expect(trigger()).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    // The options are not on the page until it opens.
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  test("without a filter it reads Todas", () => {
    render(<AreaFilter options={OPTIONS} selectedId={null} />);
    expect(trigger()).toHaveAccessibleName("Filtrar por área: Todas");
  });

  test("opens a bottom sheet on the phone with every option as a link", async () => {
    await openFilter();
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(dialog()).toHaveClass("bo-sheet--bottom");
    const links = within(dialog()).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/projects",
      "/projects?area=health",
      "/projects?area=work%20y%20m%C3%A1s",
    ]);
    // Archived areas say so (jsdom has no CSS, so it may join the visually hidden ", " tight).
    expect(option(/^Trabajo,\s?Archivada$/)).toBeInTheDocument();
  });

  test("a side panel on desktop", async () => {
    desktop = true;
    await openFilter();
    expect(dialog()).toHaveClass("bo-sheet--side");
  });

  test("the current option has aria-current, a check and the focus", async () => {
    await openFilter(HEALTH.id);
    const current = option("Salud");
    expect(current).toHaveAttribute("aria-current", "page");
    expect(current.querySelector(".lucide-check")).not.toBeNull();
    await waitFor(() => expect(current).toHaveFocus());
    const all = option("Todas las áreas");
    expect(all).not.toHaveAttribute("aria-current");
    expect(all.querySelector(".lucide-check")).toBeNull();
  });

  test("with no filter, focus starts on “Todas las áreas”", async () => {
    await openFilter(null);
    expect(option("Todas las áreas")).toHaveAttribute("aria-current", "page");
    await waitFor(() => expect(option("Todas las áreas")).toHaveFocus());
  });

  test("Esc closes it and focus goes back to the trigger", async () => {
    const { user } = await openFilter(HEALTH.id);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(trigger()).toHaveFocus();
    // Nothing picked, nothing announced.
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  test("picking an option closes the sheet and announces it once the page shows it", async () => {
    const { user, rerender } = await openFilter(null);
    // jsdom doesn't navigate; the page re-rendering with the new area stands in for it.
    option("Salud").addEventListener("click", (event) => event.preventDefault());
    await user.click(option("Salud"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger()).toHaveFocus();
    // Not yet: the page still shows every area.
    expect(screen.getByRole("status")).toBeEmptyDOMElement();

    await act(async () => rerender(<AreaFilter options={OPTIONS} selectedId={HEALTH.id} />));
    expect(screen.getByRole("status")).toHaveTextContent("Mostrando los proyectos de «Salud».");
    expect(trigger()).toHaveAccessibleName("Filtrar por área: Salud");
  });
});
