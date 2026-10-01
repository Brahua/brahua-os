// P5: the notes and links sections of a project's page, with a fake server that answers at once
// and re-renders the page with what it saved (like the actions' revalidation).
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLayoutEffect, useState } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ProjectDetailProvider } from "@/app/(app)/projects/[id]/_components/project-detail-context";
import { ProjectLinksSection } from "@/app/(app)/projects/[id]/_components/project-links-section";
import { ProjectNotesSection } from "@/app/(app)/projects/[id]/_components/project-notes-section";
import { fail, ok } from "@/lib/action-result";
import { requestNavigation } from "@/lib/navigation-guard";
import {
  addProjectLink,
  removeProjectLink,
  reorderProjectLinks,
  updateProjectLink,
} from "@/modules/projects/link-actions";
import { updateProjectNotes } from "@/modules/projects/notes-actions";
import type { ProjectDetail } from "@/modules/projects/project-input";
import type { ProjectLinkSummary } from "@/modules/projects/project-link-input";

vi.mock("@/modules/projects/notes-actions", () => ({ updateProjectNotes: vi.fn() }));
vi.mock("@/modules/projects/link-actions", () => ({
  addProjectLink: vi.fn(),
  updateProjectLink: vi.fn(),
  removeProjectLink: vi.fn(),
  reorderProjectLinks: vi.fn(),
}));

const PROJECT: ProjectDetail = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Mudanza",
  objective: null,
  status: "active",
  priority: "medium",
  startDate: null,
  dueDate: null,
  completedAt: null,
  area: { id: "a", slug: "home", name: "Hogar", color: "home", icon: "house" },
  notes: null,
};

const A: ProjectLinkSummary = { id: "l-a", url: "https://github.com/yo/mudanza", label: "Repo" };
const B: ProjectLinkSummary = { id: "l-b", url: "https://www.example.com/plano", label: null };

const server = {
  project: PROJECT,
  links: [] as ProjectLinkSummary[],
  render: (() => {}) as (state: { project: ProjectDetail; links: ProjectLinkSummary[] }) => void,
  refresh() {
    server.render({ project: server.project, links: server.links });
  },
};

function Page() {
  const [state, setState] = useState({ project: server.project, links: server.links });
  useLayoutEffect(() => {
    server.render = setState;
  }, []);
  return (
    <ProjectDetailProvider project={state.project} now={new Date()}>
      <a href="/elsewhere" data-testid="leave">
        Volver
      </a>
      <ProjectLinksSection links={state.links} />
      <ProjectNotesSection
        rendered={
          state.project.notes ? <p data-testid="server-notes">{state.project.notes}</p> : null
        }
      />
    </ProjectDetailProvider>
  );
}

function renderPage(values: { notes?: string | null; links?: ProjectLinkSummary[] } = {}) {
  server.project = { ...PROJECT, notes: values.notes ?? null };
  server.links = values.links ?? [];
  render(<Page />);
  return userEvent.setup();
}

const announcer = () => document.querySelector("[data-detail-announcer]")!;
const notices = () => screen.getByRole("region", { name: "Avisos" });

beforeEach(() => {
  let serial = 0;
  vi.mocked(updateProjectNotes)
    .mockReset()
    .mockImplementation(async (input) => {
      const { notes } = input as { notes: string | null };
      server.project = { ...server.project, notes };
      server.refresh();
      return ok({ notes });
    });
  vi.mocked(addProjectLink)
    .mockReset()
    .mockImplementation(async (input) => {
      const { url, label, position } = input as {
        url: string;
        label: string | null;
        position?: number;
      };
      const link = { id: `l-new-${++serial}`, url, label };
      const links = [...server.links];
      links.splice(position ?? links.length, 0, link);
      server.links = links;
      server.refresh();
      return ok({ link, links });
    });
  vi.mocked(updateProjectLink)
    .mockReset()
    .mockImplementation(async (input) => {
      const { id, url, label } = input as { id: string; url: string; label: string | null };
      server.links = server.links.map((link) => (link.id === id ? { id, url, label } : link));
      server.refresh();
      return ok({ links: server.links });
    });
  vi.mocked(removeProjectLink)
    .mockReset()
    .mockImplementation(async (input) => {
      const { id } = input as { id: string };
      const position = server.links.findIndex((link) => link.id === id);
      const removed = server.links[position];
      server.links = server.links.filter((link) => link.id !== id);
      server.refresh();
      return ok({ links: server.links, removed, position });
    });
  vi.mocked(reorderProjectLinks)
    .mockReset()
    .mockImplementation(async (input) => {
      const { ids } = input as { ids: string[] };
      server.links = ids.map((id) => server.links.find((link) => link.id === id)!);
      server.refresh();
      return ok({ links: server.links });
    });
});

