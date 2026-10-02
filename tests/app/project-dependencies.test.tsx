// P4: "Bloqueado por" on a project's page (section, header line) and the list's badge.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLayoutEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ProjectBlockedBy } from "@/app/(app)/projects/[id]/_components/project-blocked-by";
import { ProjectDependenciesSection } from "@/app/(app)/projects/[id]/_components/project-dependencies-section";
import { ProjectDetailProvider } from "@/app/(app)/projects/[id]/_components/project-detail-context";
import { fail, INVALID_FIELDS_MESSAGE, ok, type ActionResult } from "@/lib/action-result";
import { addDependency, removeDependency } from "@/modules/projects/actions";
import { ProjectCard } from "@/modules/projects/components/project-card";
import {
  DEPENDENCY_ERRORS,
  isBlocking,
  type DependencyProject,
} from "@/modules/projects/dependency-input";
import type { ProjectAreaSummary, ProjectDetail } from "@/modules/projects/project-input";

vi.mock("@/modules/projects/actions", () => ({
  addDependency: vi.fn(),
  removeDependency: vi.fn(),
}));

const HOME: ProjectAreaSummary = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "home",
  name: "Hogar",
  color: "home",
  icon: "house",
};

const NOW = new Date("2026-10-01T15:00:00.000Z");

const PROJECT: ProjectDetail = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Mudanza",
  objective: null,
  status: "active",
  priority: "medium",
  startDate: null,
  dueDate: null,
  completedAt: null,
  area: HOME,
  notes: null,
};

const dep = (n: number, name: string, status: DependencyProject["status"] = "active") => ({
  id: `00000000-0000-4000-8000-00000000010${n}`,
  name,
  status,
  area: HOME,
});
const PERMISO = dep(1, "Permiso municipal");
const PINTURA = dep(2, "Pintura", "done");
const CAMION = dep(3, "Camión");
const COCINA = dep(4, "Cocína nueva", "idea");

/** The page's data as the server has it; each call re-renders like a revalidation. */
const server = {
  blockers: [] as DependencyProject[],
  candidates: [] as DependencyProject[],
  render: (() => {}) as (state: {
    blockers: DependencyProject[];
    candidates: DependencyProject[];
  }) => void,
};

function Page() {
  const [state, setState] = useState({ blockers: server.blockers, candidates: server.candidates });
  useLayoutEffect(() => {
    server.render = setState;
  }, []);
  return (
    <ProjectDetailProvider project={PROJECT} now={NOW}>
      <ProjectDependenciesSection blockers={state.blockers} candidates={state.candidates} />
    </ProjectDetailProvider>
  );
}

function renderPage(blockers: DependencyProject[], candidates: DependencyProject[]) {
  server.blockers = blockers;
  server.candidates = candidates;
  render(<Page />);
  return userEvent.setup();
}

const all = [PERMISO, PINTURA, CAMION, COCINA];
const byId = (id: unknown) => all.find((p) => p.id === id)!;

/** The sheet is a side panel with focus on the search on desktop; the phone focuses its title. */
let desktop = true;

/** A promise the test settles when it wants (a server that hasn't answered yet). */
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

