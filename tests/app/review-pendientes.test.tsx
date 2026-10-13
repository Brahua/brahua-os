// `weekly-review` W2: step 2 · Pendientes as the owner uses it, against a fake server. The Server
// Actions are mocked; the screen's queue, notices and focus handling are the real ones. Rows
// leave at once under reduced motion (the default here) and with a fade otherwise.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { ownerDateKey } from "@/lib/time";
import { ScreenServicesProvider } from "@/modules/core/components/screen-services";
import type {
  MoveTasksResult,
  UndoMoveTasksResult,
  WeekReviewOpenTask,
} from "@/modules/tasks/contracts";
import { moveReviewTasks, undoReviewMove } from "@/modules/weekly-review/actions";
import { LEAVE_FADE_MS, StepPendientes } from "@/modules/weekly-review/components/step-pendientes";
import { REVIEW_COPY } from "@/modules/weekly-review/review-copy";
import { addDays } from "@/modules/weekly-review/week";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => router,
}));
vi.mock("@/modules/weekly-review/actions", () => ({
  moveReviewTasks: vi.fn(),
  undoReviewMove: vi.fn(),
}));

const TODAY = ownerDateKey(new Date());
const TARGETS = { monday: addDays(TODAY, 6), tomorrow: addDays(TODAY, 1) };
const OLD = addDays(TODAY, -3);

function setReducedMotion(reduced: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduced && query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

const A: WeekReviewOpenTask = {
  id: "00000000-0000-4000-8000-00000000000a",
  title: "Pagar la luz",
  dueDate: OLD,
  projectName: null,
  recurring: false,
};
const B: WeekReviewOpenTask = {
  id: "00000000-0000-4000-8000-00000000000b",
  title: "Llamar al banco",
  dueDate: OLD,
  projectName: "Mudanza",
  recurring: false,
};
const C: WeekReviewOpenTask = {
  id: "00000000-0000-4000-8000-00000000000c",
  title: "Regar las plantas",
  dueDate: addDays(TODAY, -1),
  projectName: null,
  recurring: true,
};

function Step({
  open = [A, B, C],
  openCount = open.length,
  inboxCount = 0,
}: {
  open?: WeekReviewOpenTask[];
  openCount?: number;
  inboxCount?: number;
}) {
  return (
    <ScreenServicesProvider
      label={REVIEW_COPY.noticesLabel}
      actionHint={REVIEW_COPY.undoHint}
      day={{ today: TODAY, changedMessage: REVIEW_COPY.newDay }}
    >
      <StepPendientes
        today={TODAY}
        targets={TARGETS}
        open={open}
        openCount={openCount}
        inboxCount={inboxCount}
      />
    </ScreenServicesProvider>
  );
}

/** What the contract answers when everything moves. */
function movedAll(tasks: WeekReviewOpenTask[], to: string): MoveTasksResult {
  return {
    to,
    moved: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      previousDueDate: task.dueDate,
      movedTo: to,
    })),
    skipped: [],
  };
}

const rowOf = (task: WeekReviewOpenTask) =>
  document.querySelector<HTMLElement>(`[data-review-row="${task.id}"]`);
const tomorrowKey = (task: WeekReviewOpenTask) =>
  screen.getByRole("button", { name: new RegExp(`^Pasar «${task.title}» al`) });

