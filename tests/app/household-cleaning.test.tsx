// `household` H1: the cleaning view as the owner uses it, against a fake server. The Server Actions
// are mocked; the screen's queue, notices and focus handling are the real ones.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { fail, ok } from "@/lib/action-result";
import { ownerDateKey } from "@/lib/time";
import { ScreenServicesProvider } from "@/modules/core/components/screen-services";
import {
  addCleaning,
  completeCleaning,
  removeCleaning,
  reopenCleaning,
  restoreCleaning,
} from "@/modules/household/actions";
import { CLEANING_COPY as COPY } from "@/modules/household/cleaning-copy";
import type { CleaningItem } from "@/modules/household/cleaning-view";
import { CleaningScreen } from "@/modules/household/components/cleaning-screen";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => router,
}));
vi.mock("@/modules/household/actions", () => ({
  addCleaning: vi.fn(),
  completeCleaning: vi.fn(),
  reopenCleaning: vi.fn(),
  removeCleaning: vi.fn(),
  restoreCleaning: vi.fn(),
}));

const TODAY = ownerDateKey(new Date());
const day = (offset: number) =>
  new Date(new Date(`${TODAY}T00:00:00Z`).getTime() + offset * 86_400_000)
    .toISOString()
    .slice(0, 10);

const A: CleaningItem = {
  id: "00000000-0000-4000-8000-00000000000a",
  title: "Limpiar inodoro",
  dueDate: TODAY,
  zone: "baño",
  frequency: "Cada semana, lunes",
};
const B: CleaningItem = {
  id: "00000000-0000-4000-8000-00000000000b",
  title: "Limpiar espejo",
  dueDate: day(-2),
  zone: "baño",
  frequency: "Cada 2 semanas",
};
const C: CleaningItem = {
  id: "00000000-0000-4000-8000-00000000000c",
  title: "Trapear",
  dueDate: day(1),
  zone: "sala/comedor",
  frequency: "Cada semana, lunes",
};

function Screen({
  items = [A, B, C],
  group = "zona",
}: {
  items?: CleaningItem[];
  group?: "zona" | "dia";
}) {
  return (
    <ScreenServicesProvider
      label={COPY.noticesLabel}
      actionHint={COPY.undoHint}
      day={{ today: TODAY, changedMessage: "Empezó un día nuevo." }}
    >
      <CleaningScreen items={items} today={TODAY} group={group} />
    </ScreenServicesProvider>
  );
}

const rowOf = (item: CleaningItem) =>
  document.querySelector<HTMLElement>(`[data-household-row="${item.id}"]`);
const doneKey = (item: CleaningItem) =>
  screen.getByRole("button", { name: COPY.doneName(item.title) });

beforeEach(() => {
  for (const action of [
    addCleaning,
    completeCleaning,
    reopenCleaning,
    removeCleaning,
    restoreCleaning,
  ]) {
    vi.mocked(action).mockReset();
  }
});

