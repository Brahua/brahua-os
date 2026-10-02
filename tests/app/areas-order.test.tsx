// C6 on the areas screen: reorder (buttons), archive, unarchive, optimistic UI and undo.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLayoutEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AreasManager } from "@/app/(app)/areas/_components/areas-manager";
import { fail, ok, type ActionResult } from "@/lib/action-result";
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

type View = { areas: LifeAreaSummary[]; archived: LifeAreaSummary[] };

/**
 * A fake server: each action call waits until the test answers it (in order), then applies the
 * change to its data and re-renders the page with it, like the action's revalidation does.
 * Every call must settle before the test ends: React entangles pending async transitions.
 */
const server = {
  data: { areas: [], archived: [] } as View,
  render: (() => {}) as (view: View) => void,
  pending: [] as { answer: (result?: ActionResult<unknown>) => void }[],
  /** Answers the oldest pending call (by default with success, applying it). */
  async answer(result?: ActionResult<unknown>) {
    const call = server.pending.shift();
    if (!call) throw new Error("No pending call");
    await act(async () => call.answer(result));
  },
  async answerAll() {
    while (server.pending.length > 0) await server.answer();
  },
};

function serverCall<T>(apply: (data: View) => View): Promise<ActionResult<T>> {
  return new Promise<ActionResult<T>>((resolve) => {
    server.pending.push({
      answer: (result) => {
        if (!result || result.ok) {
          server.data = apply(server.data);
          server.render(server.data);
        }
        // The screen ignores the data of a successful result.
        resolve((result ?? ok(null)) as ActionResult<T>);
      },
    });
  });
}

function find(id: string): LifeAreaSummary {
  return [...server.data.areas, ...server.data.archived].find((item) => item.id === id)!;
}

function Page({ initial }: { initial: View }) {
  const [view, setView] = useState(initial);
  useLayoutEffect(() => {
    server.render = setView;
  }, []);
  return <AreasManager areas={view.areas} archived={view.archived} />;
}

/** Renders the page and waits for the lazy dnd-kit layer to replace the plain list. */
async function renderAreas(areas: LifeAreaSummary[] = AREAS, archived: LifeAreaSummary[] = []) {
  server.data = { areas, archived };
  render(<Page initial={server.data} />);
  if (areas.length > 0) {
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /^Mover / })[0]).toHaveAttribute(
        "aria-roledescription",
      ),
    );
  }
}