beforeEach(() => {
  setReducedMotion(true);
  vi.mocked(moveReviewTasks).mockReset();
  vi.mocked(undoReviewMove).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("what it shows", () => {
  test("«Quedaron abiertas N tareas.», the big key and each task with its three keys", () => {
    render(<Step inboxCount={4} />);
    expect(screen.getByText("Quedaron abiertas 3 tareas.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Mover las 3 al lunes" })).toBeVisible();
    for (const task of [A, B, C]) {
      const row = within(rowOf(task)!);
      expect(row.getByText(task.title)).toBeVisible();
      expect(row.getByRole("button", { name: /^Pasar «/ })).toHaveTextContent("Mañana");
      expect(
        row.getByRole("button", { name: `Elegir otro día para «${task.title}»` }),
      ).toHaveTextContent("Otro día…");
      expect(row.getByRole("button", { name: `Dejar «${task.title}» donde está` })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    }
    expect(within(rowOf(B)!).getByText(/Mudanza/)).toBeVisible();
    expect(within(rowOf(C)!).getByText(/se mueve solo esta vez/)).toBeVisible();
    // The inbox, as a link to the tasks inbox.
    expect(screen.getByText(/4 en la bandeja/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Procesar 4 en la bandeja" })).toHaveAttribute(
      "href",
      "/tasks",
    );
  });

  test("singular, and no inbox line when it is empty", () => {
    render(<Step open={[A]} />);
    expect(screen.getByText("Quedó abierta 1 tarea.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Mover la tarea al lunes" })).toBeVisible();
    expect(document.querySelector("[data-review-inbox]")).toBeNull();
  });

  test("nothing open: «Nada abierto. Buen cierre.» and no keys", () => {
    render(<Step open={[]} inboxCount={2} />);
    expect(screen.getByText("Nada abierto. Buen cierre.")).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    // The inbox is still offered.
    expect(screen.getByRole("link", { name: "Procesar 2 en la bandeja" })).toBeVisible();
  });

  test("a list cut at 200 says how many are shown", () => {
    render(<Step open={[A, B]} openCount={350} />);
    expect(screen.getByText("Quedaron abiertas 350 tareas.")).toBeVisible();
    expect(screen.getByText("Se muestran las primeras 2 de 350.")).toBeVisible();
  });
});

describe("«Mover las N al lunes»", () => {
  test("moves every task to Monday, the rows leave, the notice offers «Deshacer» and focus lands on the message", async () => {
    vi.mocked(moveReviewTasks).mockResolvedValue(ok(movedAll([A, B, C], TARGETS.monday)));
    render(<Step />);
    await userEvent.click(screen.getByRole("button", { name: "Mover las 3 al lunes" }));

    expect(moveReviewTasks).toHaveBeenCalledTimes(1);
    expect(moveReviewTasks).toHaveBeenCalledWith({
      moves: [A, B, C].map((task) => ({ id: task.id, from: task.dueDate })),
      to: TARGETS.monday,
    });
    expect(await screen.findByText("Se movieron 3 tareas.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Deshacer" })).toBeVisible();
    expect(screen.getByText("Nada abierto. Buen cierre.")).toHaveFocus();
    for (const task of [A, B, C]) expect(rowOf(task)).toBeNull();
  });

  test("«Dejar» keeps a task out of the batch and the count follows", async () => {
    vi.mocked(moveReviewTasks).mockResolvedValue(ok(movedAll([A, C], TARGETS.monday)));
    render(<Step />);
    const leave = screen.getByRole("button", { name: `Dejar «${B.title}» donde está` });
    await userEvent.click(leave);
    expect(leave).toHaveAttribute("aria-pressed", "true");
    expect(within(rowOf(B)!).getByText("Se queda donde está.")).toBeVisible();
    // It is still open: the heading keeps counting it.
    expect(screen.getByText("Quedaron abiertas 3 tareas.")).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Mover las 2 al lunes" }));
    expect(moveReviewTasks).toHaveBeenCalledWith({
      moves: [A, C].map((task) => ({ id: task.id, from: task.dueDate })),
      to: TARGETS.monday,
    });
    await screen.findByText("Se movieron 2 tareas.");
    // The one left stays, and focus lands on its first key, not on <body>.
    expect(rowOf(B)).not.toBeNull();
    expect(tomorrowKey(B)).toHaveFocus();
    expect(screen.getByText("Quedó abierta 1 tarea.")).toBeVisible();

    // Toggling it back puts it in the batch again.
    await userEvent.click(screen.getByRole("button", { name: `Dejar «${B.title}» donde está` }));
    expect(screen.getByRole("button", { name: "Mover la tarea al lunes" })).toBeVisible();
  });

  test("with every task left, the big key stays (aria-disabled) and does nothing", async () => {
    render(<Step open={[A]} />);
    await userEvent.click(screen.getByRole("button", { name: `Dejar «${A.title}» donde está` }));
    const batch = screen.getByRole("button", { name: "Nada que mover al lunes" });
    expect(batch).toHaveAttribute("aria-disabled", "true");
    expect(batch).not.toBeDisabled();
    await userEvent.click(batch);
    expect(moveReviewTasks).not.toHaveBeenCalled();
  });

  test("a task the server left alone stays in the list and the notice says so", async () => {
    vi.mocked(moveReviewTasks).mockResolvedValue(
      ok<MoveTasksResult>({
        to: TARGETS.monday,
        moved: movedAll([A, C], TARGETS.monday).moved,
        skipped: [{ id: B.id, reason: "changed" }],
      }),
    );
    render(<Step />);
    await userEvent.click(screen.getByRole("button", { name: "Mover las 3 al lunes" }));
    expect(
      await screen.findByText(
        "Se movieron 2 tareas. 1 se quedó donde estaba: cambió mientras tanto.",
      ),
    ).toBeVisible();
    expect(rowOf(B)).not.toBeNull();
    expect(rowOf(A)).toBeNull();
  });

  test("if nothing could move, it says so and puts the rows back", async () => {
    vi.mocked(moveReviewTasks).mockResolvedValue(
      ok<MoveTasksResult>({
        to: TARGETS.monday,
        moved: [],
        skipped: [A, B, C].map((task) => ({ id: task.id, reason: "changed" as const })),
      }),
    );
    render(<Step />);
    await userEvent.click(screen.getByRole("button", { name: "Mover las 3 al lunes" }));
    expect(await screen.findByText("No se movió ninguna: cambiaron mientras tanto.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Deshacer" })).not.toBeInTheDocument();
    for (const task of [A, B, C]) expect(rowOf(task)).not.toBeNull();
  });

  test("two quick presses move once", async () => {
    let resolve!: (value: ActionResult<MoveTasksResult>) => void;
    vi.mocked(moveReviewTasks).mockReturnValue(new Promise((done) => (resolve = done)));
    render(<Step open={[A, B]} />);
    const batch = screen.getByRole("button", { name: "Mover las 2 al lunes" });
    await userEvent.dblClick(batch);
    expect(moveReviewTasks).toHaveBeenCalledTimes(1);
    await act(async () => resolve(ok(movedAll([A, B], TARGETS.monday))));
    await screen.findByText("Se movieron 2 tareas.");
    expect(moveReviewTasks).toHaveBeenCalledTimes(1);
  });
});