describe("what it shows", () => {
  test("by zone: a section per zone with how many come up this week, and each row's frequency and when", () => {
    render(<Screen />);
    const bano = document.querySelector<HTMLElement>('[data-household-zone="baño"]')!;
    expect(within(bano).getByRole("heading", { name: /Baño/ })).toBeVisible();
    expect(within(bano).getByText(COPY.dueThisWeek(2))).toBeVisible();
    // Soonest first: the one that is waiting since two days ago, then today's.
    const titles = within(bano)
      .getAllByRole("link")
      .map((link) => link.textContent);
    expect(titles).toEqual(["Limpiar espejo", "Limpiar inodoro"]);
    expect(within(rowOf(A)!).getByText("Cada semana, lunes · toca hoy")).toBeVisible();
    expect(within(rowOf(B)!).getByText(/Cada 2 semanas · desde el /)).toBeVisible();
    expect(within(rowOf(C)!).getByText(/toca mañana/)).toBeVisible();
    expect(screen.getByRole("link", { name: COPY.openTask(A.title) })).toHaveAttribute(
      "href",
      `/tasks/${A.id}`,
    );
  });

  test("each zone section is named by its own heading, even when the zone has spaces or a slash", () => {
    const sala = { ...C, id: "00000000-0000-4000-8000-0000000000d1", zone: "dormitorio principal" };
    render(<Screen items={[A, C, sala]} />);
    const sections = document.querySelectorAll<HTMLElement>("[data-household-zone]");
    expect(sections).toHaveLength(3);
    for (const section of sections) {
      const ids = section.getAttribute("aria-labelledby")!.split(" ");
      expect(ids).toHaveLength(1);
      expect(document.querySelectorAll(`[id="${ids[0]}"]`)).toHaveLength(1);
    }
    expect(screen.getByRole("region", { name: /^Dormitorio principal/ })).toBeVisible();
    expect(screen.getByRole("region", { name: /^Sala\/comedor/ })).toBeVisible();
  });

  test("by day: «De antes», then the days of the week; no word of guilt", () => {
    render(<Screen group="dia" />);
    expect(screen.getByRole("heading", { name: "De antes" })).toBeVisible();
    expect(document.body.textContent?.toLowerCase()).not.toContain("atrasad");
    expect(screen.getByRole("link", { name: COPY.groups.dia })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByRole("link", { name: COPY.groups.zona })).toHaveAttribute(
      "href",
      "/household",
    );
  });

  test("nothing to clean says so and still offers to add", () => {
    render(<Screen items={[]} />);
    expect(screen.getByText(COPY.emptyTitle)).toBeVisible();
    expect(screen.getByRole("button", { name: COPY.add })).toBeVisible();
  });
});

describe("«Hecho»", () => {
  test("the row leaves at once, the notice says when the next one comes up and offers «Deshacer»", async () => {
    vi.mocked(completeCleaning).mockResolvedValue(
      ok({ id: A.id, title: A.title, nextDueDate: day(7) }),
    );
    render(<Screen />);
    await userEvent.click(doneKey(A));
    expect(completeCleaning).toHaveBeenCalledWith({ id: A.id });
    expect(rowOf(A)).toBeNull();
    expect(await screen.findByText(/está hecha\. La siguiente toca el /)).toBeVisible();
    expect(screen.getByRole("button", { name: COPY.undo })).toBeVisible();
    // Focus lands on a key of the row that is left in that zone, not on <body>.
    expect(doneKey(B)).toHaveFocus();
  });

  test("«Deshacer» reopens exactly that task and the row comes back", async () => {
    vi.mocked(completeCleaning).mockResolvedValue(
      ok({ id: A.id, title: A.title, nextDueDate: null }),
    );
    vi.mocked(reopenCleaning).mockResolvedValue(ok({ id: A.id }));
    render(<Screen />);
    await userEvent.click(doneKey(A));
    await userEvent.click(await screen.findByRole("button", { name: COPY.undo }));
    expect(reopenCleaning).toHaveBeenCalledWith({ id: A.id });
    await waitFor(() => expect(rowOf(A)).not.toBeNull());
  });

  test("a refusal brings the row back and says it was not saved", async () => {
    vi.mocked(completeCleaning).mockResolvedValue(fail("No se pudo guardar."));
    render(<Screen />);
    await userEvent.click(doneKey(A));
    expect(await screen.findByText(COPY.notSavedTitle)).toBeVisible();
    expect(rowOf(A)).not.toBeNull();
    // Focus is back on the row that was refused, not left on its neighbor.
    await waitFor(() => expect(doneKey(A)).toHaveFocus());
  });

  test("a second press on a row that is saving does nothing", async () => {
    let finish!: (value: ReturnType<typeof ok>) => void;
    vi.mocked(completeCleaning).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve as typeof finish;
      }),
    );
    render(<Screen items={[A]} />);
    const key = doneKey(A);
    await userEvent.click(key);
    await userEvent.click(key);
    expect(completeCleaning).toHaveBeenCalledTimes(1);
    finish(ok({ id: A.id, title: A.title, nextDueDate: null }));
    await screen.findByText(COPY.doneNoNext(A.title));
  });
});

