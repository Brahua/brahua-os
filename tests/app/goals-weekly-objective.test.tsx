// G3 of `goals`: "Esta semana" on /goals (the weekly objective, edited inline), against a fake
// server. The Server Actions are mocked; the screen's queue, notices and the optimistic text are
// the real ones. Focus is asserted where the keyboard user needs it: into the field when it opens,
// back to its key when it closes.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ok, type ActionResult } from "@/lib/action-result";
import { ownerDateKey } from "@/lib/time";
import {
  clearWeeklyObjective,
  setWeeklyObjective,
  undoWeeklyObjective,
} from "@/modules/goals/actions";
import { GoalsScreen } from "@/modules/goals/components/goals-screen";
import { WeeklyObjective } from "@/modules/goals/components/weekly-objective";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => router,
}));
vi.mock("@/modules/goals/actions", () => ({
  setWeeklyObjective: vi.fn(),
  clearWeeklyObjective: vi.fn(),
  undoWeeklyObjective: vi.fn(),
}));

/** Monday 2026-10-12, 10:00 in Lima. Only Date is faked (timers stay real for userEvent). */
const NOW = new Date("2026-10-12T15:00:00.000Z");
const TODAY = ownerDateKey(NOW);
const WEEK = "2026-10-12";

function Screen({ objective }: { objective: string | null }) {
  return (
    <GoalsScreen today={TODAY} areas={[]}>
      <WeeklyObjective weekStart={WEEK} objective={objective} />
    </GoalsScreen>
  );
}

/** Calls wait until the test answers them (every one must settle before the test ends). */
const pending: ((result: ActionResult<never>) => void)[] = [];
async function answer(result: ActionResult<unknown>) {
  const call = pending.shift();
  if (!call) throw new Error("No pending call");
  await act(async () => call(result as ActionResult<never>));
}
const wait = () =>
  new Promise<ActionResult<never>>((resolve) => {
    pending.push(resolve);
  });