describe("per row", () => {
  test("«Mañana» moves only that task and focus goes to the next row", async () => {
    vi.mocked(moveReviewTasks).mockResolvedValue(ok(movedAll([A], TARGETS.tomorrow)));
    render(<Step />);
    await userEvent.click(tomorrowKey(A));
    expect(moveReviewTasks).toHaveBeenCalledWith({
      moves: [{ id: A.id, from: A.dueDate }],
      to: TARGETS.tomorrow,
    });
    expect(await screen.findByText("Se movió 1 tarea.")).toBeVisible();
    expect(rowOf(A)).toBeNull();
    expect(rowOf(B)).not.toBeNull();
    expect(tomorrowKey(B)).toHaveFocus();
    expect(screen.getByText("Quedaron abiertas 2 tareas.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Mover las 2 al lunes" })).toBeVisible();
  });

  test("the last row hands focus to the one before it", async () => {
    vi.mocked(moveReviewTasks).mockResolvedValue(ok(movedAll([C], TARGETS.tomorrow)));
    render(<Step />);
    await userEvent.click(tomorrowKey(C));
    await screen.findByText("Se movió 1 tarea.");
    expect(tomorrowKey(B)).toHaveFocus();
  });

  test("the keys are never `disabled`: while a save is in flight they are aria-disabled and do nothing", async () => {
    let resolve!: (value: ActionResult<MoveTasksResult>) => void;
    vi.mocked(moveReviewTasks)
      .mockReturnValueOnce(new Promise((done) => (resolve = done)))
      .mockResolvedValue(ok(movedAll([B], TARGETS.monday)));
    render(<Step open={[A, B]} />);
    const key = tomorrowKey(A);
    await userEvent.click(key);
    await userEvent.click(key);
    expect(moveReviewTasks).toHaveBeenCalledTimes(1);
    // The other row is free: it joins the queue and goes after the one in flight.
    await userEvent.click(screen.getByRole("button", { name: "Mover la tarea al lunes" }));
    for (const button of screen.queryAllByRole("button")) expect(button).not.toBeDisabled();
    await act(async () => resolve(ok(movedAll([A], TARGETS.tomorrow))));
    await waitFor(() => expect(moveReviewTasks).toHaveBeenCalledTimes(2));
    expect(vi.mocked(moveReviewTasks).mock.calls[1][0]).toEqual({
      moves: [{ id: B.id, from: B.dueDate }],
      to: TARGETS.monday,
    });
  });

  test("«Otro día…» opens a date field with focus, «Mover» sends that day and Escape cancels back to the key", async () => {
    vi.mocked(moveReviewTasks).mockResolvedValue(ok(movedAll([B], addDays(TODAY, 20))));
    render(<Step />);
    const pick = screen.getByRole("button", { name: `Elegir otro día para «${B.title}»` });
    await userEvent.click(pick);
    const field = screen.getByLabelText("¿Para qué día?");
    expect(field).toHaveFocus();
    expect(field).toHaveAttribute("min", TODAY);
    expect(field).toHaveValue(TARGETS.tomorrow);

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByLabelText("¿Para qué día?")).not.toBeInTheDocument();
    expect(pick).toHaveFocus();
    expect(moveReviewTasks).not.toHaveBeenCalled();

    await userEvent.click(pick);
    const again = screen.getByLabelText("¿Para qué día?");
    const target = addDays(TODAY, 20);
    await userEvent.clear(again);
    await userEvent.type(again, target);
    await userEvent.click(screen.getByRole("button", { name: "Mover" }));
    expect(moveReviewTasks).toHaveBeenCalledWith({
      moves: [{ id: B.id, from: B.dueDate }],
      to: target,
    });
    expect(await screen.findByText("Se movió 1 tarea.")).toBeVisible();
    expect(rowOf(B)).toBeNull();
  });

  test("a day before today is not sent: the field says what it takes", async () => {
    render(<Step />);
    await userEvent.click(
      screen.getByRole("button", { name: `Elegir otro día para «${A.title}»` }),
    );
    const field = screen.getByLabelText("¿Para qué día?");
    await userEvent.clear(field);
    await userEvent.type(field, addDays(TODAY, -2));
    await userEvent.click(screen.getByRole("button", { name: "Mover" }));
    expect(moveReviewTasks).not.toHaveBeenCalled();
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveFocus();
    expect(rowOf(A)).not.toBeNull();
  });
});