describe("notes", () => {
  test("without notes: an explanation and 'Escribir notas'; with them, the server's render", () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 2, name: "Notas" })).toBeInTheDocument();
    expect(screen.getByText(/Sin notas/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Escribir notas" })).toBeInTheDocument();
  });

  test("tabs follow the WAI-ARIA pattern; the preview renders the draft", async () => {
    const user = renderPage({ notes: "Hola" });
    expect(screen.getByTestId("server-notes")).toHaveTextContent("Hola");
    await user.click(screen.getByRole("button", { name: "Editar notas" }));
    const field = screen.getByRole("textbox", { name: "Notas en Markdown" });
    expect(field).toHaveFocus();
    expect(field).toHaveValue("Hola");
    const tablist = screen.getByRole("tablist", { name: "Modo del editor de notas" });
    const [write, preview] = within(tablist).getAllByRole("tab");
    expect(write).toHaveAccessibleName("Escribir");
    expect(write).toHaveAttribute("aria-selected", "true");
    expect(write).toHaveAttribute("tabindex", "0");
    expect(preview).toHaveAttribute("tabindex", "-1");
    const writePanel = document.getElementById(write.getAttribute("aria-controls")!)!;
    expect(writePanel).toHaveAttribute("role", "tabpanel");
    expect(writePanel).toHaveAccessibleName("Escribir");

    await user.clear(field);
    await user.paste("# Plan\n\n- [x] Pintar");
    write.focus();
    await user.keyboard("{ArrowRight}");
    expect(preview).toHaveFocus();
    expect(preview).toHaveAttribute("aria-selected", "true");
    expect(writePanel).not.toBeVisible();
    const previewPanel = document.getElementById(preview.getAttribute("aria-controls")!)!;
    // Headings start at h3 under the section's h2.
    expect(
      await within(previewPanel).findByRole("heading", { level: 3, name: "Plan" }),
    ).toBeInTheDocument();
    expect(previewPanel).toHaveTextContent("Hecho: Pintar");
    await user.keyboard("{Home}");
    expect(write).toHaveFocus();
  });

  test("a counter shows near the limit, and too long can't be saved", async () => {
    const user = renderPage();
    await user.click(screen.getByRole("button", { name: "Escribir notas" }));
    const field = screen.getByRole("textbox", { name: "Notas en Markdown" });
    expect(field).toHaveAccessibleDescription(/Markdown: \*\*negrita\*\*/);
    await user.click(field);
    await user.paste("a".repeat(18_000));
    expect(field).toHaveAccessibleDescription("18.000 de 20.000 caracteres.");
    await user.paste("a".repeat(2_001));
    expect(field).toHaveAccessibleDescription("20.001 de 20.000 caracteres: quita 1 para guardar.");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(field).toHaveAccessibleDescription("Usa 20.000 caracteres como máximo.");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(updateProjectNotes).not.toHaveBeenCalled();
  });

  test("control characters are refused before sending", async () => {
    const user = renderPage();
    await user.click(screen.getByRole("button", { name: "Escribir notas" }));
    const field = screen.getByRole("textbox", { name: "Notas en Markdown" });
    await user.click(field);
    await user.paste("a\u0000b");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(field).toHaveAccessibleDescription(/caracteres de control/);
    expect(updateProjectNotes).not.toHaveBeenCalled();
  });

  test("Guardar saves, closes the editor, focus back, 'Se guardaron las notas.'", async () => {
    const user = renderPage();
    await user.click(screen.getByRole("button", { name: "Escribir notas" }));
    await user.type(screen.getByRole("textbox", { name: "Notas en Markdown" }), "Primera nota");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(updateProjectNotes).toHaveBeenCalledWith({ id: PROJECT.id, notes: "Primera nota" });
    expect(await screen.findByTestId("server-notes")).toHaveTextContent("Primera nota");
    expect(screen.getByRole("button", { name: "Editar notas" })).toHaveFocus();
    await waitFor(() => expect(announcer()).toHaveTextContent("Se guardaron las notas."));
  });

  test("⌘↵ saves too", async () => {
    const user = renderPage();
    await user.click(screen.getByRole("button", { name: "Escribir notas" }));
    await user.type(screen.getByRole("textbox", { name: "Notas en Markdown" }), "Nota");
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    expect(updateProjectNotes).toHaveBeenCalledWith({ id: PROJECT.id, notes: "Nota" });
  });

  test("a failure goes back to the saved notes, says why and keeps the text", async () => {
    vi.mocked(updateProjectNotes).mockResolvedValueOnce(fail("Este proyecto ya no existe."));
    const user = renderPage({ notes: "Vieja" });
    await user.click(screen.getByRole("button", { name: "Editar notas" }));
    const field = screen.getByRole("textbox", { name: "Notas en Markdown" });
    await user.clear(field);
    await user.type(field, "Nueva");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(notices()).toHaveTextContent(
        "No se pudieron guardar las notas; volvieron a como estaban. Este proyecto ya no existe. Tu texto sigue en «Editar notas».",
      ),
    );
    expect(screen.getByTestId("server-notes")).toHaveTextContent("Vieja");
    expect(screen.getByText("Tienes un borrador sin guardar de estas notas.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Editar notas" }));
    expect(screen.getByRole("textbox", { name: "Notas en Markdown" })).toHaveValue("Nueva");
  });

  test("Cancelar discards the draft", async () => {
    const user = renderPage({ notes: "Vieja" });
    await user.click(screen.getByRole("button", { name: "Editar notas" }));
    await user.type(screen.getByRole("textbox", { name: "Notas en Markdown" }), " y más");
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.getByRole("button", { name: "Editar notas" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Editar notas" }));
    expect(screen.getByRole("textbox", { name: "Notas en Markdown" })).toHaveValue("Vieja");
  });
});

