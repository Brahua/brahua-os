// finance-motion M4: the pace chart (spoken description, cursor, touch, keyboard).
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import { AreaChart } from "@/modules/finance/components/area-chart";

// Days 1…5 of a 30-day month: 10.00 on day 1, then 25.00 on day 3 and 5; the previous month ran
// 5.00, 5.00, 40.00, 40.00, 40.00 over the same days.
const CURRENT = [1000, 1000, 2500, 2500, 2500];
const PREVIOUS = [500, 500, 4000, 4000, 4000];

const plot = () => screen.getByRole("img");

describe("AreaChart", () => {
  test("the whole chart is one image with a spoken description and its keyboard hint", () => {
    render(<AreaChart current={CURRENT} previous={PREVIOUS} days={30} today={5} />);
    expect(plot()).toHaveAccessibleName(
      "Gasto acumulado del mes: 25 soles al día 5. El mes anterior llevaba 40 soles a ese día.",
    );
    expect(plot()).toHaveAccessibleDescription("Con las flechas ← → recorres los días.");
    expect(plot()).toHaveAttribute("tabindex", "0");
    // The strokes are decorative; no tooltip until someone points at a day.
    expect(document.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(document.querySelector("[data-chart-tooltip]")).toBeNull();
  });

  test("without a previous month (or with an empty one) there is no dotted line and it is not said", () => {
    const { rerender } = render(
      <AreaChart current={CURRENT} previous={null} days={30} today={5} />,
    );
    expect(document.querySelector(".bo-chart__previous")).toBeNull();
    expect(plot().getAttribute("aria-label")).not.toContain("mes anterior");
    rerender(<AreaChart current={CURRENT} previous={[0, 0, 0, 0, 0]} days={30} today={5} />);
    expect(document.querySelector(".bo-chart__previous")).toBeNull();
    // Positive control: with data it is drawn.
    rerender(<AreaChart current={CURRENT} previous={PREVIOUS} days={30} today={5} />);
    expect(document.querySelector(".bo-chart__previous")).not.toBeNull();
  });

  test("today is marked only while the month is current", () => {
    const { rerender } = render(
      <AreaChart current={CURRENT} previous={null} days={30} today={5} />,
    );
    expect(document.querySelector(".bo-chart__today")).not.toBeNull();
    rerender(<AreaChart current={CURRENT} previous={null} days={30} today={null} />);
    expect(document.querySelector(".bo-chart__today")).toBeNull();
  });

  test("← → walk the days, said in a live region and shown in the tooltip; the ends hold", async () => {
    const user = userEvent.setup();
    render(<AreaChart current={CURRENT} previous={PREVIOUS} days={30} today={5} />);
    plot().focus();
    await user.keyboard("{ArrowLeft}");
    const tooltip = () => document.querySelector("[data-chart-tooltip]");
    // It starts on today (day 5): one step back is day 4.
    expect(tooltip()).toHaveTextContent("Día 4: S/ 25.00");
    expect(tooltip()).toHaveTextContent("Mes anterior S/ 40.00");
    expect(document.querySelector("[aria-live]")).toHaveTextContent(
      "Día 4: 25 soles; mes anterior 40 soles",
    );
    await user.keyboard("{Home}");
    expect(tooltip()).toHaveTextContent("Día 1: S/ 10.00");
    await user.keyboard("{ArrowLeft}");
    expect(tooltip()).toHaveTextContent("Día 1");
    await user.keyboard("{End}{ArrowRight}");
    expect(tooltip()).toHaveTextContent("Día 5");
    // Leaving the chart puts the tooltip away.
    plot().blur();
    await user.tab();
    expect(tooltip()).toBeNull();
  });

  test("a pointer shows the day under it", async () => {
    render(<AreaChart current={CURRENT} previous={null} days={30} today={5} />);
    const element = plot();
    element.getBoundingClientRect = () =>
      ({ left: 0, width: 400, top: 0, height: 200, right: 400, bottom: 200 }) as DOMRect;
    // jsdom has no PointerEvent: a mouse move is enough for the handler's clientX.
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.pointerMove(element, { clientX: 100 });
    // 100 / 400 of 29 steps ≈ index 7, but only 5 days have data: it stops at day 5.
    expect(document.querySelector("[data-chart-tooltip]")).toHaveTextContent("Día 5");
  });
});