describe("«Deshacer»", () => {
  test("carries only what moved (never what was skipped), restores the rows and says so", async () => {
    vi.mocked(moveReviewTasks).mockResolvedValue(
      ok<MoveTasksResult>({
        to: TARGETS.monday,
        moved: movedAll([A, C], TARGETS.monday).moved,
        skipped: [{ id: B.id, reason: "changed" }],
      }),
    );
    vi.mocked(undoReviewMove).mockResolvedValue(
      ok<UndoMoveTasksResult>({ restored: [A.id, C.id], kept: [], missing: [] }),
    );
    render(<Step />);
    await userEvent.click(screen.getByRole("button", { name: "Mover las 3 al lunes" }));
    await screen.findByText(/Se movieron 2 tareas/);
    await userEvent.click(screen.getByRole("button", { name: "Deshacer" }));

    expect(undoReviewMove).toHaveBeenCalledTimes(1);
    expect(undoReviewMove).toHaveBeenCalledWith({
      undo: [A, C].map((task) => ({
        id: task.id,
        previousDueDate: task.dueDate,
        movedTo: TARGETS.monday,
      })),
    });
    await waitFor(() => expect(rowOf(A)).not.toBeNull());
    expect(rowOf(C)).not.toBeNull();
    await waitFor(() =>
      expect(document.querySelector("[data-screen-announcer]")).toHaveTextContent(
        "2 tareas volvieron a su día.",
      ),
    );
  });

  test("if some changed meanwhile, the notice says how many were not restored", async () => {
    vi.mocked(moveReviewTasks).mockResolvedValue(ok(movedAll([A, B, C], TARGETS.monday)));
    vi.mocked(undoReviewMove).mockResolvedValue(
      ok<UndoMoveTasksResult>({
        restored: [A.id],
        kept: [{ id: B.id, dueDate: addDays(TODAY, 9) }],
        missing: [C.id],
      }),
    );
    render(<Step />);
    await userEvent.click(screen.getByRole("button", { name: "Mover las 3 al lunes" }));
    await screen.findByText("Se movieron 3 tareas.");
    await userEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    expect(
      await screen.findByText("1 volvió a su día. 2 no se restauraron: cambiaron mientras tanto."),
    ).toBeVisible();
  });

  test("when none could be restored it says so", async () => {
    vi.mocked(moveReviewTasks).mockResolvedValue(ok(movedAll([A], TARGETS.tomorrow)));
    vi.mocked(undoReviewMove).mockResolvedValue(
      ok<UndoMoveTasksResult>({
        restored: [],
        kept: [{ id: A.id, dueDate: addDays(TODAY, 9) }],
        missing: [],
      }),
    );
    render(<Step open={[A, B]} />);
    await userEvent.click(tomorrowKey(A));
    await screen.findByText("Se movió 1 tarea.");
    await userEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    expect(await screen.findByText("1 no se restauró: cambió mientras tanto.")).toBeVisible();
  });

  test("a refused undo says «Sin guardar»", async () => {
    vi.mocked(moveReviewTasks).mockResolvedValue(ok(movedAll([A], TARGETS.tomorrow)));
    vi.mocked(undoReviewMove).mockResolvedValue(fail("No se pudo guardar."));
    render(<Step open={[A, B]} />);
    await userEvent.click(tomorrowKey(A));
    await screen.findByText("Se movió 1 tarea.");
    await userEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    expect(await screen.findByText(/No se pudo deshacer\. No se pudo guardar\./)).toBeVisible();
  });
});