beforeEach(() => {
  desktop = true;
  window.matchMedia = vi.fn((query: string) => ({
    matches: desktop,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  vi.mocked(addDependency)
    .mockReset()
    .mockImplementation(async (input) => {
      const { blockedById } = input as { blockedById: string };
      server.blockers = [...server.blockers, byId(blockedById)];
      server.candidates = server.candidates.filter((p) => p.id !== blockedById);
      server.render({ blockers: server.blockers, candidates: server.candidates });
      return ok({ id: PROJECT.id, blockedById });
    });
  vi.mocked(removeDependency)
    .mockReset()
    .mockImplementation(async (input) => {
      const { blockedById } = input as { blockedById: string };
      server.blockers = server.blockers.filter((p) => p.id !== blockedById);
      server.render({ blockers: server.blockers, candidates: server.candidates });
      return ok({ id: PROJECT.id, blockedById });
    });
});

afterEach(() => {
  vi.useRealTimers();
});

const section = () => screen.getByRole("region", { name: "Bloqueado por" });
const blockerList = () => screen.queryByRole("list", { name: "Proyectos que lo bloquean" });
const addKey = () => screen.getByRole("button", { name: "Agregar bloqueador" });
const notices = () => screen.getByRole("region", { name: "Avisos" });

test("isBlocking: only done and canceled stop blocking", () => {
  expect(["idea", "active", "paused", "maintenance"].every((s) => isBlocking(s as never))).toBe(
    true,
  );
  expect(isBlocking("done")).toBe(false);
  expect(isBlocking("canceled")).toBe(false);
});

describe("the section", () => {
  test("lists each blocker as a link with its state; a done one no longer blocks", () => {
    renderPage([PERMISO, PINTURA], []);
    expect(section()).toHaveAccessibleDescription(/Proyectos que deben terminar antes de este/);
    const rows = within(blockerList()!).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByRole("link", { name: "Permiso municipal" })).toHaveAttribute(
      "href",
      `/projects/${PERMISO.id}`,
    );
    expect(rows[0]).toHaveTextContent("Activo");
    expect(rows[0]).not.toHaveTextContent("Ya no bloquea");
    expect(rows[1]).toHaveTextContent(/Terminado.*Ya no bloquea/);
    expect(within(rows[1]).getByRole("button", { name: "Quitar «Pintura»" })).toBeInTheDocument();
  });

  test("without blockers it says so, and offers to add one", () => {
    renderPage([], [CAMION]);
    expect(blockerList()).toBeNull();
    expect(section()).toHaveTextContent("No espera a ningún otro proyecto.");
    expect(addKey()).toHaveAttribute("aria-haspopup", "dialog");
  });

  test("remove: gone at once, focus on the add key, and Deshacer brings it back", async () => {
    const user = renderPage([PERMISO, CAMION], []);
    await user.click(screen.getByRole("button", { name: "Quitar «Permiso municipal»" }));
    expect(removeDependency).toHaveBeenCalledWith({ id: PROJECT.id, blockedById: PERMISO.id });
    expect(addKey()).toHaveFocus();
    await waitFor(() =>
      expect(notices()).toHaveTextContent("«Permiso municipal» ya no bloquea este proyecto."),
    );
    expect(within(blockerList()!).queryByText("Permiso municipal")).toBeNull();

    await user.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    expect(addDependency).toHaveBeenCalledWith({ id: PROJECT.id, blockedById: PERMISO.id });
    await waitFor(() =>
      expect(notices()).toHaveTextContent("«Permiso municipal» vuelve a bloquear este proyecto."),
    );
    expect(within(blockerList()!).getByRole("link", { name: "Permiso municipal" })).toBeVisible();
  });

  test("the row is gone before the server answers", async () => {
    const call = deferred<ActionResult<never>>();
    vi.mocked(removeDependency).mockReturnValueOnce(call.promise);
    const user = renderPage([PERMISO, CAMION], []);
    await user.click(screen.getByRole("button", { name: "Quitar «Permiso municipal»" }));
    expect(within(blockerList()!).queryByText("Permiso municipal")).toBeNull();
    expect(within(blockerList()!).getByText("Camión")).toBeInTheDocument();
    await act(async () =>
      call.resolve(ok({ id: PROJECT.id, blockedById: PERMISO.id }) as ActionResult<never>),
    );
  });

  test("an undo that fails says so, and the row stays out", async () => {
    const user = renderPage([PERMISO], []);
    await user.click(screen.getByRole("button", { name: "Quitar «Permiso municipal»" }));
    const undo = await within(notices()).findByRole("button", { name: "Deshacer" });
    vi.mocked(addDependency).mockResolvedValueOnce(
      fail("Este proyecto ya no existe.") as ActionResult<never>,
    );
    await user.click(undo);
    await waitFor(() =>
      expect(notices()).toHaveTextContent(
        "No se pudo volver a agregar «Permiso municipal». Este proyecto ya no existe.",
      ),
    );
    // The notice comes with the result; the optimistic row leaves when the transition ends,
    // a moment later (asserting it at once was flaky under load).
    await waitFor(() => expect(blockerList()).toBeNull());
  });

  test("an undo superseded by a newer remove of the same blocker says nothing", async () => {
    const user = renderPage([PERMISO], []);
    await user.click(screen.getByRole("button", { name: "Quitar «Permiso municipal»" }));
    const undo = await within(notices()).findByRole("button", { name: "Deshacer" });
    const undoCall = deferred<ActionResult<never>>();
    vi.mocked(addDependency).mockReturnValueOnce(undoCall.promise);
    await user.click(undo);
    // Shown again at once (optimistic), so it can be removed again while the undo is in flight.
    const again = await screen.findByRole("button", { name: "Quitar «Permiso municipal»" });
    await user.click(again);
    await act(async () => undoCall.resolve(fail("Falló.") as ActionResult<never>));
    await waitFor(() => expect(removeDependency).toHaveBeenCalledTimes(2));
    expect(notices()).not.toHaveTextContent("No se pudo volver a agregar");
  });

  test("a remove the server refuses comes back, with the reason", async () => {
    vi.mocked(removeDependency).mockResolvedValue(fail("Este proyecto ya no existe."));
    const user = renderPage([PERMISO], []);
    await user.click(screen.getByRole("button", { name: "Quitar «Permiso municipal»" }));
    await waitFor(() =>
      expect(notices()).toHaveTextContent(
        "No se pudo quitar «Permiso municipal»; volvió a como estaba. Este proyecto ya no existe.",
      ),
    );
    // The notice can render before the optimistic value rolls back.
    await waitFor(() =>
      expect(within(blockerList()!).getByText("Permiso municipal")).toBeInTheDocument(),
    );
  });

  test("a network failure while removing says to check the connection", async () => {
    vi.mocked(removeDependency).mockRejectedValue(new Error("offline"));
    const user = renderPage([PERMISO], []);
    await user.click(screen.getByRole("button", { name: "Quitar «Permiso municipal»" }));
    await waitFor(() => expect(notices()).toHaveTextContent(/Revisa tu conexión/));
    // The notice can render before the optimistic removal rolls back.
    await waitFor(() =>
      expect(within(blockerList()!).getByText("Permiso municipal")).toBeInTheDocument(),
    );
  });
});

describe("adding from the sheet", () => {
  async function openSheet(user: ReturnType<typeof userEvent.setup>) {
    await user.click(addKey());
    const dialog = await screen.findByRole("dialog", { name: "Agregar bloqueador" });
    const search = within(dialog).getByRole("searchbox", { name: "Buscar proyecto" });
    await waitFor(() => expect(search).toHaveFocus());
    return { dialog, search };
  }

  test("on the phone the title has focus (the keyboard would cover the list)", async () => {
    desktop = false;
    const user = renderPage([], [CAMION]);
    await user.click(addKey());
    const dialog = await screen.findByRole("dialog", { name: "Agregar bloqueador" });
    await waitFor(() =>
      expect(within(dialog).getByRole("heading", { name: "Agregar bloqueador" })).toHaveFocus(),
    );
    expect(dialog).toHaveAccessibleDescription(/aunque la cadena pase por un proyecto eliminado/);
  });

  test("the search filters without accents or case and says how many are left", async () => {
    const user = renderPage([], [CAMION, COCINA]);
    const { dialog, search } = await openSheet(user);
    const options = () => within(dialog).queryAllByRole("button", { name: /Hogar/ });
    expect(options()).toHaveLength(2);
    expect(search).toHaveAccessibleDescription("2 proyectos");

    await user.type(search, "COCINA");
    expect(options().map((o) => o.textContent)).toEqual([expect.stringContaining("Cocína nueva")]);
    expect(within(dialog).getByRole("status")).toHaveTextContent("1 proyecto");

    await user.clear(search);
    await user.type(search, "zzz");
    expect(options()).toHaveLength(0);
    expect(dialog).toHaveTextContent("Ningún proyecto coincide con la búsqueda.");
  });

  test("picking one adds it, closes the sheet and announces it", async () => {
    const user = renderPage([], [CAMION, COCINA]);
    const { dialog } = await openSheet(user);
    await user.click(within(dialog).getByRole("button", { name: /Camión/ }));
    expect(addDependency).toHaveBeenCalledWith({ id: PROJECT.id, blockedById: CAMION.id });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(within(blockerList()!).getByRole("link", { name: "Camión" })).toBeInTheDocument();
    await waitFor(() => expect(addKey()).toHaveFocus());
    await waitFor(() =>
      expect(document.querySelector("[data-detail-announcer]")).toHaveTextContent(
        "«Camión» ahora bloquea este proyecto.",
      ),
    );
  });

  test("a cycle refused by the server shows on the search field, with focus there", async () => {
    vi.mocked(addDependency).mockResolvedValue({
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: { blockedById: [DEPENDENCY_ERRORS.cycle] },
    } as ActionResult<never>);
    const user = renderPage([], [CAMION]);
    const { dialog, search } = await openSheet(user);
    await user.click(within(dialog).getByRole("button", { name: /Camión/ }));
    await waitFor(() => expect(search).toHaveAttribute("aria-invalid", "true"));
    expect(search).toHaveAccessibleDescription(DEPENDENCY_ERRORS.cycle);
    expect(search).toHaveFocus();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(blockerList()).toBeNull();

    // Typing again clears it: it no longer describes what is shown.
    await user.type(search, "c");
    expect(search).not.toHaveAttribute("aria-invalid", "true");
    expect(search).not.toHaveAccessibleDescription(DEPENDENCY_ERRORS.cycle);
  });

  test("while adding, the rows wait and Esc doesn't close the sheet", async () => {
    let answer: (result: ActionResult<never>) => void = () => {};
    vi.mocked(addDependency).mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const user = renderPage([], [CAMION, COCINA]);
    const { dialog } = await openSheet(user);
    await user.click(within(dialog).getByRole("button", { name: /Camión/ }));
    expect(within(dialog).getByRole("button", { name: /Camión/ })).toHaveTextContent("Agregando…");
    expect(within(dialog).getByRole("button", { name: /Cocína/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await user.click(within(dialog).getByRole("button", { name: /Cocína/ }));
    expect(addDependency).toHaveBeenCalledTimes(1);
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await act(async () => answer(fail("No se pudo guardar.") as ActionResult<never>));
  });

  test("with no candidates there is no search: focus goes to why", async () => {
    const user = renderPage([PERMISO], []);
    await user.click(addKey());
    const dialog = await screen.findByRole("dialog", { name: "Agregar bloqueador" });
    const why = within(dialog).getByText("No hay otros proyectos que puedan bloquearlo.");
    await waitFor(() => expect(why).toHaveFocus());
    expect(within(dialog).queryByRole("searchbox")).toBeNull();
  });
});

describe("blocked state", () => {
  test("the header line names the blockers that still block, each a link", () => {
    render(
      <ProjectBlockedBy
        blockers={[
          { id: PERMISO.id, name: PERMISO.name },
          { id: CAMION.id, name: CAMION.name },
        ]}
      />,
    );
    const line = document.querySelector("[data-blocked-by]")!;
    expect(line).toHaveTextContent("Bloqueado por Permiso municipal, Camión");
    expect(within(line as HTMLElement).getByRole("link", { name: "Camión" })).toHaveAttribute(
      "href",
      `/projects/${CAMION.id}`,
    );
  });

  test("nothing in the header when no blocker blocks", () => {
    const { container } = render(<ProjectBlockedBy blockers={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  test("the card shows Bloqueado and its link is described by who blocks it", () => {
    render(
      <ProjectCard project={PROJECT} due={null} blockedBy={["Permiso municipal", "Camión"]} />,
    );
    expect(screen.getByText("Bloqueado")).toBeVisible();
    expect(screen.getByRole("link", { name: "Mudanza" })).toHaveAccessibleDescription(
      "Bloqueado por Permiso municipal, Camión",
    );
  });

  test("an unblocked card has no badge", () => {
    render(<ProjectCard project={PROJECT} due={null} blockedBy={[]} />);
    expect(screen.queryByText("Bloqueado")).toBeNull();
    expect(screen.getByRole("link", { name: "Mudanza" })).not.toHaveAttribute("aria-describedby");
  });
});
