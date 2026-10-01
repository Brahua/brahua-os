import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { TOAST_DURATION } from "@/lib/toast/queue";
import { useToaster, type Toaster } from "@/lib/toast/use-toaster";
import { ToastViewport } from "@/modules/core/components/toast-viewport";

let toaster!: Toaster;

function expose(value: Toaster) {
  toaster = value;
}

function Harness() {
  const current = useToaster();
  useLayoutEffect(() => expose(current));
  return (
    <>
      <button type="button">Antes</button>
      <ToastViewport toaster={current} label="Avisos" actionHint="Pista." />
    </>
  );
}

const region = () => screen.getByRole("region", { name: "Avisos" });
const live = () => within(region()).getByRole("status");
const push = (text: string, run?: () => void) =>
  act(() => {
    toaster.push({ title: "Orden", text, action: run ? { label: "Deshacer", run } : undefined });
  });
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ToastViewport", () => {
  test("a named region with a polite live region that is always there, even when empty", () => {
    render(<Harness />);
    expect(live()).toHaveAttribute("aria-live", "polite");
    expect(live()).toBeEmptyDOMElement();
    push("Hola");
    expect(live()).toHaveTextContent("OrdenHola");
    // The toast inside is not a second live region.
    expect(live().querySelector('[role="status"]')).toBeNull();
  });

  test("a notice with an action also says, hidden on screen, how to undo", () => {
    render(<Harness />);
    push("Hola", () => {});
    expect(live()).toHaveTextContent("OrdenHola Pista.Deshacer");
    expect(screen.getByText("Pista.")).toHaveClass("sr-only");
  });

  test("errors stay 12 s", () => {
    render(<Harness />);
    act(() => {
      toaster.push({ title: "Sin guardar", text: "Falló", tone: "error" });
    });
    advance(TOAST_DURATION.error - 1);
    expect(region()).toHaveTextContent("Falló");
    advance(1);
    expect(live()).toBeEmptyDOMElement();
  });

  test("the timer pauses while a dialog is open", async () => {
    render(<Harness />);
    push("Hola");
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    // The MutationObserver reports in a microtask.
    await act(async () => document.body.append(dialog));
    advance(60_000);
    expect(region()).toHaveTextContent("Hola");
    await act(async () => dialog.remove());
    advance(TOAST_DURATION.plain);
    expect(live()).toBeEmptyDOMElement();
  });

  test("Esc on the page dismisses it, but not while typing, in a dialog or dragging", () => {
    render(<Harness />);
    push("Hola", () => {});
    const input = document.createElement("input");
    document.body.append(input);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(region()).toHaveTextContent("Hola");
    document.documentElement.setAttribute("data-dragging", "");
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(region()).toHaveTextContent("Hola");
    document.documentElement.removeAttribute("data-dragging");
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(live()).toBeEmptyDOMElement();
    input.remove();
  });

  test("⌘Z does nothing while a drag is active", () => {
    const run = vi.fn();
    render(<Harness />);
    push("Hola", run);
    document.documentElement.setAttribute("data-dragging", "");
    fireEvent.keyDown(document.body, { key: "z", metaKey: true });
    document.documentElement.removeAttribute("data-dragging");
    expect(run).not.toHaveBeenCalled();
  });

  test("if the focused notice is replaced from code, focus goes back, not to <body>", () => {
    render(<Harness />);
    const before = screen.getByRole("button", { name: "Antes" });
    act(() => before.focus());
    push("Uno", () => {});
    push("Dos");
    act(() => screen.getByRole("button", { name: "Deshacer" }).focus());
    act(() => toaster.dismiss(toaster.state.visible!.id));
    expect(region()).toHaveTextContent("Dos");
    expect(before).toHaveFocus();
  });

  test("publishes its height in --toast-offset while visible", () => {
    render(<Harness />);
    expect(document.documentElement.style.getPropertyValue("--toast-offset")).toBe("");
    push("Hola");
    expect(document.documentElement.style.getPropertyValue("--toast-offset")).not.toBe("");
    advance(TOAST_DURATION.plain);
    expect(document.documentElement.style.getPropertyValue("--toast-offset")).toBe("");
  });

  test("leaves on its own: 10 s with an action, 6 s without", () => {
    render(<Harness />);
    push("Con acción", () => {});
    advance(TOAST_DURATION.withAction - 1);
    expect(region()).toHaveTextContent("Con acción");
    advance(1);
    expect(live()).toBeEmptyDOMElement();

    push("Sin acción");
    advance(TOAST_DURATION.plain);
    expect(live()).toBeEmptyDOMElement();
  });

  test("one at a time: the next shows when the first leaves, with its own full time", () => {
    render(<Harness />);
    push("Uno");
    push("Dos");
    expect(region()).toHaveTextContent("Uno");
    expect(region()).not.toHaveTextContent("Dos");
    advance(TOAST_DURATION.plain);
    expect(region()).toHaveTextContent("Dos");
    advance(TOAST_DURATION.plain - 1);
    expect(region()).toHaveTextContent("Dos");
  });

  test("the timer pauses while hovered and resumes with the time left", () => {
    render(<Harness />);
    push("Hola");
    advance(4_000);
    fireEvent.mouseEnter(region());
    advance(60_000);
    expect(region()).toHaveTextContent("Hola");
    fireEvent.mouseLeave(region());
    advance(1_999);
    expect(region()).toHaveTextContent("Hola");
    advance(1);
    expect(live()).toBeEmptyDOMElement();
  });

  test("the timer pauses while focus is inside and while the tab is hidden", () => {
    render(<Harness />);
    push("Hola", () => {});
    act(() => screen.getByRole("button", { name: "Deshacer" }).focus());
    advance(60_000);
    expect(region()).toHaveTextContent("Hola");
    act(() => screen.getByRole("button", { name: "Antes" }).focus());

    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    advance(60_000);
    expect(region()).toHaveTextContent("Hola");
    hidden.mockReturnValue(false);
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    advance(TOAST_DURATION.withAction);
    expect(live()).toBeEmptyDOMElement();
  });

  test("the action runs once, closes the notice and returns focus to where it was", () => {
    const run = vi.fn();
    render(<Harness />);
    const before = screen.getByRole("button", { name: "Antes" });
    act(() => before.focus());
    push("Hola", run);
    // Never steals focus.
    expect(before).toHaveFocus();

    const action = screen.getByRole("button", { name: "Deshacer" });
    act(() => action.focus());
    fireEvent.click(action);
    expect(run).toHaveBeenCalledTimes(1);
    expect(live()).toBeEmptyDOMElement();
    expect(before).toHaveFocus();
  });

  test("Esc inside dismisses it and returns focus", () => {
    render(<Harness />);
    const before = screen.getByRole("button", { name: "Antes" });
    act(() => before.focus());
    push("Hola", () => {});
    act(() => screen.getByRole("button", { name: "Deshacer" }).focus());
    fireEvent.keyDown(screen.getByRole("button", { name: "Deshacer" }), { key: "Escape" });
    expect(live()).toBeEmptyDOMElement();
    expect(before).toHaveFocus();
  });

  test("⌘Z / Ctrl+Z runs the action of the notice on screen, but not while typing", () => {
    const run = vi.fn();
    render(<Harness />);
    push("Hola", run);
    const input = document.createElement("input");
    document.body.append(input);
    fireEvent.keyDown(input, { key: "z", metaKey: true });
    expect(run).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    expect(run).toHaveBeenCalledTimes(1);
    expect(live()).toBeEmptyDOMElement();
    input.remove();
  });

  test("a notice without an action ignores ⌘Z", () => {
    render(<Harness />);
    push("Hola");
    const event = new KeyboardEvent("keydown", { key: "z", metaKey: true, cancelable: true });
    act(() => document.body.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false);
    expect(region()).toHaveTextContent("Hola");
  });
});
