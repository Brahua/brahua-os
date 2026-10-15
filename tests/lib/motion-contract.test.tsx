import { act, render, renderHook, screen } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Cascade,
  cascade,
  collapse,
  crossFade,
  drawPath,
  flash,
  MotionProvider,
  markEntered,
  pop,
  resetEntryForTests,
  slideSwap,
  SCREEN,
  useCrossFade,
  useDirectionalSwap,
  useValueTransition,
} from "@/lib/motion";

const animate = vi.hoisted(() => vi.fn(() => ({ cancel: vi.fn() })));
vi.mock("motion/mini", () => ({ animate }));

/** `prefers-reduced-motion` on or off for the test. */
function reducedMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  reducedMotion(false);
  resetEntryForTests();
  animate.mockClear();
  // jsdom has no Web Animations: the hooks skip without it, so give them one.
  HTMLElement.prototype.animate = vi.fn() as unknown as typeof HTMLElement.prototype.animate;
});
afterEach(() => {
  // @ts-expect-error the stub is removed so other files see jsdom as it is
  delete HTMLElement.prototype.animate;
});

describe("variants", () => {
  it("only move opacity, transforms, strokes and heights", () => {
    const ALLOWED = new Set(["opacity", "x", "y", "scale", "pathLength", "height", "transition"]);
    const keys: string[] = [];
    for (const group of [cascade, slideSwap, crossFade, collapse, pop, drawPath, flash]) {
      for (const value of Object.values(group)) {
        const resolved = typeof value === "function" ? (value as (c?: number) => object)(1) : value;
        for (const key of Object.keys(resolved)) if (!ALLOWED.has(key)) keys.push(key);
      }
    }
    expect(keys).toEqual([]);
  });

  it("a cascade block waits for its turn", () => {
    const at = (index: number) => (cascade.shown(index).transition as { delay: number }).delay;
    expect(at(0)).toBe(0);
    expect(at(3)).toBeCloseTo(3 * SCREEN.cascadeStep);
  });

  it("the swap leaves towards the arrow and arrives from the other side", () => {
    expect(slideSwap.leaving(1).x).toBe(-8);
    expect(slideSwap.leaving(-1).x).toBe(8);
    expect(slideSwap.entering(1).x).toBe(8);
  });
});

describe("Cascade", () => {
  it("is a plain block without a MotionProvider (tests, error pages)", () => {
    render(
      <Cascade index={2} className="block-a" attrs={{ "data-x": "1" }}>
        <p>hola</p>
      </Cascade>,
    );
    const block = screen.getByText("hola").parentElement!;
    expect(block).toHaveClass("block-a");
    expect(block).toHaveAttribute("data-x", "1");
    expect(block.style.opacity).toBe("");
  });

  it("starts hidden under the provider, once per tab: later blocks appear plain", () => {
    const { unmount } = render(
      <MotionProvider>
        <Cascade index={0}>
          <p>primero</p>
        </Cascade>
      </MotionProvider>,
    );
    expect(screen.getByText("primero").parentElement!.style.opacity).toBe("0");
    unmount();
    render(
      <MotionProvider>
        <Cascade index={0}>
          <p>segundo</p>
        </Cascade>
      </MotionProvider>,
    );
    // The entry already played in this tab (the first block closed it): no hidden start.
    expect(screen.getByText("segundo").parentElement!.style.opacity).toBe("");
  });
});

describe("useValueTransition", () => {
  it("settles with the shared timing, and draws longer, segment by segment, on entry", () => {
    const settle = renderHook(() => useValueTransition(false)).result.current;
    expect(settle.duration).toBe(SCREEN.settle);
    const draw = renderHook(() => useValueTransition(true, 3)).result.current;
    expect(draw.duration).toBe(SCREEN.draw);
    expect(draw.delay).toBeGreaterThan(
      renderHook(() => useValueTransition(true, 0)).result.current.delay!,
    );
  });

  it("jumps with reduced motion", () => {
    reducedMotion(true);
    expect(renderHook(() => useValueTransition(true, 2)).result.current).toEqual({ duration: 0 });
    expect(renderHook(() => useValueTransition(false)).result.current).toEqual({ duration: 0 });
  });
});

describe("useDirectionalSwap", () => {
  function Swap(props: { order: number; pending: boolean; intent: 1 | -1 }) {
    const ref = useDirectionalSwap<HTMLDivElement>(props);
    return <div ref={ref}>contenido</div>;
  }
  const calls = () => animate.mock.calls as unknown as [HTMLElement, Record<string, unknown>][];

  it("does nothing on the first render", () => {
    render(<Swap order={10} pending={false} intent={1} />);
    expect(animate).not.toHaveBeenCalled();
  });

  it("leaves towards the arrow while pending and arrives from the other side", () => {
    const { rerender } = render(<Swap order={10} pending={false} intent={1} />);
    rerender(<Swap order={10} pending intent={1} />);
    expect(calls().at(-1)![1]).toMatchObject({ opacity: 0.4, transform: "translateX(-8px)" });
    // The exit finished and left the content dimmed (the browser commits its end style).
    screen.getByText("contenido").style.opacity = "0.4";
    rerender(<Swap order={11} pending={false} intent={1} />);
    expect(calls().at(-1)![1]).toMatchObject({
      opacity: [0.4, 1],
      transform: ["translateX(8px)", "none"],
    });
  });

  it("goes the other way for a previous month", () => {
    const { rerender } = render(<Swap order={10} pending={false} intent={-1} />);
    rerender(<Swap order={10} pending intent={-1} />);
    expect(calls().at(-1)![1]).toMatchObject({ transform: "translateX(8px)" });
    rerender(<Swap order={9} pending={false} intent={-1} />);
    expect(calls().at(-1)![1]).toMatchObject({ transform: ["translateX(-8px)", "none"] });
  });

  it("rests when the navigation ends without a new month (positive control: nothing before)", () => {
    const { rerender } = render(<Swap order={10} pending={false} intent={1} />);
    expect(animate).not.toHaveBeenCalled();
    rerender(<Swap order={10} pending intent={1} />);
    rerender(<Swap order={10} pending={false} intent={1} />);
    expect(calls().at(-1)![1]).toMatchObject({ opacity: 1, transform: "none" });
  });

  it("with reduced motion only the opacity moves", () => {
    reducedMotion(true);
    const { rerender } = render(<Swap order={10} pending={false} intent={1} />);
    rerender(<Swap order={10} pending intent={1} />);
    expect(calls().at(-1)![1]).toMatchObject({ opacity: 0.4, transform: "none" });
    rerender(<Swap order={11} pending={false} intent={1} />);
    expect(calls().at(-1)![1]).toMatchObject({ transform: ["none", "none"] });
  });

  it("cancels what it started when it unmounts", () => {
    const cancel = vi.fn();
    animate.mockReturnValueOnce({ cancel });
    const { rerender, unmount } = render(<Swap order={10} pending={false} intent={1} />);
    rerender(<Swap order={10} pending intent={1} />);
    act(() => unmount());
    expect(cancel).toHaveBeenCalled();
  });
});

