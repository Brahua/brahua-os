// C6 on the areas screen: reorder (buttons), archive, unarchive, optimistic UI and undo.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AreasManager } from "@/app/(app)/areas/_components/areas-manager";
import type { ActionResult } from "@/lib/action-result";
import { archiveLifeArea, reorderLifeAreas, unarchiveLifeArea } from "@/modules/core/actions";
import { LIFE_AREA_ERRORS, type LifeAreaSummary } from "@/modules/core/life-area-input";

vi.mock("@/modules/core/actions", () => ({
  createLifeArea: vi.fn(),
  updateLifeArea: vi.fn(),
  reorderLifeAreas: vi.fn(),
  archiveLifeArea: vi.fn(),
  unarchiveLifeArea: vi.fn(),
}));

function area(id: string, name: string, sortOrder: number): LifeAreaSummary {
  return { id, slug: id, name, color: "home", icon: "house", sortOrder };
}

const HOME = area("a1", "Hogar", 0);
const HEALTH = area("a2", "Salud", 1);
const WORK = area("a3", "Trabajo", 2);
const TRAVEL = area("a4", "Viajes", 3);
const AREAS = [HOME, HEALTH, WORK];

/** A promise the test resolves when it wants: the change stays pending until then. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/**
 * A server call that stays pending until the test ends. React entangles pending async
 * transitions (even across tests), so every one must settle or later rollbacks never show.
 */
const held: (() => void)[] = [];
function hanging<T>(): Promise<ActionResult<T>> {
  const call = deferred<ActionResult<T>>();
  held.push(() => call.resolve({ ok: true, data: undefined as T }));
  return call.promise;
}

afterEach(async () => {
  await act(async () => {
    for (const release of held.splice(0)) release();
  });
});

