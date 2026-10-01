import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { AreasManager } from "@/app/(app)/areas/_components/areas-manager";
import AreasPage, { metadata } from "@/app/(app)/areas/page";
import { UNAUTHORIZED_MESSAGE } from "@/lib/action-result";
import { requireOwner } from "@/lib/auth";
import { createLifeArea, updateLifeArea } from "@/modules/core/actions";
import { LIFE_AREA_ERRORS } from "@/modules/core/life-area-input";
import type { LifeAreaSummary } from "@/modules/core/life-areas";
import { listArchivedLifeAreas, listLifeAreas } from "@/modules/core/queries";

vi.mock("@/lib/auth", () => ({ requireOwner: vi.fn() }));
vi.mock("@/modules/core/queries", () => ({
  listLifeAreas: vi.fn(),
  listArchivedLifeAreas: vi.fn(),
}));
vi.mock("@/modules/core/actions", () => ({
  createLifeArea: vi.fn(),
  updateLifeArea: vi.fn(),
  reorderLifeAreas: vi.fn(),
  archiveLifeArea: vi.fn(),
  unarchiveLifeArea: vi.fn(),
}));

const AREAS: LifeAreaSummary[] = [
  { id: "a1", slug: "home", name: "Hogar", color: "home", icon: "house", sortOrder: 0 },
  {
    id: "a2",
    slug: "health",
    name: "Salud y Bienestar",
    color: "health",
    icon: "heart-pulse",
    sortOrder: 1,
  },
];

let desktop = false;

