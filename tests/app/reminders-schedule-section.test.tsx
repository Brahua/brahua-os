import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ScheduleSection } from "@/app/(app)/settings/reminders/_components/schedule-section";
import { DEFAULT_SCHEDULE, type ReminderSchedule } from "@/modules/reminders/settings-input";

const actions = vi.hoisted(() => ({ updateReminderSettings: vi.fn() }));
vi.mock("@/modules/reminders/actions", () => actions);

const SAVED: ReminderSchedule = { ...DEFAULT_SCHEDULE };

/** A promise the test settles by hand, to look at the "saving" state. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

beforeEach(() => {
  actions.updateReminderSettings.mockReset();
  // By default the server answers with what it was sent, merged into the defaults.
  actions.updateReminderSettings.mockImplementation(async (patch: Partial<ReminderSchedule>) => ({
    ok: true,
    data: { ...SAVED, ...patch },
  }));
});

const briefingSwitch = () => screen.getByRole("switch", { name: "Resumen de la mañana" });
const paymentsSwitch = () => screen.getByRole("switch", { name: "Avisos de pagos" });
const eveningSwitch = () => screen.getByRole("switch", { name: "Repaso de la noche" });
const amountsSwitch = () => screen.getByRole("switch", { name: "Montos en Telegram" });
const briefingTime = () => screen.getByLabelText("Hora del resumen") as HTMLInputElement;
const eveningTime = () => screen.getByLabelText("Hora del repaso") as HTMLInputElement;

describe("what it shows", () => {
  test("a switch per reminder with its state, the two times and the amounts switch", () => {
    render(<ScheduleSection initial={SAVED} />);
    expect(screen.getByRole("heading", { level: 2, name: "Avisos del día" })).toBeVisible();
    expect(briefingSwitch()).toHaveAttribute("aria-checked", "true");
    expect(paymentsSwitch()).toHaveAttribute("aria-checked", "true");
    expect(eveningSwitch()).toHaveAttribute("aria-checked", "true");
    expect(amountsSwitch()).toHaveAttribute("aria-checked", "true");
    expect(briefingTime()).toHaveValue("07:30");
    expect(eveningTime()).toHaveValue("21:00");
  });

  test("shows what is saved: a switch off, other times", () => {
    render(
      <ScheduleSection
        initial={{
          ...SAVED,
          briefingEnabled: false,
          eveningTime: "22:15",
          showAmountsTelegram: false,
        }}
      />,
    );
    expect(briefingSwitch()).toHaveAttribute("aria-checked", "false");
    expect(eveningTime()).toHaveValue("22:15");
    expect(amountsSwitch()).toHaveAttribute("aria-checked", "false");
  });

  test("the time fields are native time inputs with minute precision", () => {
    render(<ScheduleSection initial={SAVED} />);
    for (const input of [briefingTime(), eveningTime()]) {
      expect(input).toHaveAttribute("type", "time");
      expect(input).toHaveAttribute("step", "60");
    }
  });

  test("every control has an accessible name and the switches say what they do", () => {
    render(<ScheduleSection initial={SAVED} />);
    expect(briefingSwitch()).toHaveAccessibleDescription(/hábitos, tareas y pagos de hoy/);
    expect(paymentsSwitch()).toHaveAccessibleDescription(/un día antes/i);
  });

  test("marks itself hydrated once its effects have run (the E2E waits for it before clicking)", () => {
    render(<ScheduleSection initial={SAVED} />);
    expect(screen.getByRole("region", { name: "Avisos del día" })).toHaveAttribute(
      "data-schedule-ready",
      "true",
    );
  });
});

describe("a switch", () => {
  test("saves right away, shows the new state and says «Guardado.»", async () => {
    render(<ScheduleSection initial={SAVED} />);
    fireEvent.click(briefingSwitch());

    expect(briefingSwitch()).toHaveAttribute("aria-checked", "false");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Guardado."));
    expect(actions.updateReminderSettings).toHaveBeenCalledWith({ briefingEnabled: false });
  });

  test("each switch sends only its own field", async () => {
    render(<ScheduleSection initial={SAVED} />);
    for (const [control, field] of [
      [paymentsSwitch, "paymentsEnabled"],
      [eveningSwitch, "eveningEnabled"],
      [amountsSwitch, "showAmountsTelegram"],
    ] as const) {
      actions.updateReminderSettings.mockClear();
      fireEvent.click(control());
      await waitFor(() =>
        expect(actions.updateReminderSettings).toHaveBeenCalledWith({ [field]: false }),
      );
      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Guardado."));
    }
  });

  test("while it saves: aria-disabled (never disabled), the focus stays, a second press is ignored", async () => {
    const pending = deferred<unknown>();
    actions.updateReminderSettings.mockReturnValue(pending.promise);
    render(<ScheduleSection initial={SAVED} />);
    const key = paymentsSwitch();
    key.focus();

    fireEvent.click(key);
    expect(key).toHaveAttribute("aria-disabled", "true");
    expect(key).not.toBeDisabled();
    expect(key).toHaveFocus();
    // Every control says so while one save is in flight.
    for (const other of [briefingSwitch(), eveningSwitch(), amountsSwitch()]) {
      expect(other).toHaveAttribute("aria-disabled", "true");
      expect(other).not.toBeDisabled();
    }
    fireEvent.click(key);
    fireEvent.click(briefingSwitch());
    expect(actions.updateReminderSettings).toHaveBeenCalledTimes(1);

    await act(async () =>
      pending.resolve({ ok: true, data: { ...SAVED, paymentsEnabled: false } }),
    );
    expect(key).toHaveAttribute("aria-disabled", "false");
    expect(key).toHaveFocus();
    expect(key).toHaveAttribute("aria-checked", "false");
  });

  test("a refusal puts the switch back, says why in an alert and keeps the focus", async () => {
    actions.updateReminderSettings.mockResolvedValue({
      ok: false,
      error: "Tu sesión terminó. Vuelve a entrar para guardar los cambios.",
    });
    render(<ScheduleSection initial={SAVED} />);
    const key = eveningSwitch();
    key.focus();
    fireEvent.click(key);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Tu sesión terminó"));
    expect(key).toHaveAttribute("aria-checked", "true");
    expect(key).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  test("an unexpected failure gets a calm message and puts the switch back", async () => {
    actions.updateReminderSettings.mockRejectedValue(new Error("network"));
    render(<ScheduleSection initial={SAVED} />);
    fireEvent.click(amountsSwitch());
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("No se pudo guardar"));
    expect(amountsSwitch()).toHaveAttribute("aria-checked", "true");
  });

  test("the focus goes back to the switch if the save left it nowhere", async () => {
    const pending = deferred<unknown>();
    actions.updateReminderSettings.mockReturnValue(pending.promise);
    render(<ScheduleSection initial={SAVED} />);
    const key = briefingSwitch();
    key.focus();
    fireEvent.click(key);
    // Something steals the focus while saving (a re-render, a blur).
    (document.activeElement as HTMLElement).blur();
    expect(document.body).toHaveFocus();

    await act(async () =>
      pending.resolve({ ok: true, data: { ...SAVED, briefingEnabled: false } }),
    );
    expect(key).toHaveFocus();
  });
});

describe("a time", () => {
  test("saves when the field is left, not on every keystroke", async () => {
    render(<ScheduleSection initial={SAVED} />);
    const input = briefingTime();
    input.focus();
    fireEvent.change(input, { target: { value: "08:00" } });
    expect(actions.updateReminderSettings).not.toHaveBeenCalled();

    fireEvent.blur(input);
    await waitFor(() =>
      expect(actions.updateReminderSettings).toHaveBeenCalledWith({ briefingTime: "08:00" }),
    );
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Guardado."));
    expect(briefingTime()).toHaveValue("08:00");
  });

  test("Intro saves it too", async () => {
    render(<ScheduleSection initial={SAVED} />);
    fireEvent.change(eveningTime(), { target: { value: "21:30" } });
    fireEvent.keyDown(eveningTime(), { key: "Enter" });
    await waitFor(() =>
      expect(actions.updateReminderSettings).toHaveBeenCalledWith({ eveningTime: "21:30" }),
    );
  });

  test("an unchanged time sends nothing", () => {
    render(<ScheduleSection initial={SAVED} />);
    fireEvent.blur(briefingTime());
    expect(actions.updateReminderSettings).not.toHaveBeenCalled();
  });

  test("an emptied time is not sent: it says so and goes back to the saved one", async () => {
    render(<ScheduleSection initial={SAVED} />);
    fireEvent.change(briefingTime(), { target: { value: "" } });
    fireEvent.blur(briefingTime());

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Escribe una hora válida"),
    );
    expect(actions.updateReminderSettings).not.toHaveBeenCalled();
    expect(briefingTime()).toHaveValue("07:30");
  });

  test("a refused time goes back to the saved one", async () => {
    actions.updateReminderSettings.mockResolvedValue({ ok: false, error: "No se pudo guardar." });
    render(<ScheduleSection initial={SAVED} />);
    fireEvent.change(briefingTime(), { target: { value: "09:00" } });
    fireEvent.blur(briefingTime());
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("No se pudo guardar"));
    expect(briefingTime()).toHaveValue("07:30");
  });

  test("while saving, the fields are read-only with aria-disabled, never disabled", async () => {
    const pending = deferred<unknown>();
    actions.updateReminderSettings.mockReturnValue(pending.promise);
    render(<ScheduleSection initial={SAVED} />);
    fireEvent.click(briefingSwitch());
    for (const input of [briefingTime(), eveningTime()]) {
      expect(input).toHaveAttribute("aria-disabled", "true");
      expect(input).toHaveAttribute("readonly");
      expect(input).not.toBeDisabled();
    }
    await act(async () =>
      pending.resolve({ ok: true, data: { ...SAVED, briefingEnabled: false } }),
    );
    expect(briefingTime()).not.toHaveAttribute("readonly");
  });

  test("a time left while another save is in flight is saved right after it", async () => {
    const pending = deferred<unknown>();
    actions.updateReminderSettings.mockReturnValueOnce(pending.promise);
    render(<ScheduleSection initial={SAVED} />);
    fireEvent.click(paymentsSwitch());

    // The owner types a time and leaves the field while the first save is still going.
    fireEvent.change(eveningTime(), { target: { value: "20:45" } });
    fireEvent.blur(eveningTime());
    expect(actions.updateReminderSettings).toHaveBeenCalledTimes(1);

    await act(async () =>
      pending.resolve({ ok: true, data: { ...SAVED, paymentsEnabled: false } }),
    );
    await waitFor(() => expect(actions.updateReminderSettings).toHaveBeenCalledTimes(2));
    expect(actions.updateReminderSettings).toHaveBeenLastCalledWith({ eveningTime: "20:45" });
    // What was typed was not overwritten by the first save's answer.
    expect(eveningTime()).toHaveValue("20:45");
  });
});

describe("leaving the page", () => {
  test("a save that answers after unmounting touches nothing (no state update, no error)", async () => {
    const pending = deferred<unknown>();
    actions.updateReminderSettings.mockReturnValue(pending.promise);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = render(<ScheduleSection initial={SAVED} />);
    fireEvent.click(briefingSwitch());
    unmount();
    await act(async () =>
      pending.resolve({ ok: true, data: { ...SAVED, briefingEnabled: false } }),
    );
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