describe("leaving with unsaved notes", () => {
  function beforeUnload() {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }

  test("the browser prompt only while there are unsaved changes", async () => {
    const user = renderPage({ notes: "Vieja" });
    expect(beforeUnload()).toBe(false);
    await user.click(screen.getByRole("button", { name: "Editar notas" }));
    // Open but unchanged: nothing to lose.
    expect(beforeUnload()).toBe(false);
    await user.type(screen.getByRole("textbox", { name: "Notas en Markdown" }), "!");
    expect(beforeUnload()).toBe(true);
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(beforeUnload()).toBe(false));
  });

  test("an in-app link asks inside the page; 'Seguir editando' stays", async () => {
    const user = renderPage();
    const followed = vi.fn((event: MouseEvent) => event.preventDefault());
    screen.getByTestId("leave").addEventListener("click", followed);
    // Positive control: with nothing unsaved the link is followed.
    await user.click(screen.getByTestId("leave"));
    expect(followed).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Escribir notas" }));
    await user.type(screen.getByRole("textbox", { name: "Notas en Markdown" }), "Borrador");
    await user.click(screen.getByTestId("leave"));
    expect(followed).toHaveBeenCalledTimes(1);
    const confirm = screen.getByRole("group", { name: "Tienes cambios sin guardar en las notas." });
    expect(confirm).toHaveAccessibleDescription(/Si sales ahora, se pierden/);
    const stay = within(confirm).getByRole("button", { name: "Seguir editando" });
    await waitFor(() => expect(stay).toHaveFocus());
    await user.click(stay);
    expect(screen.queryByRole("group", { name: /cambios sin guardar/ })).toBeNull();
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Notas en Markdown" })).toHaveFocus(),
    );
    expect(screen.getByRole("textbox", { name: "Notas en Markdown" })).toHaveValue("Borrador");
  });

  test("'Salir sin guardar' follows the link that was stopped", async () => {
    const user = renderPage();
    const followed = vi.fn((event: MouseEvent) => event.preventDefault());
    screen.getByTestId("leave").addEventListener("click", followed);
    await user.click(screen.getByRole("button", { name: "Escribir notas" }));
    await user.type(screen.getByRole("textbox", { name: "Notas en Markdown" }), "Borrador");
    await user.click(screen.getByTestId("leave"));
    expect(followed).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Salir sin guardar" }));
    expect(followed).toHaveBeenCalledTimes(1);
  });

  test("code navigation (the number shortcuts) asks too", async () => {
    const user = renderPage();
    const navigate = vi.fn();
    requestNavigation("/areas", navigate);
    expect(navigate).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Escribir notas" }));
    await user.type(screen.getByRole("textbox", { name: "Notas en Markdown" }), "Borrador");
    act(() => requestNavigation("/areas", navigate));
    expect(navigate).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Salir sin guardar" }));
    expect(navigate).toHaveBeenCalledTimes(2);
  });

  test("links that open elsewhere or only move within the page are never stopped", async () => {
    const user = renderPage({ links: [A] });
    await user.click(screen.getByRole("button", { name: "Escribir notas" }));
    await user.type(screen.getByRole("textbox", { name: "Notas en Markdown" }), "Borrador");
    const external = screen.getByRole("link", { name: /Repo/ });
    const followed = vi.fn((event: MouseEvent) => event.preventDefault());
    external.addEventListener("click", followed);
    await user.click(external);
    expect(followed).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("group", { name: /cambios sin guardar/ })).toBeNull();
  });
});