beforeEach(() => {
  window.matchMedia = vi.fn((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  server.pending = [];
  vi.mocked(reorderLifeAreas)
    .mockReset()
    .mockImplementation((input) =>
      serverCall((data) => ({
        ...data,
        areas: (input as { ids: string[] }).ids.map(find),
      })),
    );
  vi.mocked(archiveLifeArea)
    .mockReset()
    .mockImplementation((input) =>
      serverCall((data) => {
        const target = find((input as { id: string }).id);
        return {
          areas: data.areas.filter((item) => item !== target),
          archived: [target, ...data.archived.filter((item) => item !== target)],
        };
      }),
    );
  vi.mocked(unarchiveLifeArea)
    .mockReset()
    .mockImplementation((input) =>
      serverCall((data) => {
        const { id, position } = input as { id: string; position?: string };
        const target = find(id);
        const areas = data.areas.filter((item) => item !== target);
        if (position === "original") {
          const index = areas.findIndex((item) => item.sortOrder > target.sortOrder);
          areas.splice(index === -1 ? areas.length : index, 0, target);
        } else areas.push(target);
        return { areas, archived: data.archived.filter((item) => item !== target) };
      }),
    );
});

afterEach(async () => {
  await server.answerAll();
});

const list = () => screen.getByRole("list", { name: "Tus áreas" });
const rowNames = () =>
  within(list())
    .getAllByRole("button", { name: /^Editar / })
    .map((row) => row.getAttribute("aria-label")!.replace("Editar ", ""));
const notices = () => screen.getByRole("region", { name: "Avisos" });
const undoButton = () => within(notices()).getByRole("button", { name: "Deshacer" });

describe("row controls", () => {
  test("before dnd-kit loads, the plain list already has the rows and working Subir/Bajar", () => {
    server.data = { areas: AREAS, archived: [] };
    render(<Page initial={server.data} />);
    expect(rowNames()).toEqual(["Hogar", "Salud", "Trabajo"]);
    expect(screen.getByRole("button", { name: "Mover Hogar" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("button", { name: "Bajar Hogar" })).toBeInTheDocument();
  });

  test("each row has a drag handle and Subir/Bajar, disabled at the ends but focusable", async () => {
    await renderAreas();

    const handle = screen.getByRole("button", { name: "Mover Hogar" });
    expect(handle).toHaveAttribute("aria-roledescription", "elemento ordenable");
    expect(handle).not.toHaveAttribute("aria-disabled");
    expect(handle).toHaveAccessibleDescription(/pulsa Espacio o Enter, muévela con las flechas/);
    expect(handle).toHaveAccessibleDescription(/También puedes usar los botones Subir y Bajar\./);

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

  test("with a single area, the handle is disabled too", async () => {
    await renderAreas([HOME]);
    expect(screen.getByRole("button", { name: "Mover Hogar" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  test("a disabled Subir does nothing", async () => {
    const user = userEvent.setup();
    await renderAreas();
    await user.click(screen.getByRole("button", { name: "Subir Hogar" }));
    expect(reorderLifeAreas).not.toHaveBeenCalled();
    expect(rowNames()).toEqual(["Hogar", "Salud", "Trabajo"]);
  });
});

describe("keyboard drag", () => {
  test("a drop in place moves nothing and never steals focus on a later re-render", async () => {
    const user = userEvent.setup();
    await renderAreas();
    // jsdom lays everything out at 0×0, so the first row is the only one it drops in place.
    const handle = screen.getByRole("button", { name: "Mover Hogar" });

    // Lift with Space, drop with Space without moving.
    handle.focus();
    await user.keyboard(" ");
    await waitFor(() => expect(handle).toHaveAttribute("aria-pressed", "true"));
    await user.keyboard(" ");
    await waitFor(() => expect(document.documentElement).not.toHaveAttribute("data-dragging"));
    expect(reorderLifeAreas).not.toHaveBeenCalled();

    // Elsewhere, then something unrelated re-renders the screen.
    const newArea = screen.getByRole("button", { name: "Nueva área" });
    newArea.focus();
    await act(async () => server.render({ ...server.data, areas: [...server.data.areas] }));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 150)));
    await act(async () => server.render({ ...server.data, areas: [...server.data.areas] }));
    expect(newArea).toHaveFocus();
  });
});

describe("reorder with the buttons", () => {
  test("the row moves at once, keeps focus, saves the whole order and offers Deshacer", async () => {
    const user = userEvent.setup();
    await renderAreas();

    await user.click(screen.getByRole("button", { name: "Bajar Hogar" }));

    expect(rowNames()).toEqual(["Salud", "Hogar", "Trabajo"]);
    expect(screen.getByRole("button", { name: "Bajar Hogar" })).toHaveFocus();
    expect(reorderLifeAreas).toHaveBeenCalledWith({ ids: ["a2", "a1", "a3"] });
    expect(notices()).toHaveTextContent("«Hogar» pasó al lugar 2 de 3.");
    expect(undoButton()).toHaveAttribute("aria-keyshortcuts", "Meta+Z Control+Z");
    // Focus never jumps to the notice.
    expect(notices()).not.toContainElement(document.activeElement as HTMLElement);

    await server.answer();
    expect(rowNames()).toEqual(["Salud", "Hogar", "Trabajo"]);
  });

  test("saves run one at a time, in order, even if the first answer is slow", async () => {
    const user = userEvent.setup();
    await renderAreas();

    await user.click(screen.getByRole("button", { name: "Bajar Hogar" }));
    await user.click(screen.getByRole("button", { name: "Bajar Hogar" }));
    expect(rowNames()).toEqual(["Salud", "Trabajo", "Hogar"]);
    // The second save waits for the first answer.
    expect(reorderLifeAreas).toHaveBeenCalledTimes(1);

    await server.answer();
    expect(reorderLifeAreas).toHaveBeenCalledTimes(2);
    expect(reorderLifeAreas).toHaveBeenLastCalledWith({ ids: ["a2", "a3", "a1"] });
    await server.answer();
    expect(server.data.areas.map((item) => item.id)).toEqual(["a2", "a3", "a1"]);
    expect(rowNames()).toEqual(["Salud", "Trabajo", "Hogar"]);
  });

  test("moves in a row share one notice; Deshacer restores the order before the first", async () => {
    const user = userEvent.setup();
    await renderAreas();

    await user.click(screen.getByRole("button", { name: "Bajar Hogar" }));
    await user.click(screen.getByRole("button", { name: "Bajar Hogar" }));
    expect(notices()).toHaveTextContent("«Hogar» pasó al lugar 3 de 3.");
    expect(within(notices()).getAllByRole("button")).toHaveLength(1);

    await user.click(undoButton());
    expect(rowNames()).toEqual(["Hogar", "Salud", "Trabajo"]);
    await server.answerAll();
    expect(reorderLifeAreas).toHaveBeenLastCalledWith({ ids: ["a1", "a2", "a3"] });
    expect(server.data.areas.map((item) => item.id)).toEqual(["a1", "a2", "a3"]);
    expect(notices()).toHaveTextContent("Volvió el orden anterior.");
    expect(within(notices()).queryByRole("button")).not.toBeInTheDocument();
  });

  test("when the server refuses, the list goes back and the notice explains why", async () => {
    const user = userEvent.setup();
    await renderAreas();
    await user.click(screen.getByRole("button", { name: "Subir Trabajo" }));
    expect(rowNames()).toEqual(["Hogar", "Trabajo", "Salud"]);

    await server.answer(fail(LIFE_AREA_ERRORS.staleOrder));

    await waitFor(() => expect(rowNames()).toEqual(["Hogar", "Salud", "Trabajo"]));
    expect(notices()).toHaveTextContent(LIFE_AREA_ERRORS.staleOrder);
    expect(within(notices()).queryByRole("button", { name: "Deshacer" })).not.toBeInTheDocument();
  });

  test("a failed move keeps the notice while a later move of the burst is on its way", async () => {
    const user = userEvent.setup();
    await renderAreas();
    await user.click(screen.getByRole("button", { name: "Bajar Hogar" }));
    await user.click(screen.getByRole("button", { name: "Bajar Hogar" }));

    await server.answer(fail("Primero falló."));
    // The error says why at once; the burst's notice (no time limit) waits behind it, not gone.
    expect(notices()).toHaveTextContent("Primero falló.");
    await user.keyboard("{Escape}");
    // The second move is still pending: its notice and Deshacer are back.
    expect(notices()).toHaveTextContent("«Hogar» pasó al lugar 3 de 3.");
    expect(undoButton()).toBeInTheDocument();
    await server.answer();
  });

  test("a network failure rolls back with a generic message", async () => {
    const user = userEvent.setup();
    vi.mocked(reorderLifeAreas).mockRejectedValue(new Error("offline"));
    await renderAreas();
    await user.click(screen.getByRole("button", { name: "Bajar Hogar" }));
    await waitFor(() => expect(notices()).toHaveTextContent(/Revisa tu conexión/));
    await waitFor(() => expect(rowNames()).toEqual(["Hogar", "Salud", "Trabajo"]));
  });

  test("⌘Z / Ctrl+Z runs the Deshacer of the notice on screen", async () => {
    const user = userEvent.setup();
    await renderAreas();
    await user.click(screen.getByRole("button", { name: "Bajar Hogar" }));
    await user.keyboard("{Control>}z{/Control}");
    expect(rowNames()).toEqual(["Hogar", "Salud", "Trabajo"]);
    await server.answerAll();
    expect(reorderLifeAreas).toHaveBeenLastCalledWith({ ids: ["a1", "a2", "a3"] });
  });
});

describe("archive from the edit sheet", () => {
  test("the row leaves at once, focus goes to its neighbour, then Deshacer puts it back", async () => {
    const user = userEvent.setup();
    await renderAreas();

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
    await server.answer();

    await user.click(undoButton());
    expect(unarchiveLifeArea).toHaveBeenCalledWith({ id: "a2", position: "original" });
    expect(rowNames()).toEqual(["Hogar", "Salud", "Trabajo"]);
    expect(screen.queryByRole("button", { name: /Archivadas/ })).not.toBeInTheDocument();
    await server.answer();
    expect(rowNames()).toEqual(["Hogar", "Salud", "Trabajo"]);
  });

  test("if archiving fails, the row comes back and no Deshacer is offered", async () => {
    const user = userEvent.setup();
    await renderAreas();
    await user.click(screen.getByRole("button", { name: "Editar Hogar" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Archivar área" }),
    );
    await server.answer(fail(LIFE_AREA_ERRORS.id));
    await waitFor(() => expect(notices()).toHaveTextContent(LIFE_AREA_ERRORS.id));
    await waitFor(() => expect(rowNames()).toEqual(["Hogar", "Salud", "Trabajo"]));
    expect(within(notices()).queryByRole("button", { name: "Deshacer" })).not.toBeInTheDocument();
  });

  test("creating has no archive button", async () => {
    const user = userEvent.setup();
    await renderAreas();
    await user.click(screen.getByRole("button", { name: "Nueva área" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("button", { name: "Archivar área" })).not.toBeInTheDocument();
  });
});

describe("archived areas", () => {
  test("folded section with a count; nothing to edit, only Desarchivar", async () => {
    const user = userEvent.setup();
    await renderAreas(AREAS, [TRAVEL]);

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
    await renderAreas(AREAS, [TRAVEL]);
    await user.click(screen.getByRole("button", { name: /Archivadas/ }));

    await user.click(screen.getByRole("button", { name: "Desarchivar Viajes" }));

    expect(unarchiveLifeArea).toHaveBeenCalledWith({ id: "a4" });
    expect(rowNames()).toEqual(["Hogar", "Salud", "Trabajo", "Viajes"]);
    expect(screen.queryByRole("button", { name: /Archivadas/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Editar Viajes" })).toHaveFocus();
    expect(notices()).toHaveTextContent("«Viajes» volvió al final de tus áreas.");
    await server.answer();

    await user.click(undoButton());
    expect(archiveLifeArea).toHaveBeenCalledWith({ id: "a4" });
    expect(rowNames()).toEqual(["Hogar", "Salud", "Trabajo"]);
  });

  test("with more archived areas, focus moves to the next one", async () => {
    const user = userEvent.setup();
    const other = area("a5", "Música", 4);
    await renderAreas(AREAS, [TRAVEL, other]);
    await user.click(screen.getByRole("button", { name: /Archivadas/ }));
    await user.click(screen.getByRole("button", { name: "Desarchivar Viajes" }));
    expect(screen.getByRole("button", { name: "Desarchivar Música" })).toHaveFocus();
  });
});

describe("notice queue", () => {
  test("one notice at a time: an undo notice (no time limit) gives way to the next action's", async () => {
    const user = userEvent.setup();
    await renderAreas(AREAS, [TRAVEL]);

    await user.click(screen.getByRole("button", { name: "Bajar Hogar" }));
    expect(notices()).toHaveTextContent("«Hogar» pasó al lugar 2 de 3.");
    await user.click(screen.getByRole("button", { name: /Archivadas/ }));
    await user.click(screen.getByRole("button", { name: "Desarchivar Viajes" }));
    // The next action's notice replaces it (an undo notice would otherwise hold the queue forever).
    expect(notices()).toHaveTextContent("«Viajes» volvió al final de tus áreas.");
    expect(notices()).not.toHaveTextContent("«Hogar» pasó");
    await server.answerAll();

    // Into the notice from the restored row (where Desarchivar left focus), then Esc.
    const before = screen.getByRole("button", { name: "Editar Viajes" });
    expect(before).toHaveFocus();
    undoButton().focus();
    await user.keyboard("{Escape}");
    expect(notices()).not.toHaveTextContent("Viajes");
    expect(before).toHaveFocus();
  });
});
