import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Circle } from "lucide-react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { navItems, type ModuleManifest, type NavShortcutKey } from "@/lib/modules";
import {
  QuickCaptureContext,
  type CaptureProvider,
  type CaptureSheetProps,
} from "@/lib/quick-capture";
import { AppNav } from "@/modules/core/components/app-nav";
import { BottomNav } from "@/modules/core/components/bottom-nav";
import { Sidebar } from "@/modules/core/components/sidebar";
import { SIDEBAR_COOKIE } from "@/modules/core/nav-preferences";

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
      shortcut: i < 8 ? ((i + 1) as NavShortcutKey) : undefined,
      ...extra[i],
    })),
  );
}

let desktop = true;
beforeEach(() => {
  push.mockReset();
  pathname = "/";
  desktop = true;
  window.history.replaceState(null, "", "/design");
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
    expect(links[1]).toHaveTextContent("2");

    const footer = screen.getByRole("navigation", { name: "Secundaria" });
    expect(within(footer).getByRole("link", { name: "Módulo 3" })).toHaveAttribute("href", "/m2");
  });

  test("with shortcuts off there are no key hints anywhere", () => {
    const { container } = render(
      <Sidebar
        items={items(2)}
        pathname="/"
        collapsed={false}
        onToggle={() => {}}
        shortcuts={false}
      />,
    );
    expect(container.querySelector("[aria-keyshortcuts]")).toBeNull();
    expect(container.querySelector("kbd")).toBeNull();
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

  test("tapping the unavailable capture key shows the explanation for a moment", () => {
    vi.useFakeTimers();
    try {
      render(<Sidebar items={items(1)} pathname="/" collapsed={false} onToggle={() => {}} />);
      const capture = screen.getByRole("button", { name: "Capturar" });
      const anchor = capture.parentElement!;
      expect(anchor).not.toHaveClass("is-open");
      fireEvent.click(capture);
      expect(anchor).toHaveClass("is-open");
      act(() => vi.advanceTimersByTime(2000));
      expect(anchor).not.toHaveClass("is-open");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("BottomNav", () => {
  test("up to 4 items as links around the capture key; the current one has a dot cue", () => {
    render(<BottomNav items={items(4)} pathname="/m2" />);
    const nav = screen.getByRole("navigation", { name: "Principal" });
    const links = within(nav).getAllByRole("link");
    expect(links).toHaveLength(4);
    expect(links[2]).toHaveAttribute("aria-current", "page");
    expect(links[2]).toHaveAccessibleName("Módulo 3");
    expect(within(nav).queryByRole("button", { name: /Más/ })).not.toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: "Capturar" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  test("with more than 4 items the rest go in the Más sheet", async () => {
    render(<BottomNav items={items(6)} pathname="/m4" />);
    const nav = screen.getByRole("navigation", { name: "Principal" });
    expect(within(nav).getAllByRole("link")).toHaveLength(3);

    // The current page is one of the hidden ones: said in the name, not with aria-current.
    const more = within(nav).getByRole("button", { name: "Más (actual: Módulo 5)" });
    expect(more).not.toHaveAttribute("aria-current");
    expect(more).toHaveAttribute("data-active");
    await userEvent.click(more);

    const sheet = await screen.findByRole("dialog", { name: "Más" });
    const sections = within(sheet).getByRole("navigation", { name: "Más secciones" });
    const hidden = within(sections).getAllByRole("link");
    expect(hidden.map((link) => link.textContent)).toEqual(["Módulo 4", "Módulo 5", "Módulo 6"]);
    expect(within(sheet).getByRole("link", { name: "Módulo 5" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(more).toHaveFocus();
  });

  test("Más has its plain name when the current page is visible", () => {
    render(<BottomNav items={items(6)} pathname="/m0" />);
    const more = screen.getByRole("button", { name: "Más" });
    expect(more).not.toHaveAttribute("data-active");
  });
});

describe("AppNav", () => {
  function renderNav(props: Partial<Parameters<typeof AppNav>[0]> = {}) {
    return render(<AppNav initialCollapsed={false} shortcutsEnabled {...props} />);
  }
  const sidebarOf = (container: HTMLElement) => container.querySelector(".bo-sidebar")!;

  test("renders the registry: Hoy is the current page on /", () => {
    renderNav();
    for (const nav of screen.getAllByRole("navigation", { name: "Principal" })) {
      expect(within(nav).getByRole("link", { name: "Hoy" })).toHaveAttribute(
        "aria-current",
        "page",
      );
    }
  });

  test("starts collapsed from the cookie value; [ toggles and remembers it", () => {
    const { container } = renderNav({ initialCollapsed: true });
    expect(sidebarOf(container)).toHaveClass("is-collapsed");
    // Mounting doesn't write the cookie: only a real toggle does.
    expect(document.cookie).not.toContain(SIDEBAR_COOKIE);

    fireEvent.keyDown(document.body, { key: "[" });
    expect(sidebarOf(container)).not.toHaveClass("is-collapsed");
    expect(document.cookie).toContain(`${SIDEBAR_COOKIE}=expanded`);

    fireEvent.keyDown(document.body, { key: "[" });
    expect(sidebarOf(container)).toHaveClass("is-collapsed");
    expect(document.cookie).toContain(`${SIDEBAR_COOKIE}=collapsed`);
  });

  test("below 1024 px no shortcut acts (the sidebar showing them is hidden)", () => {
    desktop = false;
    const { container } = renderNav();
    expect(fireEvent.keyDown(document.body, { key: "[" })).toBe(true);
    expect(fireEvent.keyDown(document.body, { key: "1" })).toBe(true);
    expect(sidebarOf(container)).not.toHaveClass("is-collapsed");
    expect(push).not.toHaveBeenCalled();
  });

  test("number keys go to the module with that number; unbound ones do nothing", () => {
    renderNav();
    // fireEvent returns false when the handler called preventDefault().
    expect(fireEvent.keyDown(document.body, { key: "1" })).toBe(false);
    expect(push).toHaveBeenCalledWith("/");
    push.mockReset();
    expect(fireEvent.keyDown(document.body, { key: "2" })).toBe(false);
    expect(push).toHaveBeenCalledWith("/projects");
    push.mockReset();
    expect(fireEvent.keyDown(document.body, { key: "3" })).toBe(false);
    expect(push).toHaveBeenCalledWith("/tasks");
    push.mockReset();
    expect(fireEvent.keyDown(document.body, { key: "4" })).toBe(false);
    expect(push).toHaveBeenCalledWith("/habits");
    push.mockReset();
    // SPEC-finance: Finanzas is 5.
    expect(fireEvent.keyDown(document.body, { key: "5" })).toBe(false);
    expect(push).toHaveBeenCalledWith("/finance");
    push.mockReset();
    expect(fireEvent.keyDown(document.body, { key: "6" })).toBe(true);
    expect(push).not.toHaveBeenCalled();
    expect(fireEvent.keyDown(document.body, { key: "7" })).toBe(false);
    expect(push).toHaveBeenCalledWith("/areas");
  });

  test("the number of the current page doesn't navigate again", () => {
    window.history.replaceState(null, "", "/");
    renderNav();
    fireEvent.keyDown(document.body, { key: "1" });
    expect(push).not.toHaveBeenCalled();
  });

  test("shortcuts are ignored while typing in an input", () => {
    const { container } = render(
      <>
        <AppNav initialCollapsed={false} shortcutsEnabled />
        <input aria-label="Texto" />
      </>,
    );
    const input = screen.getByRole("textbox", { name: "Texto" });
    act(() => input.focus());
    expect(fireEvent.keyDown(input, { key: "1" })).toBe(true);
    expect(fireEvent.keyDown(input, { key: "[" })).toBe(true);
    expect(push).not.toHaveBeenCalled();
    expect(sidebarOf(container)).not.toHaveClass("is-collapsed");
  });

  test("with shortcuts off: no listener and no hints", () => {
    const { container } = renderNav({ shortcutsEnabled: false });
    expect(fireEvent.keyDown(document.body, { key: "[" })).toBe(true);
    expect(fireEvent.keyDown(document.body, { key: "1" })).toBe(true);
    expect(sidebarOf(container)).not.toHaveClass("is-collapsed");
    expect(push).not.toHaveBeenCalled();
    expect(container.querySelector("[aria-keyshortcuts]")).toBeNull();
    expect(document.documentElement).not.toHaveAttribute("data-nav-shortcuts");
  });
});

describe("AppNav quick capture (extension point)", () => {
  const opened = vi.fn();
  const preload = vi.fn();
  /** A stand-in for the provider's sheet: a dialog that says whether it is open. */
  function FakeSheet({ open, onOpenChange, returnFocusRef }: CaptureSheetProps) {
    opened(open, returnFocusRef.current);
    return open ? (
      <div role="dialog" aria-label="Captura de prueba">
        <button type="button" onClick={() => onOpenChange(false)}>
          Cerrar captura
        </button>
      </div>
    ) : null;
  }
  const provider: CaptureProvider = { id: "fake", label: "Prueba", Sheet: FakeSheet, preload };

  beforeEach(() => {
    opened.mockReset();
    preload.mockReset();
  });

  function renderNav(props: Partial<Parameters<typeof AppNav>[0]> = {}, withProvider = true) {
    const nav = <AppNav initialCollapsed={false} shortcutsEnabled {...props} />;
    return render(
      withProvider ? <QuickCaptureContext value={[provider]}>{nav}</QuickCaptureContext> : nav,
    );
  }

  test("with a provider both capture keys are available, open a dialog and preload it", () => {
    renderNav();
    const keys = screen.getAllByRole("button", { name: "Capturar" });
    expect(keys).toHaveLength(2);
    for (const key of keys) {
      expect(key).not.toHaveAttribute("aria-disabled");
      expect(key).toHaveAttribute("aria-haspopup", "dialog");
      expect(key).not.toHaveAccessibleDescription("Próximamente");
    }
    // Nothing is mounted until the first opening.
    expect(opened).not.toHaveBeenCalled();
    fireEvent.pointerEnter(keys[1]);
    expect(preload).toHaveBeenCalled();

    fireEvent.click(keys[1]);
    expect(screen.getByRole("dialog", { name: "Captura de prueba" })).toBeInTheDocument();
    // Focus returns to the key that was pressed.
    expect(opened).toHaveBeenLastCalledWith(true, keys[1]);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar captura" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("the sidebar shows the C hint and C opens capture from 1024 px", () => {
    const { container } = renderNav();
    const sidebarKey = container.querySelector(".bo-sidebar [data-capture-key]")!;
    expect(sidebarKey).toHaveAttribute("aria-keyshortcuts", "C");
    expect(fireEvent.keyDown(document.body, { key: "c" })).toBe(false);
    expect(screen.getByRole("dialog", { name: "Captura de prueba" })).toBeInTheDocument();
  });

  test("Caps Lock C opens it too; Shift, ⌘ or Ctrl + C don't", () => {
    renderNav();
    expect(fireEvent.keyDown(document.body, { key: "C", shiftKey: true })).toBe(true);
    expect(fireEvent.keyDown(document.body, { key: "c", metaKey: true })).toBe(true);
    expect(fireEvent.keyDown(document.body, { key: "c", ctrlKey: true })).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fireEvent.keyDown(document.body, { key: "C" })).toBe(false);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  test("C does nothing below 1024 px or while typing", () => {
    desktop = false;
    const { unmount } = renderNav();
    expect(fireEvent.keyDown(document.body, { key: "c" })).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
    unmount();

    desktop = true;
    render(
      <QuickCaptureContext value={[provider]}>
        <AppNav initialCollapsed={false} shortcutsEnabled />
        <input aria-label="Texto" />
      </QuickCaptureContext>,
    );
    const input = screen.getByRole("textbox", { name: "Texto" });
    act(() => input.focus());
    expect(fireEvent.keyDown(input, { key: "c" })).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
    // Positive control: the same key outside the field opens it.
    expect(fireEvent.keyDown(document.body, { key: "c" })).toBe(false);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  test("with shortcuts off, C does nothing and no key shows it; the keys still open it", () => {
    const { container } = renderNav({ shortcutsEnabled: false });
    expect(fireEvent.keyDown(document.body, { key: "c" })).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(container.querySelector("[aria-keyshortcuts]")).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Capturar" })[0]);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  test("without a provider the keys say Próximamente and C does nothing", () => {
    renderNav({}, false);
    for (const key of screen.getAllByRole("button", { name: "Capturar" })) {
      expect(key).toHaveAttribute("aria-disabled", "true");
      expect(key).toHaveAccessibleDescription("Próximamente");
    }
    expect(fireEvent.keyDown(document.body, { key: "c" })).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("AppNav quick capture with several providers (Tarea · Gasto, SPEC-finance)", () => {
  /** A provider whose sheet is a dialog named after it, with the shell's switch first. */
  function provider(id: string, label: string, preload = vi.fn()): CaptureProvider {
    function Sheet({ open, onOpenChange, switcher }: CaptureSheetProps) {
      return open ? (
        <div role="dialog" aria-label={`Hoja ${label}`}>
          {switcher}
          <button type="button" onClick={() => onOpenChange(false)}>
            Cerrar {label}
          </button>
        </div>
      ) : null;
    }
    return { id, label, Sheet, preload };
  }

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  function renderWith(providers: CaptureProvider[]) {
    return render(
      <QuickCaptureContext value={providers}>
        <AppNav initialCollapsed={false} shortcutsEnabled />
      </QuickCaptureContext>,
    );
  }

  const openCapture = () => fireEvent.click(screen.getAllByRole("button", { name: "Capturar" })[0]);

  test("the first provider opens by default with a switch; another one swaps the sheet and is remembered", () => {
    renderWith([provider("tasks", "Tarea"), provider("finance", "Gasto")]);
    openCapture();
    const choice = within(screen.getByRole("dialog", { name: "Hoja Tarea" })).getByRole(
      "radiogroup",
      { name: "Qué capturar" },
    );
    expect(within(choice).getByRole("radio", { name: "Tarea" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    fireEvent.click(within(choice).getByRole("radio", { name: "Gasto" }));
    expect(screen.queryByRole("dialog", { name: "Hoja Tarea" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Hoja Gasto" })).toBeInTheDocument();
    expect(localStorage.getItem("bo_capture_kind")).toBe("finance");

    // Closed and opened again: the remembered one.
    fireEvent.click(screen.getByRole("button", { name: "Cerrar Gasto" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    openCapture();
    expect(screen.getByRole("dialog", { name: "Hoja Gasto" })).toBeInTheDocument();
  });

  test("an opening reads the device's choice; an unknown one falls back to the first", () => {
    localStorage.setItem("bo_capture_kind", "finance");
    const { unmount } = renderWith([provider("tasks", "Tarea"), provider("finance", "Gasto")]);
    openCapture();
    expect(screen.getByRole("dialog", { name: "Hoja Gasto" })).toBeInTheDocument();
    unmount();

    localStorage.setItem("bo_capture_kind", "gone");
    renderWith([provider("tasks", "Tarea"), provider("finance", "Gasto")]);
    openCapture();
    expect(screen.getByRole("dialog", { name: "Hoja Tarea" })).toBeInTheDocument();
  });

  test("without storage (private mode) it opens the first and still switches", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    renderWith([provider("tasks", "Tarea"), provider("finance", "Gasto")]);
    openCapture();
    expect(screen.getByRole("dialog", { name: "Hoja Tarea" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Gasto" }));
    expect(screen.getByRole("dialog", { name: "Hoja Gasto" })).toBeInTheDocument();
  });

  test("one provider: no switch; with two, pointing at the key preloads both", () => {
    const tasksPreload = vi.fn();
    const financePreload = vi.fn();
    const { unmount } = renderWith([provider("tasks", "Tarea", tasksPreload)]);
    openCapture();
    expect(screen.queryByRole("radiogroup", { name: "Qué capturar" })).toBeNull();
    unmount();

    renderWith([
      provider("tasks", "Tarea", tasksPreload),
      provider("finance", "Gasto", financePreload),
    ]);
    fireEvent.pointerEnter(screen.getAllByRole("button", { name: "Capturar" })[1]);
    expect(tasksPreload).toHaveBeenCalled();
    expect(financePreload).toHaveBeenCalled();
  });
});