describe("links", () => {
  test("label or host, opened in a new tab without opener or referrer", () => {
    renderPage({ links: [A, B] });
    const list = screen.getByRole("list", { name: "Enlaces del proyecto" });
    const links = within(list).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "Repogithub.com (se abre en una pestaña nueva)",
      "example.com (se abre en una pestaña nueva)",
    ]);
    for (const link of links) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer nofollow");
    }
    expect(
      screen.getByRole("heading", { level: 2, name: "Enlaces, 2 enlaces" }),
    ).toBeInTheDocument();
  });

  test("a stored URL that isn't http(s) is never a link", () => {
    renderPage({ links: [{ id: "x", url: "javascript:alert(1)", label: "Malo" }] });
    expect(screen.queryByRole("link", { name: /Malo/ })).toBeNull();
    expect(screen.getByText("Malo")).toBeInTheDocument();
  });

  test("add: the URL is checked, https:// assumed, and the new link shows at once", async () => {
    const user = renderPage();
    expect(screen.getByText(/Sin enlaces/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Agregar enlace" }));
    const url = screen.getByRole("textbox", { name: "Dirección" });
    expect(url).toHaveFocus();
    await user.type(url, "javascript:alert(1){enter}");
    expect(url).toHaveAccessibleDescription("Solo se aceptan direcciones http:// o https://.");
    expect(addProjectLink).not.toHaveBeenCalled();
    await user.clear(url);
    await user.type(url, "example.com/docs");
    await user.type(screen.getByRole("textbox", { name: "Etiqueta" }), "Docs{enter}");
    expect(addProjectLink).toHaveBeenCalledWith({
      projectId: PROJECT.id,
      url: "https://example.com/docs",
      label: "Docs",
      position: undefined,
    });
    expect(await screen.findByRole("link", { name: /Docs/ })).toHaveAttribute(
      "href",
      "https://example.com/docs",
    );
    expect(screen.getByRole("button", { name: "Agregar enlace" })).toHaveFocus();
    await waitFor(() => expect(announcer()).toHaveTextContent("Se agregó el enlace «Docs»."));
  });

  test("edit: URL and label", async () => {
    const user = renderPage({ links: [A] });
    await user.click(screen.getByRole("button", { name: "Editar enlace Repo" }));
    const label = screen.getByRole("textbox", { name: "Etiqueta" });
    await user.clear(label);
    await user.type(label, "Código{enter}");
    expect(updateProjectLink).toHaveBeenCalledWith({
      projectId: PROJECT.id,
      id: A.id,
      url: A.url,
      label: "Código",
    });
    expect(await screen.findByRole("button", { name: "Editar enlace Código" })).toHaveFocus();
  });

  test("Esc cancels an edit without saving", async () => {
    const user = renderPage({ links: [A] });
    await user.click(screen.getByRole("button", { name: "Editar enlace Repo" }));
    await user.keyboard("x{Escape}");
    expect(updateProjectLink).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Editar enlace Repo" })).toHaveFocus();
  });

  test("Subir / Bajar: the whole order is sent; focus stays; the ends are aria-disabled", async () => {
    const user = renderPage({ links: [A, B] });
    expect(screen.getByRole("button", { name: "Subir Repo" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await user.click(screen.getByRole("button", { name: "Subir Repo" }));
    expect(reorderProjectLinks).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Bajar Repo" }));
    await waitFor(() =>
      expect(reorderProjectLinks).toHaveBeenCalledWith({
        projectId: PROJECT.id,
        ids: [B.id, A.id],
      }),
    );
    await waitFor(() =>
      expect(
        within(screen.getByRole("list", { name: "Enlaces del proyecto" }))
          .getAllByRole("link")
          .map((link) => link.textContent?.split(" ")[0]),
      ).toEqual(["example.com", "Repogithub.com"]),
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Bajar Repo" })).toHaveFocus());
    await waitFor(() => expect(announcer()).toHaveTextContent("«Repo» pasó al lugar 2 de 2."));
  });

  test("a refused reorder goes back, with a notice", async () => {
    vi.mocked(reorderProjectLinks).mockResolvedValueOnce(
      fail("Los enlaces cambiaron en otra pestaña; la lista ya está al día. Vuelve a moverlo."),
    );
    const user = renderPage({ links: [A, B] });
    await user.click(screen.getByRole("button", { name: "Bajar Repo" }));
    await waitFor(() =>
      expect(notices()).toHaveTextContent(
        "No se pudo mover el enlace; volvió a su lugar. Los enlaces cambiaron en otra pestaña",
      ),
    );
    expect(
      within(screen.getByRole("list", { name: "Enlaces del proyecto" }))
        .getAllByRole("link")[0]
        .textContent?.startsWith("Repo"),
    ).toBe(true);
  });

  test("remove from the editor, then Deshacer puts it back in its place", async () => {
    const user = renderPage({ links: [A, B] });
    await user.click(screen.getByRole("button", { name: "Editar enlace Repo" }));
    await user.click(screen.getByRole("button", { name: "Quitar enlace" }));
    expect(removeProjectLink).toHaveBeenCalledWith({ projectId: PROJECT.id, id: A.id });
    await waitFor(() => expect(screen.queryByRole("link", { name: /Repo/ })).toBeNull());
    // Focus moves to the row that took its place.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Editar enlace example.com" })).toHaveFocus(),
    );
    await waitFor(() => expect(notices()).toHaveTextContent("Se quitó «Repo»."));
    await user.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    expect(addProjectLink).toHaveBeenCalledWith({
      projectId: PROJECT.id,
      url: A.url,
      label: "Repo",
      position: 0,
    });
    await waitFor(() =>
      expect(
        within(screen.getByRole("list", { name: "Enlaces del proyecto" }))
          .getAllByRole("link")[0]
          .textContent?.startsWith("Repo"),
      ).toBe(true),
    );
  });

  test("a failed add says why", async () => {
    vi.mocked(addProjectLink).mockRejectedValueOnce(new Error("offline"));
    const user = renderPage();
    await user.click(screen.getByRole("button", { name: "Agregar enlace" }));
    await user.type(screen.getByRole("textbox", { name: "Dirección" }), "https://a.example{enter}");
    await waitFor(() =>
      expect(notices()).toHaveTextContent(
        "No se pudo agregar el enlace. Revisa tu conexión e inténtalo de nuevo.",
      ),
    );
    await waitFor(() =>
      expect(screen.queryByRole("list", { name: "Enlaces del proyecto" })).toBeNull(),
    );
  });
});
