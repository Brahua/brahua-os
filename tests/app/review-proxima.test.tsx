// `weekly-review` W3: step 4 · Próxima semana as the owner uses it, against a fake server. The
// Server Action is mocked; the screen's services are the real ones. What is typed survives a
// failure, the key is never `disabled` while saving, and success goes to the closing screen.
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { fail, ok } from "@/lib/action-result";
import { ScreenServicesProvider } from "@/modules/core/components/screen-services";
import { closeWeek } from "@/modules/weekly-review/actions";
import { StepProxima } from "@/modules/weekly-review/components/step-proxima";
import { REVIEW_COPY } from "@/modules/weekly-review/review-copy";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => router,
}));
vi.mock("@/modules/weekly-review/actions", () => ({ closeWeek: vi.fn() }));

const WEEK = "2026-10-12";

function Step(props: Partial<React.ComponentProps<typeof StepProxima>> = {}) {
  return (
    <ScreenServicesProvider label={REVIEW_COPY.noticesLabel} actionHint={REVIEW_COPY.undoHint}>
      <StepProxima
        weekStart={WEEK}
        nextRange="19 al 25 de octubre"
        objective={null}
        note={null}
        closed={false}
        {...props}
      />
    </ScreenServicesProvider>
  );
}

const objectiveField = () =>
  screen.getByRole("textbox", { name: "Objetivo de la semana del 19 al 25 de octubre" });
const noteField = () => screen.getByRole("textbox", { name: /Nota de esta semana/ });
const closeKey = (name = "Cerrar la semana") => screen.getByRole("button", { name });

beforeEach(() => {
  vi.mocked(closeWeek).mockReset();
  router.push.mockReset();
});

describe("the form", () => {
  test("has the objective of the NEXT week, the optional note and the close key", () => {
    render(<Step />);
    expect(objectiveField()).toHaveValue("");
    expect(noteField()).toHaveValue("");
    expect(closeKey()).toBeVisible();
    expect(screen.queryByText("Esta semana ya está cerrada")).not.toBeInTheDocument();
  });

  test("prefills the objective already set and the note of a closed week", () => {
    render(<Step objective="Terminar la spec" note="Aprendí a descansar" closed />);
    expect(objectiveField()).toHaveValue("Terminar la spec");
    expect(noteField()).toHaveValue("Aprendí a descansar");
    expect(screen.getByText("Esta semana ya está cerrada")).toBeVisible();
    // The same form saves again: it is not «Cerrar la semana» twice.
    expect(closeKey("Guardar cambios")).toBeVisible();
  });
});

describe("closing", () => {
  test("sends what was typed, announces and goes to the closing screen", async () => {
    vi.mocked(closeWeek).mockResolvedValue(ok({ weekStart: WEEK }));
    const user = userEvent.setup();
    render(<Step />);
    await user.type(objectiveField(), "Terminar la spec");
    await user.type(noteField(), "Aprendí a descansar");
    await user.click(closeKey());
    await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
    expect(closeWeek).toHaveBeenCalledWith({
      weekStart: WEEK,
      note: "Aprendí a descansar",
      objective: "Terminar la spec",
    });
    expect(router.push).toHaveBeenCalledWith("/review?paso=4&semana=2026-10-12&cerrada=1");
    await waitFor(() => expect(screen.getByText("Semana cerrada.")).toBeInTheDocument());
  });

  test("with nothing typed it still closes (both fields are optional)", async () => {
    vi.mocked(closeWeek).mockResolvedValue(ok({ weekStart: WEEK }));
    const user = userEvent.setup();
    render(<Step />);
    await user.click(closeKey());
    await waitFor(() => expect(router.push).toHaveBeenCalled());
    expect(closeWeek).toHaveBeenCalledWith({ weekStart: WEEK, note: "", objective: "" });
  });

  test("a second press while it saves does nothing, and the key is aria-disabled, never disabled", async () => {
    let finish!: (value: ReturnType<typeof ok<{ weekStart: string }>>) => void;
    vi.mocked(closeWeek).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<Step />);
    closeKey().focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(closeKey()).toHaveAttribute("aria-disabled", "true"));
    expect(closeKey()).not.toBeDisabled();
    expect(closeKey()).toHaveFocus();
    await user.keyboard("{Enter}");
    await user.click(closeKey());
    expect(closeWeek).toHaveBeenCalledTimes(1);
    await act(async () => finish(ok({ weekStart: WEEK })));
    await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
  });

  test("a failure keeps what was typed, says why next to the field and focuses it", async () => {
    vi.mocked(closeWeek).mockResolvedValue({
      ok: false,
      error: "Revisa los campos marcados.",
      fieldErrors: { objective: ["Usa 140 caracteres como máximo."] },
    });
    const user = userEvent.setup();
    render(<Step />);
    await user.type(objectiveField(), "Un objetivo");
    await user.type(noteField(), "Mi nota");
    await user.click(closeKey());
    await waitFor(() => expect(screen.getByText("Usa 140 caracteres como máximo.")).toBeVisible());
    expect(objectiveField()).toHaveValue("Un objetivo");
    expect(noteField()).toHaveValue("Mi nota");
    await waitFor(() => expect(objectiveField()).toHaveFocus());
    expect(router.push).not.toHaveBeenCalled();
    // It can be tried again: the key answers.
    expect(closeKey()).not.toHaveAttribute("aria-disabled", "true");
  });

  test("a general failure is said above the key, with focus on the message and the text kept", async () => {
    vi.mocked(closeWeek).mockResolvedValue(
      fail("No se pudo guardar. Inténtalo de nuevo en un momento."),
    );
    const user = userEvent.setup();
    render(<Step />);
    await user.type(noteField(), "Mi nota");
    await user.click(closeKey());
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("No se pudo guardar. Inténtalo de nuevo en un momento.");
    await waitFor(() => expect(alert).toHaveFocus());
    expect(noteField()).toHaveValue("Mi nota");
  });

  test("a network failure says to check the connection and keeps the text", async () => {
    vi.mocked(closeWeek).mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();
    render(<Step />);
    await user.type(objectiveField(), "Un objetivo");
    await user.click(closeKey());
    expect(await screen.findByRole("alert")).toHaveTextContent(REVIEW_COPY.checkConnection);
    expect(objectiveField()).toHaveValue("Un objetivo");
  });

  test("a note over 280 characters is refused before any call, never cut", async () => {
    const user = userEvent.setup();
    render(<Step />);
    await user.click(noteField());
    await user.paste("x".repeat(281));
    await user.click(closeKey());
    expect(await screen.findByText("Usa 280 caracteres como máximo.")).toBeVisible();
    expect(noteField()).toHaveValue("x".repeat(281));
    expect(closeWeek).not.toHaveBeenCalled();
  });

  test("an objective over 140 characters is refused before any call", async () => {
    const user = userEvent.setup();
    render(<Step />);
    await user.click(objectiveField());
    await user.paste("y".repeat(141));
    await user.click(closeKey());
    expect(await screen.findByText("El objetivo admite 140 caracteres como máximo.")).toBeVisible();
    expect(closeWeek).not.toHaveBeenCalled();
  });
});
