"use client";

// «Por medio de pago» as bars (finance-resumen-charts R2): one row per method with PEN, its name,
// amount and share, over a bar as wide as its share. Read-only: the figures are also text. The
// dollars with no rate are one row of their own at the end, with a hatched bar and no share: they
// are not part of the total the bars add up to (the same rule as the donut).
import { useId } from "react";
import { formatMoney, spokenMoney } from "../money";
import { groupKey, type SummaryGroup } from "../summary";
import { percentText, SUMMARY_COPY } from "../summary-copy";
import { GrowFill } from "./grow-fill";
import { MoneyFlow, PercentFlow } from "./money-flow";

type MethodBarsProps = {
  methods: SummaryGroup[];
  /** USD with no stored rate in the whole month (apart). */
  unconvertedUsdCents: number;
  unconvertedDetail: string | null;
};

export function MethodBars({ methods, unconvertedUsdCents, unconvertedDetail }: MethodBarsProps) {
  const ids = useId();
  // A method with only dollars without a rate has no PEN: it lives in the last row.
  const rows = methods.filter((group) => group.penCents > 0);
  return (
    <section aria-labelledby={`${ids}-heading`} className="flex flex-col gap-3">
      <h3 id={`${ids}-heading`} className="bo-text-subheading">
        {SUMMARY_COPY.byMethod}
      </h3>
      <ul className="bo-list" aria-labelledby={`${ids}-heading`} data-method-bars="">
        {rows.map((group, index) => {
          const name = group.name ?? SUMMARY_COPY.noMethod;
          const percent = percentText(group.percent);
          const spoken = [name, spokenMoney(group.penCents, "PEN")];
          if (SUMMARY_COPY.spokenPercent(group.percent)) {
            spoken.push(SUMMARY_COPY.spokenPercent(group.percent)!);
          }
          return (
            <li
              key={groupKey(group)}
              className="bo-row bo-row--static flex-col items-stretch gap-2 py-3"
              data-method-row={groupKey(group)}
            >
              <span className="sr-only">{spoken.join(", ")}</span>
              <span className="flex items-baseline gap-3" aria-hidden>
                <span className="bo-row__title min-w-0 flex-1 truncate">{name}</span>
                <span className="bo-amount bo-text-body text-text">
                  <MoneyFlow cents={group.penCents} />
                </span>
                {percent && group.percent !== null ? (
                  <span className="bo-amount bo-text-body-sm w-10 text-right text-text-secondary">
                    <PercentFlow percent={group.percent} fallback={percent} />
                  </span>
                ) : null}
              </span>
              <span className="bo-summary-bar bo-summary-bar--tall" aria-hidden>
                <GrowFill share={group.share} index={index} />
              </span>
            </li>
          );
        })}
        {unconvertedUsdCents > 0 ? (
          <li
            className="bo-row bo-row--static flex-col items-stretch gap-2 py-3"
            data-method-unconverted=""
          >
            <span className="sr-only">
              {SUMMARY_COPY.methodUnconvertedSpoken(
                spokenMoney(unconvertedUsdCents, "USD"),
                unconvertedDetail ?? "",
              )}
            </span>
            <span className="flex items-baseline gap-3" aria-hidden>
              <span className="bo-row__title min-w-0 flex-1 truncate">
                {SUMMARY_COPY.methodUnconverted}
              </span>
              <span className="bo-amount bo-text-body text-text">
                {formatMoney(unconvertedUsdCents, "USD")}
              </span>
              <span className="bo-amount bo-text-body-sm w-10 text-right text-text-secondary">
                —
              </span>
            </span>
            <span
              className="bo-summary-bar bo-summary-bar--tall bo-summary-bar--hatch"
              aria-hidden
            />
            {unconvertedDetail ? (
              <span className="bo-text-body-sm text-text-secondary" aria-hidden>
                {unconvertedDetail}
              </span>
            ) : null}
          </li>
        ) : null}
      </ul>
    </section>
  );
}
