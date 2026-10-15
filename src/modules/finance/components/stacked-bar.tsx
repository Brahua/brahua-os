"use client";

import { categoryStyle } from "../category-color";
import { groupKey, type SummaryGroup } from "../summary";
import { SUMMARY_COPY, spokenTotal } from "../summary-copy";

type StackedBarProps = {
  categories: SummaryGroup[];
  activeKey: string | null;
  onToggle: (group: SummaryGroup) => void;
};

/**
 * The month by category in one bar: a segment per category with PEN, as wide as its share. Each
 * segment is a toggle like its row in the list (the list carries the names and amounts; this is the
 * shortcut), so a screen reader gets the same name and state.
 */
export function StackedBar({ categories, activeKey, onToggle }: StackedBarProps) {
  const shown = categories
    .map((group, index) => ({ group, index }))
    .filter(({ group }) => group.share > 0);
  if (shown.length === 0) return null;
  return (
    <ul className="bo-stacked-bar" data-stacked-bar="">
      {shown.map(({ group, index }) => {
        const key = groupKey(group);
        return (
          <li key={key} style={{ flex: `${group.share} 1 0` }}>
            <button
              type="button"
              className="bo-stacked-bar__segment"
              style={categoryStyle(index)}
              aria-pressed={activeKey === key}
              aria-label={SUMMARY_COPY.segmentLabel(
                group.name ?? SUMMARY_COPY.uncategorized,
                spokenTotal(group.penCents, 0),
              )}
              onClick={() => onToggle(group)}
              data-stacked-segment={key}
            />
          </li>
        );
      })}
    </ul>
  );
}