describe("useDirectionalSwap: fast sequences", () => {
  function Swap(props: { order: number; pending: boolean; intent: 1 | -1 }) {
    const ref = useDirectionalSwap<HTMLDivElement>(props);
    return <div ref={ref}>contenido</div>;
  }

  it("never cancels an animation when the next one starts (that would snap the content back)", () => {
    const cancel = vi.fn();
    animate.mockReturnValue({ cancel });
    const { rerender, unmount } = render(<Swap order={10} pending={false} intent={1} />);
    rerender(<Swap order={10} pending intent={1} />);
    // The arrow is pressed the other way before the answer: the exit turns around.
    rerender(<Swap order={10} pending intent={-1} />);
    rerender(<Swap order={9} pending={false} intent={-1} />);
    expect(animate).toHaveBeenCalledTimes(3);
    expect(cancel).not.toHaveBeenCalled();
    unmount();
    expect(cancel).toHaveBeenCalledTimes(3);
    animate.mockReset();
    animate.mockReturnValue({ cancel: vi.fn() });
  });
});

describe("useCrossFade", () => {
  function Panels({ shown }: { shown: "a" | "b" }) {
    const panel = useCrossFade(shown);
    return (
      <>
        <div ref={panel("a")} hidden={shown !== "a"}>
          panel a
        </div>
        <div ref={panel("b")} hidden={shown !== "b"}>
          panel b
        </div>
      </>
    );
  }

  it("animates nothing on the first render and fades in the panel that appears", () => {
    const { rerender } = render(<Panels shown="a" />);
    expect(animate).not.toHaveBeenCalled();
    rerender(<Panels shown="b" />);
    const [element, keyframes] = animate.mock.calls.at(-1) as unknown as [
      HTMLElement,
      Record<string, unknown>,
    ];
    expect(element).toHaveTextContent("panel b");
    expect(keyframes).toMatchObject({ opacity: [0, 1], transform: ["translateY(6px)", "none"] });
  });

  it("with reduced motion it only fades", () => {
    reducedMotion(true);
    const { rerender } = render(<Panels shown="a" />);
    rerender(<Panels shown="b" />);
    const [, keyframes] = animate.mock.calls.at(-1) as unknown as [
      HTMLElement,
      Record<string, unknown>,
    ];
    expect(keyframes).toMatchObject({ opacity: [0, 1], transform: ["none", "none"] });
  });

  it("does nothing without Web Animations", () => {
    // @ts-expect-error the stub is removed to look like jsdom
    delete HTMLElement.prototype.animate;
    const { rerender } = render(<Panels shown="a" />);
    rerender(<Panels shown="b" />);
    expect(animate).not.toHaveBeenCalled();
  });
});

describe("Cascade: stability and hydration", () => {
  it("keeps its element when the first block closes the entry (positive control: it did close)", () => {
    const tree = (
      <MotionProvider>
        <Cascade index={0}>
          <p>bloque</p>
        </Cascade>
      </MotionProvider>
    );
    const { rerender } = render(tree);
    const before = screen.getByText("bloque").parentElement;
    expect(before).toHaveAttribute("data-motion-cascade");
    // Its own effect called markEntered: a block mounted now is plain…
    const { container } = render(
      <MotionProvider>
        <Cascade index={1}>
          <p>tarde</p>
        </Cascade>
      </MotionProvider>,
    );
    expect(container.querySelector("[data-motion-cascade]")).toBeNull();
    // …but the first one is still the same node, not remounted as a plain div.
    rerender(tree);
    expect(screen.getByText("bloque").parentElement).toBe(before);
  });

  it("hydrates what the server rendered without a mismatch", () => {
    resetEntryForTests();
    const tree = (
      <MotionProvider>
        <Cascade index={0} attrs={{ "data-x": "1" }}>
          <p>servidor</p>
        </Cascade>
      </MotionProvider>
    );
    const html = renderToString(tree);
    expect(html).toContain("opacity:0");
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.append(host);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    act(() => {
      hydrateRoot(host, tree);
    });
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
    expect(host.querySelector("[data-x]")).toHaveAttribute("data-motion-cascade");
    host.remove();
  });
});

describe("markEntered", () => {
  it("is idempotent", () => {
    resetEntryForTests();
    markEntered();
    expect(() => markEntered()).not.toThrow();
  });
});