describe("«Quitar»", () => {
  test("removes the task and «Deshacer» restores that task", async () => {
    vi.mocked(removeCleaning).mockResolvedValue(ok({ id: C.id, title: C.title }));
    vi.mocked(restoreCleaning).mockResolvedValue(ok({ id: C.id }));
    render(<Screen />);
    await userEvent.click(screen.getByRole("button", { name: COPY.removeName(C.title) }));
    expect(removeCleaning).toHaveBeenCalledWith({ id: C.id });
    expect(rowOf(C)).toBeNull();
    await userEvent.click(await screen.findByRole("button", { name: COPY.undo }));
    expect(restoreCleaning).toHaveBeenCalledWith({ id: C.id });
    await waitFor(() => expect(rowOf(C)).not.toBeNull());
  });

  test("with no row left, focus goes to «Añadir limpieza»", async () => {
    vi.mocked(removeCleaning).mockResolvedValue(ok({ id: C.id, title: C.title }));
    render(<Screen items={[C]} />);
    await userEvent.click(screen.getByRole("button", { name: COPY.removeName(C.title) }));
    await screen.findByText(COPY.removed(C.title));
    expect(screen.getByRole("button", { name: COPY.add })).toHaveFocus();
  });
});

describe("«Añadir limpieza»", () => {
  async function openSheet() {
    render(<Screen items={[]} />);
    await userEvent.click(screen.getByRole("button", { name: COPY.add }));
    return screen.findByRole("dialog");
  }

  test("refuses an empty form with an error on the first field and focuses it", async () => {
    const dialog = await openSheet();
    await userEvent.click(within(dialog).getByRole("button", { name: COPY.submit }));
    expect(await within(dialog).findByText("Escribe qué hay que limpiar.")).toBeVisible();
    expect(within(dialog).getByLabelText(COPY.titleLabel)).toHaveFocus();
    expect(addCleaning).not.toHaveBeenCalled();
  });

  test("weekly asks for a weekday", async () => {
    const dialog = await openSheet();
    await userEvent.type(within(dialog).getByLabelText(COPY.titleLabel), "Trapear");
    await userEvent.type(within(dialog).getByLabelText(COPY.zoneLabel), "Sala/Comedor");
    await userEvent.click(within(dialog).getByRole("button", { name: COPY.submit }));
    expect(await within(dialog).findByText("Elige al menos un día.")).toBeVisible();
    expect(addCleaning).not.toHaveBeenCalled();
  });

  test("saves a valid cleaning, closes and announces it", async () => {
    vi.mocked(addCleaning).mockResolvedValue(
      ok({ ...C, title: "Trapear", frequency: "Cada semana, lunes" }),
    );
    const dialog = await openSheet();
    await userEvent.type(within(dialog).getByLabelText(COPY.titleLabel), "  Trapear ");
    await userEvent.type(within(dialog).getByLabelText(COPY.zoneLabel), "Sala/Comedor");
    await userEvent.click(within(dialog).getByRole("button", { name: "Lunes" }));
    await userEvent.click(within(dialog).getByRole("button", { name: COPY.submit }));
    await waitFor(() => expect(addCleaning).toHaveBeenCalledTimes(1));
    expect(addCleaning).toHaveBeenCalledWith({
      title: "  Trapear ",
      zone: "Sala/Comedor",
      frequency: "weekly",
      weekdays: [1],
      firstDate: "",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  test("a refusal from the server keeps the sheet open with the error on its field", async () => {
    vi.mocked(addCleaning).mockResolvedValue({
      ok: false,
      error: "Revisa los campos marcados.",
      fieldErrors: { firstDate: ["La primera vez no puede ser en el pasado."] },
    });
    const dialog = await openSheet();
    await userEvent.type(within(dialog).getByLabelText(COPY.titleLabel), "Barrer");
    await userEvent.type(within(dialog).getByLabelText(COPY.zoneLabel), "Balcón");
    await userEvent.selectOptions(within(dialog).getByLabelText(COPY.frequencyLabel), "daily");
    await userEvent.click(within(dialog).getByRole("button", { name: COPY.submit }));
    expect(
      await within(dialog).findByText("La primera vez no puede ser en el pasado."),
    ).toBeVisible();
    expect(screen.getByRole("dialog")).toBeVisible();
  });
});