describe("failures", () => {
  test("a refused move puts the rows back and says «Sin guardar» (asserted inside waitFor)", async () => {
    vi.mocked(moveReviewTasks).mockResolvedValue(fail("No se pudo guardar. Inténtalo de nuevo."));
    render(<Step />);
    await userEvent.click(screen.getByRole("button", { name: "Mover las 3 al lunes" }));
    await waitFor(() => {
      for (const task of [A, B, C]) expect(rowOf(task)).not.toBeNull();
      expect(screen.getByText(/No se pudo mover; siguen como estaban\./)).toBeVisible();
    });
    expect(screen.getByText("Sin guardar")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Deshacer" })).not.toBeInTheDocument();
    expect(screen.getByText("Quedaron abiertas 3 tareas.")).toBeVisible();
  });

  test("a call that throws is a refused move too", async () => {
    vi.mocked(moveReviewTasks).mockRejectedValue(new Error("network"));
    render(<Step open={[A, B]} />);
    await userEvent.click(tomorrowKey(A));
    await waitFor(() => {
      expect(rowOf(A)).not.toBeNull();
      expect(screen.getByText(/Revisa tu conexión/)).toBeVisible();
    });
  });
});

describe("the fade", () => {
  test("without reduced motion the row fades first and leaves when it ends", async () => {
    setReducedMotion(false);
    vi.mocked(moveReviewTasks).mockResolvedValue(ok(movedAll([A], TARGETS.tomorrow)));
    render(<Step open={[A, B]} />);
    await userEvent.click(tomorrowKey(A));
    expect(rowOf(A)).toHaveAttribute("data-leaving");
    expect(moveReviewTasks).not.toHaveBeenCalled();
    await waitFor(() => expect(rowOf(A)).toBeNull(), { timeout: LEAVE_FADE_MS * 5 });
    expect(moveReviewTasks).toHaveBeenCalledTimes(1);
  });

  test("leaving the screen mid-fade clears the timer (nothing is saved, nothing throws)", async () => {
    setReducedMotion(false);
    const { unmount } = render(<Step open={[A, B]} />);
    await userEvent.click(tomorrowKey(A));
    unmount();
    await new Promise((resolve) => setTimeout(resolve, LEAVE_FADE_MS * 2));
    expect(moveReviewTasks).not.toHaveBeenCalled();
  });
});
