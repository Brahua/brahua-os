// R4 of `reminders` in the habit form: the optional «Hora del aviso» (a native time input with
// «Quitar hora») and «Franja» (Mañana / Tarde / Noche / Sin franja), creating and editing. The
// form is rendered alone with the actions mocked; the pads grouped by franja are in
// habits-dayparts.test.tsx.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ok } from "@/lib/action-result";
import { createHabit } from "@/modules/habits/actions";
import { HabitFormSheet } from "@/modules/habits/components/habit-form-sheet";
import type { HabitItem } from "@/modules/habits/habit-input";
import { updateHabit } from "@/modules/habits/organize-actions";
import { REMINDER_ERRORS } from "@/modules/habits/reminder-copy";

vi.mock("@/modules/habits/actions", () => ({
  createHabit: vi.fn(),
  deleteHabit: vi.fn(),
  restoreHabit: vi.fn(),
}));
vi.mock("@/modules/habits/organize-actions", () => ({
  updateHabit: vi.fn(),
  reorderHabits: vi.fn(),
  archiveHabit: vi.fn(),
  unarchiveHabit: vi.fn(),
}));

const TODAY = "2026-10-02";

function habit(values: Partial<HabitItem> = {}): HabitItem {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Leer",
    kind: "build",
    measure: "check",
    goal: 1,
    unit: null,
    step: 1,
    frequency: "daily",
    weeklyTarget: null,
    weekdays: null,
    startDate: "2026-09-01",
    area: null,
    quantity: 0,
    target: 1,
    hasLogs: false,
    weekDoneBefore: 0,
    weekAvailable: 7,
    streak: { unit: "days", done: 0, notDone: 0 },
    pause: null,
    recentLogs: [],
    recentPaused: [],
    identity: null,
    cue: null,
    ...values,
  };
}

function renderForm(editing: HabitItem | null = null) {
  const onCreated = vi.fn();
  render(
    <HabitFormSheet
      open
      onOpenChange={() => {}}
      areas={[]}
      returnFocusRef={{ current: null }}
      habit={editing}
      today={TODAY}
      onCreated={onCreated}
    />,
  );
  return { onCreated };
}

const dialogOf = () => screen.findByRole("dialog");
const timeInput = (dialog: HTMLElement) =>
  within(dialog).getByLabelText("Hora del aviso") as HTMLInputElement;
const clearKey = (dialog: HTMLElement) =>
  within(dialog).getByRole("button", { name: "Quitar hora" });
const dayparts = (dialog: HTMLElement) =>
  within(dialog).getByRole("radiogroup", { name: "Franja" });