beforeEach(() => {
  window.matchMedia = vi.fn((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  vi.mocked(reorderLifeAreas).mockReset();
  vi.mocked(archiveLifeArea).mockReset();
  vi.mocked(unarchiveLifeArea).mockReset();
});

const list = () => screen.getByRole("list", { name: "Tus áreas" });
const rowNames = () =>
  within(list())
    .getAllByRole("button", { name: /^Editar / })
    .map((row) => row.getAttribute("aria-label")!.replace("Editar ", ""));
const notices = () => screen.getByRole("status", { name: "Avisos" });

describe("row controls", () => {
  test("each row has a drag handle and Subir/Bajar, disabled at the ends but focusable", () => {
    render(<AreasManager areas={AREAS} archived={[]} />);

    const handle = screen.getByRole("button", { name: "Mover Hogar" });
    expect(handle).toHaveAttribute("aria-roledescription", "elemento ordenable");
    expect(handle).toHaveAccessibleDescription(/pulsa Espacio o Enter, muévela con las flechas/);

    expect(screen.getByRole("button", { name: "Subir Hogar" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("button", { name: "Bajar Hogar" })).not.toHaveAttribute(
      "aria-disabled",
    );
    expect(screen.getByRole("button", { name: "Bajar Trabajo" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  test("a disabled Subir does nothing", async () => {
    const user = userEvent.setup();
    render(<AreasManager areas={AREAS} archived={[]} />);
    await user.click(screen.getByRole("button", { name: "Subir Hogar" }));
    expect(reorderLifeAreas).not.toHaveBeenCalled();
    expect(rowNames()).toEqual(["Hogar", "Salud", "Trabajo"]);
  });
});

describe("reorder with the buttons", () => {
  test("the row moves at once, keeps focus, saves the whole order and offers Deshacer", async () => {
    const user = userEvent.setup();
    vi.mocked(reorderLifeAreas).mockImplementation(hanging);
    render(<AreasManager areas={AREAS} archived={[]} />);

    await user.click(screen.getByRole("button", { name: "Bajar Hogar" }));

    expect(rowNames()).toEqual(["Salud", "Hogar", "Trabajo"]);
    expect(screen.getByRole("button", { name: "Bajar Hogar" })).toHaveFocus();
    expect(reorderLifeAreas).toHaveBeenCalledWith({ ids: ["a2", "a1", "a3"] });
    expect(notices()).toHaveTextContent("«Hogar» pasó al lugar 2 de 3.");
    expect(within(notices()).getByRole("button", { name: "Deshacer" })).toHaveAttribute(
      "aria-keyshortcuts",
      "Meta+Z Control+Z",
    );
    // Focus never jumps to the notice.
    expect(notices()).not.toContainElement(document.activeElement as HTMLElement);
  });

  test("moves in a row share one notice; Deshacer restores the order before the first", async () => {
    const user = userEvent.setup();
    vi.mocked(reorderLifeAreas).mockImplementation(hanging);
    render(<AreasManager areas={AREAS} archived={[]} />);

    await user.click(screen.getByRole("button", { name: "Bajar Hogar" }));
    await user.click(screen.getByRole("button", { name: "Bajar Hogar" }));
    expect(rowNames()).toEqual(["Salud", "Trabajo", "Hogar"]);
    expect(notices()).toHaveTextContent("«Hogar» pasó al lugar 3 de 3.");
    expect(within(notices()).getAllByRole("button")).toHaveLength(1);

    await user.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    expect(reorderLifeAreas).toHaveBeenLastCalledWith({ ids: ["a1", "a2", "a3"] });
    expect(rowNames()).toEqual(["Hogar", "Salud", "Trabajo"]);
  });

  test("after a successful undo, a notice says so", async () => {
    const user = userEvent.setup();
    vi.mocked(reorderLifeAreas).mockResolvedValue({ ok: true, data: AREAS });
    render(<AreasManager areas={AREAS} archived={[]} />);
    await user.click(screen.getByRole("button", { name: "Bajar Salud" }));
    await user.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    await waitFor(() => expect(notices()).toHaveTextContent("Volvió el orden anterior."));
    expect(within(notices()).queryByRole("button")).not.toBeInTheDocument();
  });

  test("when the server refuses, the list goes back and the notice explains why", async () => {
    const user = userEvent.setup();
    const pending = deferred<ActionResult<LifeAreaSummary[]>>();
    vi.mocked(reorderLifeAreas).mockReturnValue(pending.promise);
    render(<AreasManager areas={AREAS} archived={[]} />);
    await user.click(screen.getByRole("button", { name: "Subir Trabajo" }));
    expect(rowNames()).toEqual(["Hogar", "Trabajo", "Salud"]);

    await act(async () => pending.resolve({ ok: false, error: LIFE_AREA_ERRORS.staleOrder }));

    await waitFor(() => expect(rowNames()).toEqual(["Hogar", "Salud", "Trabajo"]));
    expect(notices()).toHaveTextContent(LIFE_AREA_ERRORS.staleOrder);
    expect(within(notices()).queryByRole("button", { name: "Deshacer" })).not.toBeInTheDocument();
  });

  test("a network failure rolls back with a generic message", async () => {
    const user = userEvent.setup();
    vi.mocked(reorderLifeAreas).mockRejectedValue(new Error("offline"));
    render(<AreasManager areas={AREAS} archived={[]} />);
    await user.click(screen.getByRole("button", { name: "Bajar Hogar" }));
    await waitFor(() => expect(notices()).toHaveTextContent(/Revisa tu conexión/));
    await waitFor(() => expect(rowNames()).toEqual(["Hogar", "Salud", "Trabajo"]));
  });

  test("⌘Z / Ctrl+Z runs the Deshacer of the notice on screen", async () => {
    const user = userEvent.setup();
    vi.mocked(reorderLifeAreas).mockImplementation(hanging);
    render(<AreasManager areas={AREAS} archived={[]} />);
    await user.click(screen.getByRole("button", { name: "Bajar Hogar" }));
    await user.keyboard("{Control>}z{/Control}");
    expect(reorderLifeAreas).toHaveBeenLastCalledWith({ ids: ["a1", "a2", "a3"] });
    expect(rowNames()).toEqual(["Hogar", "Salud", "Trabajo"]);
  });
});

describe("archive from the edit sheet", () => {
  test("the row leaves at once, focus goes to its neighbour, then Deshacer puts it back", async () => {
    const user = userEvent.setup();
    vi.mocked(archiveLifeArea).mockImplementation(hanging);
    vi.mocked(unarchiveLifeArea).mockImplementation(hanging);
    render(<AreasManager areas={AREAS} archived={[]} />);

    await user.click(screen.getByRole("button", { name: "Editar Salud" }));
    const dialog = await screen.findByRole("dialog");
    const archive = within(dialog).getByRole("button", { name: "Archivar área" });
    expect(archive).toHaveAccessibleDescription(/Deja de ofrecerse para elementos nuevos/);
    await user.click(archive);

    expect(archiveLifeArea).toHaveBeenCalledWith({ id: "a2" });
    expect(rowNames()).toEqual(["Hogar", "Trabajo"]);
    expect(screen.getByText("2 áreas")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Editar Trabajo" })).toHaveFocus();
    // The notice comes once the sheet is gone (before, the page is hidden from screen readers).
    await waitFor(() => expect(notices()).toHaveTextContent("«Salud» se archivó."));
    // Shown in the archived section right away.
    expect(screen.getByRole("button", { name: /Archivadas/ })).toHaveTextContent("1");

    await user.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    expect(unarchiveLifeArea).toHaveBeenCalledWith({ id: "a2", position: "original" });
    expect(rowNames()).toEqual(["Hogar", "Salud", "Trabajo"]);
    expect(screen.queryByRole("button", { name: /Archivadas/ })).not.toBeInTheDocument();
  });

  test("if archiving fails, the row comes back and no Deshacer is offered", async () => {
    const user = userEvent.setup();
    vi.mocked(archiveLifeArea).mockResolvedValue({ ok: false, error: LIFE_AREA_ERRORS.id });
    render(<AreasManager areas={AREAS} archived={[]} />);
    await user.click(screen.getByRole("button", { name: "Editar Hogar" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Archivar área" }),
    );
    await waitFor(() => expect(notices()).toHaveTextContent(LIFE_AREA_ERRORS.id));
    await waitFor(() => expect(rowNames()).toEqual(["Hogar", "Salud", "Trabajo"]));
    expect(within(notices()).queryByRole("button", { name: "Deshacer" })).not.toBeInTheDocument();
  });

  test("creating has no archive button", async () => {
    const user = userEvent.setup();
    render(<AreasManager areas={AREAS} archived={[]} />);
    await user.click(screen.getByRole("button", { name: "Nueva área" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("button", { name: "Archivar área" })).not.toBeInTheDocument();
  });
});

describe("archived areas", () => {
  test("folded section with a count; nothing to edit, only Desarchivar", async () => {
    const user = userEvent.setup();
    render(<AreasManager areas={AREAS} archived={[TRAVEL]} />);

    const toggle = screen.getByRole("button", { name: /Archivadas/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent("1");
    expect(screen.getByRole("heading", { level: 2, name: /Archivadas/ })).toContainElement(toggle);
    expect(screen.queryByRole("list", { name: "Áreas archivadas" })).not.toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const archivedList = screen.getByRole("list", { name: "Áreas archivadas" });
    expect(within(archivedList).getByText("Viajes")).toBeInTheDocument();
    expect(
      within(archivedList)
        .getAllByRole("button")
        .map((b) => b.ariaLabel),
    ).toEqual(["Desarchivar Viajes"]);
  });

  test("Desarchivar sends it to the end of the list, focuses it, and can be undone", async () => {
    const user = userEvent.setup();
    vi.mocked(unarchiveLifeArea).mockImplementation(hanging);
    vi.mocked(archiveLifeArea).mockImplementation(hanging);
    render(<AreasManager areas={AREAS} archived={[TRAVEL]} />);
    await user.click(screen.getByRole("button", { name: /Archivadas/ }));

    await user.click(screen.getByRole("button", { name: "Desarchivar Viajes" }));

    expect(unarchiveLifeArea).toHaveBeenCalledWith({ id: "a4" });
    expect(rowNames()).toEqual(["Hogar", "Salud", "Trabajo", "Viajes"]);
    expect(screen.queryByRole("button", { name: /Archivadas/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Editar Viajes" })).toHaveFocus();
    expect(notices()).toHaveTextContent("«Viajes» volvió al final de tus áreas.");

    await user.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    expect(archiveLifeArea).toHaveBeenCalledWith({ id: "a4" });
    expect(rowNames()).toEqual(["Hogar", "Salud", "Trabajo"]);
  });

  test("with more archived areas, focus moves to the next one", async () => {
    const user = userEvent.setup();
    vi.mocked(unarchiveLifeArea).mockImplementation(hanging);
    const other = area("a5", "Música", 4);
    render(<AreasManager areas={AREAS} archived={[TRAVEL, other]} />);
    await user.click(screen.getByRole("button", { name: /Archivadas/ }));
    await user.click(screen.getByRole("button", { name: "Desarchivar Viajes" }));
    expect(screen.getByRole("button", { name: "Desarchivar Música" })).toHaveFocus();
  });
});

describe("notice queue", () => {
  test("one notice at a time: the next waits until the first is dismissed with Esc", async () => {
    const user = userEvent.setup();
    vi.mocked(reorderLifeAreas).mockImplementation(hanging);
    vi.mocked(unarchiveLifeArea).mockImplementation(hanging);
    render(<AreasManager areas={AREAS} archived={[TRAVEL]} />);

    await user.click(screen.getByRole("button", { name: "Bajar Hogar" }));
    await user.click(screen.getByRole("button", { name: /Archivadas/ }));
    await user.click(screen.getByRole("button", { name: "Desarchivar Viajes" }));
    expect(notices()).toHaveTextContent("«Hogar» pasó al lugar 2 de 3.");
    expect(notices()).not.toHaveTextContent("Viajes");

    // Into the notice from the restored row (where Desarchivar left focus), then Esc.
    const before = screen.getByRole("button", { name: "Editar Viajes" });
    expect(before).toHaveFocus();
    await user.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    expect(reorderLifeAreas).toHaveBeenLastCalledWith({ ids: ["a1", "a2", "a3", "a4"] });
    // Deshacer took the first notice away; the waiting one shows now.
    expect(notices()).toHaveTextContent("«Viajes» volvió al final de tus áreas.");
    within(notices()).getByRole("button", { name: "Deshacer" }).focus();
    await user.keyboard("{Escape}");
    expect(notices()).not.toHaveTextContent("Viajes");
    expect(before).toHaveFocus();
  });
});
