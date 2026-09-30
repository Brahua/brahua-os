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
import { listLifeAreas } from "@/modules/core/queries";

vi.mock("@/lib/auth", () => ({ requireOwner: vi.fn() }));
vi.mock("@/modules/core/queries", () => ({ listLifeAreas: vi.fn() }));
vi.mock("@/modules/core/actions", () => ({ createLifeArea: vi.fn(), updateLifeArea: vi.fn() }));

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
  vi.mocked(createLifeArea).mockReset();
  vi.mocked(updateLifeArea).mockReset();
});

const dialog = () => screen.getByRole("dialog");
const nameField = () => within(dialog()).getByRole("textbox", { name: "Nombre" });
const colorGroup = () => within(dialog()).getByRole("radiogroup", { name: "Color" });
const iconGroup = () => within(dialog()).getByRole("radiogroup", { name: "Ícono" });

describe("page", () => {
  test("has its own title and checks the owner before listing", async () => {
    expect(metadata.title).toBe("Áreas · brahua-os");
    render(await AreasPage());
    expect(requireOwner).toHaveBeenCalled();
    expect(listLifeAreas).toHaveBeenCalledWith();
    expect(screen.getByRole("heading", { level: 1, name: "Áreas" })).toBeInTheDocument();
  });

  test("lists the areas in order with their tag and an edit button per row", async () => {
    render(await AreasPage());
    const list = screen.getByRole("list", { name: "Tus áreas" });
    const rows = within(list).getAllByRole("button");
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
    const { unmount } = render(<AreasManager areas={AREAS} />);
    await user.click(screen.getByRole("button", { name: "Nueva área" }));
    expect(dialog()).toHaveAccessibleName("Nueva área");
    expect(dialog()).toHaveClass("bo-sheet--bottom");
    expect(nameField()).toHaveFocus();
    unmount();

    desktop = true;
    render(<AreasManager areas={AREAS} />);
    await user.click(screen.getByRole("button", { name: "Nueva área" }));
    expect(dialog()).toHaveClass("bo-sheet--side");
  });

  test("starts with nothing picked: the preview asks for a color and an icon", async () => {
    const user = userEvent.setup();
    render(<AreasManager areas={AREAS} />);
    await user.click(screen.getByRole("button", { name: "Nueva área" }));

    expect(within(colorGroup()).getAllByRole("radio")).toHaveLength(8);
    expect(within(iconGroup()).getAllByRole("radio")).toHaveLength(55);
    expect(within(dialog()).queryAllByRole("radio", { checked: true })).toEqual([]);
    expect(within(dialog()).getByText("Elige un color y un ícono para verla.")).toBeInTheDocument();
  });

  test("shows every field's error, focuses the first one and does not call the server", async () => {
    const user = userEvent.setup();
    render(<AreasManager areas={AREAS} />);
    await user.click(screen.getByRole("button", { name: "Nueva área" }));
    await user.type(nameField(), "   ");
    await user.click(within(dialog()).getByRole("button", { name: "Crear área" }));

    expect(nameField()).toHaveAttribute("aria-invalid", "true");
    expect(nameField()).toHaveAccessibleDescription(LIFE_AREA_ERRORS.nameRequired);
    expect(nameField()).toHaveFocus();
    expect(colorGroup()).toHaveAttribute("aria-invalid", "true");
    expect(colorGroup()).toHaveAccessibleDescription(LIFE_AREA_ERRORS.color);
    expect(iconGroup()).toHaveAttribute("aria-invalid", "true");
    expect(iconGroup()).toHaveAccessibleDescription(LIFE_AREA_ERRORS.icon);
    expect(createLifeArea).not.toHaveBeenCalled();

    // Fixing a field clears its error only.
    await user.click(within(colorGroup()).getByRole("radio", { name: "Violeta" }));
    expect(colorGroup()).not.toHaveAttribute("aria-invalid");
    expect(iconGroup()).toHaveAttribute("aria-invalid", "true");
  });

  test("focus goes to the first invalid field in form order", async () => {
    const user = userEvent.setup();
    render(<AreasManager areas={AREAS} />);
    await user.click(screen.getByRole("button", { name: "Nueva área" }));
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
    render(<AreasManager areas={AREAS} />);
    const trigger = screen.getByRole("button", { name: "Nueva área" });
    await user.click(trigger);
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
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Área «Música» creada."),
    );
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
    render(<AreasManager areas={AREAS} />);
    await user.click(screen.getByRole("button", { name: "Nueva área" }));
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
    render(<AreasManager areas={AREAS} />);
    const row = screen.getByRole("button", { name: "Editar Hogar" });
    await user.click(row);

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
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Cambios guardados en «Casa»."),
    );
  });

  test("Cancelar closes without saving and reopening starts from the saved values", async () => {
    const user = userEvent.setup();
    render(<AreasManager areas={AREAS} />);
    const row = screen.getByRole("button", { name: "Editar Hogar" });
    await user.click(row);
    await user.type(nameField(), " cambiado");
    await user.click(within(dialog()).getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(row).toHaveFocus();
    expect(updateLifeArea).not.toHaveBeenCalled();

    await user.click(row);
    expect(nameField()).toHaveValue("Hogar");
  });
});

describe("keyboard", () => {
  test("swatches and icons are radio groups with one tab stop; arrows pick", async () => {
    const user = userEvent.setup();
    render(<AreasManager areas={AREAS} />);
    await user.click(screen.getByRole("button", { name: "Editar Hogar" }));

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