beforeEach(() => {
  window.matchMedia = vi.fn((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  vi.mocked(createHabit).mockReset();
  vi.mocked(updateHabit).mockReset();
});

describe("creating", () => {
  test("both fields are optional: empty, nothing about them is sent", async () => {
    vi.mocked(createHabit).mockResolvedValue(ok(habit()));
    const user = userEvent.setup();
    renderForm();
    const dialog = await dialogOf();
    expect(timeInput(dialog)).toHaveValue("");
    expect(within(dayparts(dialog)).getByRole("radio", { name: "Sin franja" })).toBeChecked();
    await user.type(within(dialog).getByRole("textbox", { name: "Nombre" }), "Leer");
    await user.click(within(dialog).getByRole("button", { name: "Crear hábito" }));
    const sent = vi.mocked(createHabit).mock.calls[0][0] as Record<string, unknown>;
    expect(sent.reminderTime).toBeUndefined();
    expect(sent.daypart).toBeUndefined();
  });

  test("the time is a native 48 px time input with minute precision, described by its help", async () => {
    renderForm();
    const dialog = await dialogOf();
    const input = timeInput(dialog);
    expect(input).toHaveAttribute("type", "time");
    expect(input).toHaveAttribute("step", "60");
    expect(input).toHaveClass("bo-field__control");
    expect(input).toHaveAccessibleDescription(/aún no lo hiciste/);
  });

  test("a time and a franja are sent as HH:MM and the English key", async () => {
    vi.mocked(createHabit).mockResolvedValue(ok(habit()));
    const user = userEvent.setup();
    renderForm();
    const dialog = await dialogOf();
    await user.type(within(dialog).getByRole("textbox", { name: "Nombre" }), "Leer");
    await user.type(timeInput(dialog), "22:00");
    await user.click(within(dayparts(dialog)).getByRole("radio", { name: "Noche" }));
    await user.click(within(dialog).getByRole("button", { name: "Crear hábito" }));
    expect(createHabit).toHaveBeenCalledWith(
      expect.objectContaining({ reminderTime: "22:00", daypart: "evening" }),
    );
  });

  test("the franjas are Mañana, Tarde, Noche and Sin franja", async () => {
    renderForm();
    const dialog = await dialogOf();
    expect(
      within(dayparts(dialog))
        .getAllByRole("radio")
        .map((radio) => radio.getAttribute("aria-label") ?? radio.textContent),
    ).toEqual(["Mañana", "Tarde", "Noche", "Sin franja"]);
  });

  test("«Quitar hora» is aria-disabled while empty (never unmounted), clears the time and keeps the focus on the field", async () => {
    const user = userEvent.setup();
    renderForm();
    const dialog = await dialogOf();
    expect(clearKey(dialog)).toHaveAttribute("aria-disabled", "true");
    await user.type(timeInput(dialog), "0930");
    expect(timeInput(dialog)).toHaveValue("09:30");
    expect(clearKey(dialog)).not.toHaveAttribute("aria-disabled");
    await user.click(clearKey(dialog));
    expect(timeInput(dialog)).toHaveValue("");
    expect(timeInput(dialog)).toHaveFocus();
    expect(clearKey(dialog)).toHaveAttribute("aria-disabled", "true");
  });

  test("a half-edited time keeps «Quitar hora» working and blocks saving on the field", async () => {
    vi.mocked(createHabit).mockResolvedValue(ok(habit()));
    const user = userEvent.setup();
    renderForm();
    const dialog = await dialogOf();
    await user.type(within(dialog).getByRole("textbox", { name: "Nombre" }), "Leer");
    const input = timeInput(dialog);
    await user.type(input, "0930");
    // One segment emptied: the input reads "" but it is not empty (validity.badInput).
    Object.defineProperty(input, "validity", { value: { badInput: true }, configurable: true });
    fireEvent.change(input, { target: { value: "" } });
    expect(clearKey(dialog)).not.toHaveAttribute("aria-disabled");

    await user.click(within(dialog).getByRole("button", { name: "Crear hábito" }));
    expect(createHabit).not.toHaveBeenCalled();
    await waitFor(() => expect(input).toHaveAccessibleDescription(REMINDER_ERRORS.timeInvalid));
    await waitFor(() => expect(input).toHaveFocus());

    // The key clears it for good: now it saves with no time.
    await user.click(clearKey(dialog));
    expect(clearKey(dialog)).toHaveAttribute("aria-disabled", "true");
    await user.click(within(dialog).getByRole("button", { name: "Crear hábito" }));
    const sent = vi.mocked(createHabit).mock.calls[0][0] as Record<string, unknown>;
    expect(sent.reminderTime).toBeUndefined();
  });

  test("a half-edited time on edit is refused too, instead of keeping the saved one", async () => {
    const user = userEvent.setup();
    renderForm(habit({ reminderTime: "21:30" }));
    const dialog = await dialogOf();
    const input = timeInput(dialog);
    Object.defineProperty(input, "validity", { value: { badInput: true }, configurable: true });
    fireEvent.change(input, { target: { value: "" } });
    await user.click(within(dialog).getByRole("button", { name: "Guardar cambios" }));
    expect(updateHabit).not.toHaveBeenCalled();
    await waitFor(() => expect(input).toHaveAccessibleDescription(REMINDER_ERRORS.timeInvalid));
  });

  test("a habit to avoid has no time field (and sends none), but keeps the franja", async () => {
    vi.mocked(createHabit).mockResolvedValue(ok(habit({ kind: "avoid" })));
    const user = userEvent.setup();
    renderForm();
    const dialog = await dialogOf();
    await user.type(within(dialog).getByRole("textbox", { name: "Nombre" }), "No fumar");
    await user.type(timeInput(dialog), "2200");
    await user.click(within(dialog).getByRole("radio", { name: "A evitar" }));
    expect(within(dialog).queryByLabelText("Hora del aviso")).toBeNull();
    await user.click(within(dayparts(dialog)).getByRole("radio", { name: "Mañana" }));
    await user.click(within(dialog).getByRole("button", { name: "Crear hábito" }));
    const sent = vi.mocked(createHabit).mock.calls[0][0] as Record<string, unknown>;
    expect(sent.reminderTime).toBeUndefined();
    expect(sent.daypart).toBe("morning");
  });

  test("back to «A cumplir» the time field returns (positive control of the one above)", async () => {
    const user = userEvent.setup();
    renderForm();
    const dialog = await dialogOf();
    await user.click(within(dialog).getByRole("radio", { name: "A evitar" }));
    expect(within(dialog).queryByLabelText("Hora del aviso")).toBeNull();
    await user.click(within(dialog).getByRole("radio", { name: "A cumplir" }));
    expect(timeInput(dialog)).toBeInTheDocument();
  });

  test("a refusal on the time shows on the field and takes the focus", async () => {
    vi.mocked(createHabit).mockResolvedValue({
      ok: false,
      error: "Revisa los campos.",
      fieldErrors: { reminderTime: [REMINDER_ERRORS.timeAvoid] },
    });
    const user = userEvent.setup();
    renderForm();
    const dialog = await dialogOf();
    await user.type(within(dialog).getByRole("textbox", { name: "Nombre" }), "Leer");
    await user.type(timeInput(dialog), "2200");
    await user.click(within(dialog).getByRole("button", { name: "Crear hábito" }));
    await waitFor(() => expect(timeInput(dialog)).toHaveAccessibleDescription(/a evitar/));
    await waitFor(() => expect(timeInput(dialog)).toHaveFocus());
  });
});

describe("editing", () => {
  test("starts from the habit's time and franja", async () => {
    renderForm(habit({ reminderTime: "21:30", daypart: "afternoon" }));
    const dialog = await dialogOf();
    expect(timeInput(dialog)).toHaveValue("21:30");
    expect(within(dayparts(dialog)).getByRole("radio", { name: "Tarde" })).toBeChecked();
  });

  test("an unchanged habit sends neither field", async () => {
    vi.mocked(updateHabit).mockResolvedValue(ok(habit()));
    const user = userEvent.setup();
    renderForm(habit({ reminderTime: "21:30", daypart: "afternoon" }));
    const dialog = await dialogOf();
    await user.click(within(dialog).getByRole("button", { name: "Guardar cambios" }));
    const sent = vi.mocked(updateHabit).mock.calls[0][0] as Record<string, unknown>;
    expect(sent.reminderTime).toBeUndefined();
    expect(sent.daypart).toBeUndefined();
  });

  test("changing only the franja sends only the franja", async () => {
    vi.mocked(updateHabit).mockResolvedValue(ok(habit()));
    const user = userEvent.setup();
    renderForm(habit({ reminderTime: "21:30", daypart: "afternoon" }));
    const dialog = await dialogOf();
    await user.click(within(dayparts(dialog)).getByRole("radio", { name: "Mañana" }));
    await user.click(within(dialog).getByRole("button", { name: "Guardar cambios" }));
    const sent = vi.mocked(updateHabit).mock.calls[0][0] as Record<string, unknown>;
    expect(sent.daypart).toBe("morning");
    expect(sent.reminderTime).toBeUndefined();
  });

  test("«Quitar hora» and «Sin franja» clear both (null reaches the action)", async () => {
    vi.mocked(updateHabit).mockResolvedValue(ok(habit()));
    const user = userEvent.setup();
    renderForm(habit({ reminderTime: "21:30", daypart: "afternoon" }));
    const dialog = await dialogOf();
    await user.click(clearKey(dialog));
    await user.click(within(dayparts(dialog)).getByRole("radio", { name: "Sin franja" }));
    await user.click(within(dialog).getByRole("button", { name: "Guardar cambios" }));
    expect(updateHabit).toHaveBeenCalledWith(
      expect.objectContaining({ reminderTime: null, daypart: null }),
    );
  });

  test("editing a habit to avoid offers the franja but not the time", async () => {
    renderForm(habit({ kind: "avoid", daypart: "evening" }));
    const dialog = await dialogOf();
    expect(within(dialog).queryByLabelText("Hora del aviso")).toBeNull();
    expect(within(dayparts(dialog)).getByRole("radio", { name: "Noche" })).toBeChecked();
  });
});