const notices = () => screen.getByRole("region", { name: "Avisos de metas" });
const field = () => screen.getByRole("textbox", { name: "Objetivo de la semana" });
const SET = { name: "Fijar objetivo de la semana" };
const EDIT = { name: "Editar objetivo de la semana" };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  pending.length = 0;
  vi.mocked(setWeeklyObjective).mockImplementation(wait);
  vi.mocked(clearWeeklyObjective).mockImplementation(wait);
  vi.mocked(undoWeeklyObjective).mockImplementation(wait);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("a week without an objective", () => {
  test("says so, offers 'Fijar objetivo de la semana' and names the week", () => {
    render(<Screen objective={null} />);
    expect(screen.getByRole("heading", { level: 2, name: "Esta semana" })).toBeInTheDocument();
    expect(screen.getByText(/^Del 12 oct\. 2026 al 18 oct\. 2026$/)).toBeInTheDocument();
    expect(screen.getByRole("button", SET)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  test("one tap opens the field with focus; Enter saves, optimistically, and focus returns", async () => {
    const user = userEvent.setup();
    render(<Screen objective={null} />);
    await user.click(screen.getByRole("button", SET));
    expect(field()).toHaveFocus();

    await user.type(field(), "  Cerrar   el informe {Enter}");
    expect(setWeeklyObjective).toHaveBeenCalledTimes(1);
    expect(setWeeklyObjective).toHaveBeenCalledWith({ weekStart: WEEK, text: "Cerrar el informe" });
    // Optimistic: the text shows before the server answers, the field is gone, focus is back.
    expect(screen.getByText("Cerrar el informe")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", EDIT)).toHaveFocus();

    await answer(ok({ weekStart: WEEK, text: "Cerrar el informe", previous: null }));
    expect(
      within(notices()).getByText("Objetivo fijado: «Cerrar el informe»."),
    ).toBeInTheDocument();
  });

  test("Escape cancels without saving and focus returns to the key", async () => {
    const user = userEvent.setup();
    render(<Screen objective={null} />);
    await user.click(screen.getByRole("button", SET));
    await user.type(field(), "Algo");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(setWeeklyObjective).not.toHaveBeenCalled();
    expect(screen.getByRole("button", SET)).toHaveFocus();
    expect(screen.queryByText("Algo")).not.toBeInTheDocument();
  });

  test("Enter on an empty field saves nothing and keeps the week empty", async () => {
    const user = userEvent.setup();
    render(<Screen objective={null} />);
    await user.click(screen.getByRole("button", SET));
    await user.type(field(), "   {Enter}");
    expect(setWeeklyObjective).not.toHaveBeenCalled();
    expect(clearWeeklyObjective).not.toHaveBeenCalled();
    expect(screen.getByRole("button", SET)).toHaveFocus();
  });

  test("a text over 140 characters is refused on the field, without a call", async () => {
    const user = userEvent.setup();
    render(<Screen objective={null} />);
    await user.click(screen.getByRole("button", SET));
    await user.click(field());
    await user.paste("a".repeat(141));
    await user.keyboard("{Enter}");
    expect(setWeeklyObjective).not.toHaveBeenCalled();
    expect(screen.getByText("Usa 140 caracteres como máximo.")).toBeInTheDocument();
    expect(field()).toHaveAttribute("aria-invalid", "true");
    // Still editing: typing clears the error.
    await user.type(field(), "x");
    expect(screen.queryByText("Usa 140 caracteres como máximo.")).not.toBeInTheDocument();
  });

  test("'Deshacer' of the first objective asks for the absence, carrying what the set left", async () => {
    const user = userEvent.setup();
    render(<Screen objective={null} />);
    await user.click(screen.getByRole("button", SET));
    await user.type(field(), "Cerrar el informe{Enter}");
    await answer(ok({ weekStart: WEEK, text: "Cerrar el informe", previous: null }));

    await user.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    expect(undoWeeklyObjective).toHaveBeenCalledWith({
      weekStart: WEEK,
      previous: null,
      applied: "Cerrar el informe",
    });
    // Optimistic: the week is empty again at once.
    expect(screen.queryByText("Cerrar el informe")).not.toBeInTheDocument();
    expect(screen.getByRole("button", SET)).toBeInTheDocument();
    await answer(ok({ weekStart: WEEK, text: null, restored: true }));
  });
});

describe("a week with an objective", () => {
  test("shows it with one 'Editar' key; the field opens with the text selected", async () => {
    const user = userEvent.setup();
    render(<Screen objective="Cerrar el informe" />);
    expect(screen.getByText("Cerrar el informe")).toBeInTheDocument();
    await user.click(screen.getByRole("button", EDIT));
    expect(field()).toHaveFocus();
    expect(field()).toHaveValue("Cerrar el informe");
  });

  test("replacing it and 'Deshacer' put back exactly the text it replaced", async () => {
    const user = userEvent.setup();
    render(<Screen objective="Cerrar el informe" />);
    await user.click(screen.getByRole("button", EDIT));
    await user.keyboard("Salir a correr{Enter}");
    expect(setWeeklyObjective).toHaveBeenCalledWith({ weekStart: WEEK, text: "Salir a correr" });
    await answer(ok({ weekStart: WEEK, text: "Salir a correr", previous: "Cerrar el informe" }));

    await user.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    expect(undoWeeklyObjective).toHaveBeenCalledWith({
      weekStart: WEEK,
      previous: "Cerrar el informe",
      applied: "Salir a correr",
    });
    expect(screen.getByText("Cerrar el informe")).toBeInTheDocument();
    await answer(ok({ weekStart: WEEK, text: "Cerrar el informe", restored: true }));
    await waitFor(() =>
      expect(document.querySelector("[data-goals-announcer]")).toHaveTextContent(
        "El objetivo de la semana volvió a como estaba.",
      ),
    );
  });

  test("saving the same text again does nothing", async () => {
    const user = userEvent.setup();
    render(<Screen objective="Cerrar el informe" />);
    await user.click(screen.getByRole("button", EDIT));
    await user.keyboard("{Enter}");
    expect(setWeeklyObjective).not.toHaveBeenCalled();
    expect(screen.getByRole("button", EDIT)).toHaveFocus();
  });

  test("emptying the field clears the week, and 'Deshacer' carries the text it removed", async () => {
    const user = userEvent.setup();
    render(<Screen objective="Cerrar el informe" />);
    await user.click(screen.getByRole("button", EDIT));
    await user.clear(field());
    await user.keyboard("{Enter}");
    expect(clearWeeklyObjective).toHaveBeenCalledWith({ weekStart: WEEK });
    expect(screen.getByRole("button", SET)).toHaveFocus();
    await answer(ok({ weekStart: WEEK, text: null, previous: "Cerrar el informe" }));
    expect(within(notices()).getByText("Objetivo de la semana quitado.")).toBeInTheDocument();

    await user.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    expect(undoWeeklyObjective).toHaveBeenCalledWith({
      weekStart: WEEK,
      previous: "Cerrar el informe",
      applied: null,
    });
    expect(screen.getByText("Cerrar el informe")).toBeInTheDocument();
    await answer(ok({ weekStart: WEEK, text: "Cerrar el informe", restored: true }));
  });

  test("'Quitar' inside the field clears it too", async () => {
    const user = userEvent.setup();
    render(<Screen objective="Cerrar el informe" />);
    await user.click(screen.getByRole("button", EDIT));
    await user.click(screen.getByRole("button", { name: "Quitar" }));
    expect(clearWeeklyObjective).toHaveBeenCalledWith({ weekStart: WEEK });
    await answer(ok({ weekStart: WEEK, text: null, previous: "Cerrar el informe" }));
  });

  test("a refused save rolls back, says so, and reopens the field with what was typed", async () => {
    const user = userEvent.setup();
    render(<Screen objective="Cerrar el informe" />);
    await user.click(screen.getByRole("button", EDIT));
    await user.keyboard("Salir a correr{Enter}");
    await answer({ ok: false, error: "No se pudo guardar. Revisa tu conexión." });
    // The rolled-back state and the reopened field are asserted inside waitFor (the notice can
    // render before the optimistic value rolls back).
    await waitFor(() => expect(field()).toHaveValue("Salir a correr"));
    expect(
      within(notices()).getByText(/No se pudo guardar el objetivo de la semana\./),
    ).toBeInTheDocument();
    expect(field()).toHaveFocus();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.getByText("Cerrar el informe")).toBeInTheDocument());
    expect(screen.queryByText("Salir a correr")).not.toBeInTheDocument();
  });

  test("an undo that finds the week changed says so and leaves it as it is", async () => {
    const user = userEvent.setup();
    render(<Screen objective="Cerrar el informe" />);
    await user.click(screen.getByRole("button", EDIT));
    await user.keyboard("Salir a correr{Enter}");
    await answer(ok({ weekStart: WEEK, text: "Salir a correr", previous: "Cerrar el informe" }));
    await user.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    await answer(ok({ weekStart: WEEK, text: "Otra cosa", restored: false }));
    expect(
      within(notices()).getByText(
        "El objetivo de esta semana cambió mientras tanto: lo dejé como está.",
      ),
    ).toBeInTheDocument();
  });

  test("the key is never disabled (aria-disabled is for pending), and the field has a visible label", async () => {
    const user = userEvent.setup();
    render(<Screen objective="Cerrar el informe" />);
    expect(screen.getByRole("button", EDIT)).not.toBeDisabled();
    await user.click(screen.getByRole("button", EDIT));
    expect(screen.getByLabelText("Objetivo de la semana")).toBe(field());
    expect(screen.getByRole("button", { name: "Guardar" })).not.toBeDisabled();
  });
});
