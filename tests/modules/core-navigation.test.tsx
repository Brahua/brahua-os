import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Circle } from "lucide-react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { navItems, type ModuleManifest } from "@/lib/modules";
import { AppNav } from "@/modules/core/components/app-nav";
import { BottomNav } from "@/modules/core/components/bottom-nav";
import { Sidebar } from "@/modules/core/components/sidebar";
import { SIDEBAR_COOKIE } from "@/modules/core/sidebar-state";

const push = vi.fn();
let pathname = "/";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push }),
}));

function items(n: number, extra: Partial<ModuleManifest>[] = []) {
  return navItems(
    Array.from({ length: n }, (_, i) => ({
      id: `m${i}`,
      label: `Módulo ${i + 1}`,
      icon: Circle,
      href: `/m${i}`,
      navOrder: i,
      ...extra[i],
    })),
  );
}

let desktop = true;
beforeEach(() => {
  push.mockReset();
  pathname = "/";
  desktop = true;
  window.matchMedia = vi.fn((query: string) => ({
    matches: desktop,
    media: query,
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  document.cookie = `${SIDEBAR_COOKIE}=; Max-Age=0; Path=/`;
});

describe("Sidebar", () => {
  test("renders the items as links with their shortcut; the current one has aria-current", () => {
    render(
      <Sidebar
        items={items(3, [{}, {}, { navGroup: "footer" }])}
        pathname="/m1/detail"
        collapsed={false}
        onToggle={() => {}}
      />,
    );

    const main = screen.getByRole("navigation", { name: "Principal" });
    const links = within(main).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/m0", "/m1"]);
    expect(links[1]).toHaveAttribute("aria-current", "page");
    expect(links[0]).not.toHaveAttribute("aria-current");
    expect(links[1]).toHaveAttribute("aria-keyshortcuts", "2");

    const footer = screen.getByRole("navigation", { name: "Secundaria" });
    expect(within(footer).getByRole("link", { name: "Módulo 3" })).toHaveAttribute("href", "/m2");
  });

  test("without footer modules there is no second nav", () => {
    render(<Sidebar items={items(1)} pathname="/" collapsed={false} onToggle={() => {}} />);
    expect(screen.getAllByRole("navigation")).toHaveLength(1);
  });

  test("collapsed: links keep their names and the toggle says what it does", async () => {
    const onToggle = vi.fn();
    const { container } = render(
      <Sidebar items={items(2)} pathname="/" collapsed onToggle={onToggle} />,
    );

    expect(container.firstChild).toHaveClass("bo-sidebar", "is-collapsed");
    expect(screen.getByRole("link", { name: "Módulo 1" })).toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "Expandir barra lateral" });
    expect(toggle).toHaveAttribute("aria-keyshortcuts", "[");
    await userEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  test("capture is not available yet: aria-disabled, focusable and explained", () => {
    render(<Sidebar items={items(1)} pathname="/" collapsed={false} onToggle={() => {}} />);
    const capture = screen.getByRole("button", { name: "Capturar" });
    expect(capture).toHaveAttribute("aria-disabled", "true");
    expect(capture).not.toBeDisabled();
    expect(capture).toHaveAccessibleDescription("Próximamente");
  });
});

describe("BottomNav", () => {
  test("up to 4 items as links around the capture key", () => {
    render(<BottomNav items={items(4)} pathname="/m2" />);
    const nav = screen.getByRole("navigation", { name: "Principal" });
    const links = within(nav).getAllByRole("link");
    expect(links).toHaveLength(4);
    expect(links[2]).toHaveAttribute("aria-current", "page");
    expect(within(nav).queryByRole("button", { name: "Más" })).not.toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: "Capturar" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  test("with more than 4 items the rest go in the Más sheet", async () => {
    render(<BottomNav items={items(6)} pathname="/m4" />);
    const nav = screen.getByRole("navigation", { name: "Principal" });
    expect(within(nav).getAllByRole("link")).toHaveLength(3);

    const more = within(nav).getByRole("button", { name: "Más" });
    // The current page is one of the hidden ones.
    expect(more).toHaveAttribute("aria-current", "page");
    await userEvent.click(more);

    const sheet = screen.getByRole("dialog", { name: "Más" });
    const hidden = within(sheet).getAllByRole("link");
    expect(hidden.map((link) => link.textContent)).toEqual(["Módulo 4", "Módulo 5", "Módulo 6"]);
    expect(within(sheet).getByRole("link", { name: "Módulo 5" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});

describe("AppNav", () => {
  test("renders the registry: Hoy is the current page on /", () => {
    render(<AppNav initialCollapsed={false} />);
    for (const nav of screen.getAllByRole("navigation", { name: "Principal" })) {
      expect(within(nav).getByRole("link", { name: "Hoy" })).toHaveAttribute(
        "aria-current",
        "page",
      );
    }
  });

  test("starts collapsed from the cookie value and [ toggles and remembers it", () => {
    const { container } = render(<AppNav initialCollapsed />);
    const sidebar = container.querySelector(".bo-sidebar")!;
    expect(sidebar).toHaveClass("is-collapsed");

    fireEvent.keyDown(document.body, { key: "[" });
    expect(sidebar).not.toHaveClass("is-collapsed");
    expect(document.cookie).toContain(`${SIDEBAR_COOKIE}=expanded`);

    fireEvent.keyDown(document.body, { key: "[" });
    expect(sidebar).toHaveClass("is-collapsed");
    expect(document.cookie).toContain(`${SIDEBAR_COOKIE}=collapsed`);
  });

  test("[ does nothing below 1024 px, where the sidebar is hidden", () => {
    desktop = false;
    const { container } = render(<AppNav initialCollapsed={false} />);
    fireEvent.keyDown(document.body, { key: "[" });
    expect(container.querySelector(".bo-sidebar")).not.toHaveClass("is-collapsed");
  });

  test("number keys go to the registry item; missing ones do nothing", () => {
    render(<AppNav initialCollapsed={false} />);
    fireEvent.keyDown(document.body, { key: "1" });
    expect(push).toHaveBeenCalledWith("/");
    push.mockReset();
    fireEvent.keyDown(document.body, { key: "2" });
    expect(push).not.toHaveBeenCalled();
  });

  test("shortcuts are ignored while typing in an input", () => {
    const { container } = render(
      <>
        <AppNav initialCollapsed={false} />
        <input aria-label="Texto" />
      </>,
    );
    const input = screen.getByRole("textbox", { name: "Texto" });
    act(() => input.focus());
    fireEvent.keyDown(input, { key: "1" });
    fireEvent.keyDown(input, { key: "[" });
    expect(push).not.toHaveBeenCalled();
    expect(container.querySelector(".bo-sidebar")).not.toHaveClass("is-collapsed");
  });
});