beforeEach(() => {
  desktop = false;
  window.matchMedia = vi.fn((query: string) => ({
    matches: desktop,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  vi.mocked(requireOwner)
    .mockReset()
    .mockResolvedValue({ user: { id: "owner" } } as never);
  vi.mocked(listLifeAreas).mockReset().mockResolvedValue(AREAS);
  vi.mocked(listArchivedLifeAreas).mockReset().mockResolvedValue([]);
  vi.mocked(createLifeArea).mockReset();
  vi.mocked(updateLifeArea).mockReset();
});

const dialog = () => screen.getByRole("dialog");
const nameField = () => within(dialog()).getByRole("textbox", { name: "Nombre" });
const colorGroup = () => within(dialog()).getByRole("radiogroup", { name: "Color" });
const iconGroup = () => within(dialog()).getByRole("radiogroup", { name: "Ícono" });
/** The status region for create/edit results (the notices have their own, named "Avisos"). */
const announcer = () =>
  screen.getAllByRole("status", { hidden: true }).find((element) => element.tagName === "P")!;

describe("page", () => {
  test("has its own title and checks the owner before listing", async () => {
    expect(metadata.title).toBe("Áreas · brahua-os");
    render(await AreasPage());
    expect(requireOwner).toHaveBeenCalled();
    expect(listLifeAreas).toHaveBeenCalledWith();
    expect(listArchivedLifeAreas).toHaveBeenCalledWith();
    expect(screen.getByRole("heading", { level: 1, name: "Áreas" })).toBeInTheDocument();
  });

  test("lists the areas in order with their tag and an edit button per row", async () => {
    render(await AreasPage());
    const list = screen.getByRole("list", { name: "Tus áreas" });
    const rows = within(list).getAllByRole("button", { name: /^Editar / });
    expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual([
      "Editar Hogar",
      "Editar Salud y Bienestar",
    ]);
    expect(rows[0]).toHaveTextContent("Hogar");
    expect(rows[0].querySelector(".bo-area-tag.bo-area--home")).not.toBeNull();
    expect(screen.getByText("2 áreas")).toBeInTheDocument();
  });

  test("shows an empty state without areas", async () => {
    vi.mocked(listLifeAreas).mockResolvedValue([]);
    render(await AreasPage());
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Aún no tienes áreas" }),
    ).toBeInTheDocument();
    expect(screen.getByText("0 áreas")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nueva área" })).toBeInTheDocument();
  });
});

describe("create", () => {
  test("opens a bottom sheet on the phone and a side panel from 1024 px, focused on the name", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<AreasManager areas={AREAS} archived={[]} />);
    await user.click(screen.getByRole("button", { name: "Nueva área" }));
    await screen.findByRole("dialog");
    expect(dialog()).toHaveAccessibleName("Nueva área");
    expect(dialog()).toHaveClass("bo-sheet--bottom");
    expect(nameField()).toHaveFocus();
    unmount();

    desktop = true;
    render(<AreasManager areas={AREAS} archived={[]} />);
    await user.click(screen.getByRole("button", { name: "Nueva área" }));
    await screen.findByRole("dialog");
    expect(dialog()).toHaveClass("bo-sheet--side");
  });

  test("starts with nothing picked: the preview asks for a color and an icon", async () => {
    const user = userEvent.setup();
    render(<AreasManager areas={AREAS} archived={[]} />);
    await user.click(screen.getByRole("button", { name: "Nueva área" }));
    await screen.findByRole("dialog");

    expect(within(colorGroup()).getAllByRole("radio")).toHaveLength(8);
    expect(within(iconGroup()).getAllByRole("radio")).toHaveLength(55);
    expect(within(dialog()).queryAllByRole("radio", { checked: true })).toEqual([]);
    expect(within(dialog()).getByText("Elige un color y un ícono para verla.")).toBeInTheDocument();
  });

  test("shows every field's error, focuses the first one and does not call the server", async () => {
    const user = userEvent.setup();
    render(<AreasManager areas={AREAS} archived={[]} />);
    await user.click(screen.getByRole("button", { name: "Nueva área" }));
    await screen.findByRole("dialog");
    await user.type(nameField(), "   ");
    await user.click(within(dialog()).getByRole("button", { name: "Crear área" }));

    expect(nameField()).toHaveAttribute("aria-invalid", "true");
    expect(nameField()).toHaveAccessibleDescription(LIFE_AREA_ERRORS.nameRequired);
    expect(nameField()).toHaveFocus();
    expect(colorGroup()).toHaveAttribute("aria-invalid", "true");
    expect(colorGroup()).toHaveAccessibleDescription(LIFE_AREA_ERRORS.color);
    expect(iconGroup()).toHaveAttribute("aria-invalid", "true");
    expect(iconGroup()).toHaveAccessibleDescription(expect.stringContaining(LIFE_AREA_ERRORS.icon));
    expect(createLifeArea).not.toHaveBeenCalled();

    // Fixing a field clears its error only.
    await user.click(within(colorGroup()).getByRole("radio", { name: "Violeta" }));
    expect(colorGroup()).not.toHaveAttribute("aria-invalid");
    expect(iconGroup()).toHaveAttribute("aria-invalid", "true");
  });

  test("focus goes to the first invalid field in form order", async () => {
    const user = userEvent.setup();
    render(<AreasManager areas={AREAS} archived={[]} />);
    await user.click(screen.getByRole("button", { name: "Nueva área" }));
    await screen.findByRole("dialog");
    await user.type(nameField(), "Música");
    await user.click(within(colorGroup()).getByRole("radio", { name: "Lima" }));
    await user.click(within(dialog()).getByRole("button", { name: "Crear área" }));

    // Icon is the only invalid field; with nothing picked, the first icon takes focus.
    expect(within(iconGroup()).getByRole("radio", { name: "Casa" })).toHaveFocus();
  });

  test("creates the area, closes the sheet, returns focus and announces it", async () => {
    const user = userEvent.setup();
    vi.mocked(createLifeArea).mockResolvedValue({
      ok: true,
      data: {
        id: "a3",
        slug: "musica",
        name: "Música",
        color: "hobbies",
        icon: "music",
        sortOrder: 2,
      },
    });
    render(<AreasManager areas={AREAS} archived={[]} />);
    const trigger = screen.getByRole("button", { name: "Nueva área" });
    await user.click(trigger);
    await screen.findByRole("dialog");
    await user.type(nameField(), "  Música ");
    await user.click(within(colorGroup()).getByRole("radio", { name: "Lima" }));
    await user.click(within(iconGroup()).getByRole("radio", { name: "Música" }));

    // Live preview with the tag.
    const preview = dialog().querySelector(".bo-area-tag");
    expect(preview).toHaveClass("bo-area--hobbies");
    expect(preview).toHaveTextContent("Música");

    await user.click(within(dialog()).getByRole("button", { name: "Crear área" }));

    expect(createLifeArea).toHaveBeenCalledWith({
      name: "Música",
      color: "hobbies",
      icon: "music",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    await waitFor(() => expect(announcer()).toHaveTextContent("Área «Música» creada."));
  });

  test("server field errors show on their fields; other errors on top of the form", async () => {
    const user = userEvent.setup();
    vi.mocked(createLifeArea)
      .mockResolvedValueOnce({
        ok: false,
        error: "Revisa los campos marcados.",
        fieldErrors: { name: [LIFE_AREA_ERRORS.nameTooLong] },
      })
      .mockResolvedValueOnce({ ok: false, error: UNAUTHORIZED_MESSAGE })
      .mockRejectedValueOnce(new Error("network"));
    render(<AreasManager areas={AREAS} archived={[]} />);
    await user.click(screen.getByRole("button", { name: "Nueva área" }));
    await screen.findByRole("dialog");
    await user.type(nameField(), "Música");
    await user.click(within(colorGroup()).getByRole("radio", { name: "Lima" }));
    await user.click(within(iconGroup()).getByRole("radio", { name: "Música" }));
    const submit = within(dialog()).getByRole("button", { name: "Crear área" });

    await user.click(submit);
    expect(await within(dialog()).findByText(LIFE_AREA_ERRORS.nameTooLong)).toBeInTheDocument();
    expect(nameField()).toHaveFocus();

    await user.click(submit);
    expect(await within(dialog()).findByRole("alert")).toHaveTextContent(UNAUTHORIZED_MESSAGE);
    expect(nameField()).toHaveAttribute("aria-invalid", "false");

    await user.click(submit);
    await waitFor(() =>
      expect(within(dialog()).getByRole("alert")).toHaveTextContent(/No se pudo guardar/),
    );
    expect(dialog()).toBeInTheDocument();
  });
});

describe("edit", () => {
  test("opens with the area's values, saves, and returns focus to its row", async () => {
    const user = userEvent.setup();
    vi.mocked(updateLifeArea).mockResolvedValue({
      ok: true,
      data: { ...AREAS[0], name: "Casa", icon: "tent" },
    });
    render(<AreasManager areas={AREAS} archived={[]} />);
    const row = screen.getByRole("button", { name: "Editar Hogar" });
    await user.click(row);
    await screen.findByRole("dialog");

    expect(dialog()).toHaveAccessibleName("Editar área");
    expect(nameField()).toHaveValue("Hogar");
    expect(within(colorGroup()).getByRole("radio", { name: "Ámbar" })).toBeChecked();
    expect(within(iconGroup()).getByRole("radio", { name: "Casa" })).toBeChecked();

    await user.clear(nameField());
    await user.type(nameField(), "Casa");
    await user.click(within(iconGroup()).getByRole("radio", { name: "Carpa" }));
    await user.click(within(dialog()).getByRole("button", { name: "Guardar cambios" }));

    expect(updateLifeArea).toHaveBeenCalledWith({
      id: "a1",
      name: "Casa",
      color: "home",
      icon: "tent",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(row).toHaveFocus();
    await waitFor(() => expect(announcer()).toHaveTextContent("Cambios guardados en «Casa»."));
  });

  test("Cancelar closes without saving and reopening starts from the saved values", async () => {
    const user = userEvent.setup();
    render(<AreasManager areas={AREAS} archived={[]} />);
    const row = screen.getByRole("button", { name: "Editar Hogar" });
    await user.click(row);
    await screen.findByRole("dialog");
    await user.type(nameField(), " cambiado");
    await user.click(within(dialog()).getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(row).toHaveFocus();
    expect(updateLifeArea).not.toHaveBeenCalled();

    await user.click(row);
    await screen.findByRole("dialog");
    expect(nameField()).toHaveValue("Hogar");
  });
});

describe("keyboard", () => {
  test("swatches and icons are radio groups with one tab stop; arrows pick", async () => {
    const user = userEvent.setup();
    render(<AreasManager areas={AREAS} archived={[]} />);
    await user.click(screen.getByRole("button", { name: "Editar Hogar" }));
    await screen.findByRole("dialog");

    // Name → color group (the checked swatch) → icon group (the checked icon).
    await user.tab();
    expect(within(colorGroup()).getByRole("radio", { name: "Ámbar" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    const green = within(colorGroup()).getByRole("radio", { name: "Verde" });
    expect(green).toHaveFocus();
    expect(green).toBeChecked();
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(within(colorGroup()).getByRole("radio", { name: "Lima" })).toBeChecked();
    await user.keyboard("{Home}");
    expect(within(colorGroup()).getByRole("radio", { name: "Ámbar" })).toBeChecked();

    await user.tab();
    expect(within(iconGroup()).getByRole("radio", { name: "Casa" })).toHaveFocus();
    await user.keyboard("{End}");
    expect(within(iconGroup()).getByRole("radio", { name: "Llave inglesa" })).toBeChecked();
    await user.keyboard("{ArrowRight}");
    expect(within(iconGroup()).getByRole("radio", { name: "Casa" })).toBeChecked();

    // Preview follows.
    expect(dialog().querySelector(".bo-area-tag")).toHaveClass("bo-area--home");
    expect(within(dialog()).getAllByRole("radio", { checked: true })).toHaveLength(2);
    expect(
      within(dialog())
        .getAllByRole("radio")
        .filter((radio) => radio.tabIndex === 0),
    ).toHaveLength(2);
  });
});

describe("while saving", () => {
  test("Esc, ✕ and Cancelar do nothing until the result arrives; then it closes once", async () => {
    const user = userEvent.setup();
    let resolve!: (value: Awaited<ReturnType<typeof createLifeArea>>) => void;
    vi.mocked(createLifeArea).mockReturnValue(new Promise((r) => (resolve = r)));
    render(<AreasManager areas={AREAS} archived={[]} />);
    await user.click(screen.getByRole("button", { name: "Nueva área" }));
    await screen.findByRole("dialog");
    await user.type(nameField(), "Música");
    await user.click(within(colorGroup()).getByRole("radio", { name: "Lima" }));
    await user.click(within(iconGroup()).getByRole("radio", { name: "Música" }));
    await user.click(within(dialog()).getByRole("button", { name: "Crear área" }));

    const saving = within(dialog()).getByRole("button", { name: "Guardando…" });
    expect(saving).toHaveAttribute("aria-disabled", "true");
    const cancel = within(dialog()).getByRole("button", { name: "Cancelar" });
    expect(cancel).toHaveAttribute("aria-disabled", "true");
    await user.keyboard("{Escape}");
    await user.click(cancel);
    await user.click(within(dialog()).getByRole("button", { name: "Cerrar" }));
    await user.click(saving); // a second submit is ignored too
    expect(dialog()).toBeInTheDocument();
    expect(createLifeArea).toHaveBeenCalledTimes(1);

    resolve({
      ok: true,
      data: {
        id: "a3",
        slug: "musica",
        name: "Música",
        color: "hobbies",
        icon: "music",
        sortOrder: 2,
      },
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(announcer()).toHaveTextContent("Área «Música» creada."));
  });

  test("the announcement waits until the sheet is gone and the page is no longer hidden", async () => {
    const user = userEvent.setup();
    vi.mocked(updateLifeArea).mockResolvedValue({ ok: true, data: AREAS[0] });
    render(<AreasManager areas={AREAS} archived={[]} />);
    await user.click(screen.getByRole("button", { name: "Editar Hogar" }));
    await screen.findByRole("dialog");
    const status = announcer();
    const seen: { text: string; hidden: boolean; dialog: boolean }[] = [];
    const observer = new MutationObserver(() => {
      if (!status.textContent) return;
      seen.push({
        text: status.textContent,
        hidden: status.closest('[aria-hidden="true"]') !== null,
        dialog: document.querySelector('[role="dialog"]') !== null,
      });
    });
    observer.observe(status, { childList: true, characterData: true, subtree: true });
    await user.click(within(dialog()).getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(seen).toHaveLength(1));
    observer.disconnect();
    expect(seen[0]).toEqual({
      text: "Cambios guardados en «Hogar».",
      hidden: false,
      dialog: false,
    });
  });
});

describe("errors without a visible field", () => {
  test("show that field's own message on top instead of the generic summary", async () => {
    const user = userEvent.setup();
    vi.mocked(updateLifeArea).mockResolvedValue({
      ok: false,
      error: "Revisa los campos marcados.",
      fieldErrors: { id: [LIFE_AREA_ERRORS.id] },
    });
    render(<AreasManager areas={AREAS} archived={[]} />);
    await user.click(screen.getByRole("button", { name: "Editar Hogar" }));
    await screen.findByRole("dialog");
    await user.click(within(dialog()).getByRole("button", { name: "Guardar cambios" }));
    expect(await within(dialog()).findByRole("alert")).toHaveTextContent(LIFE_AREA_ERRORS.id);
  });

  test("an invalid radio group describes its tab stop with the error too", async () => {
    const user = userEvent.setup();
    render(<AreasManager areas={AREAS} archived={[]} />);
    await user.click(screen.getByRole("button", { name: "Nueva área" }));
    await screen.findByRole("dialog");
    await user.click(within(dialog()).getByRole("button", { name: "Crear área" }));
    expect(within(colorGroup()).getByRole("radio", { name: "Ámbar" })).toHaveAccessibleDescription(
      LIFE_AREA_ERRORS.color,
    );
    expect(iconGroup()).toHaveAccessibleDescription(
      `Usa las flechas para moverte por filas y columnas. ${LIFE_AREA_ERRORS.icon}`,
    );
  });
});

test("shows the picked icon's name next to the label and as a tooltip", async () => {
  const user = userEvent.setup();
  render(<AreasManager areas={AREAS} archived={[]} />);
  await user.click(screen.getByRole("button", { name: "Editar Hogar" }));
  await screen.findByRole("dialog");
  expect(within(dialog()).getByText("· Casa")).toBeInTheDocument();
  await user.click(within(iconGroup()).getByRole("radio", { name: "Carpa" }));
  expect(within(dialog()).getByText("· Carpa")).toBeInTheDocument();
  expect(within(iconGroup()).getByRole("radio", { name: "Carpa" })).toHaveAttribute(
    "title",
    "Carpa",
  );
});
