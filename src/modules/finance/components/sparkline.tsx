// Six months of totals as a small line under «Gastado» (finance-motion M4). Decorative: the card
// says its figure and the context line says the comparison; this only gives the shape.
import { chartMax, linePath, pointsOf } from "../chart-geometry";

export function Sparkline({ totals }: { totals: readonly number[] }) {
  if (totals.length < 2 || chartMax(totals) <= 0) return null;
  const points = pointsOf(totals, totals.length, chartMax(totals));
  const last = points[points.length - 1];
  return (
    <span className="bo-sparkline" aria-hidden data-sparkline="">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" focusable="false">
        <path d={linePath(points)} />
      </svg>
      <span className="bo-chart__dot" style={{ left: `${last.x}%`, top: `${last.y}%` }} />
    </span>
  );
}
