"use client";

import { X } from "lucide-react";
import * as m from "motion/react-m";
import { AnimatePresence } from "motion/react";
import { Key } from "@/design-system";
import { pop, useMotionEnabled } from "@/lib/motion";
import { SUMMARY_COPY } from "../summary-copy";

type FilterChipProps = {
  /** The category the list is filtered by; null: no chip. */
  name: string | null;
  count: number;
  onClear: () => void;
};

/**
 * «Solo Comida · 2 gastos» with «Quitar filtro». It pops in and leaves quickly; the host moves
 * focus before it unmounts (the chip is never the last place focus can be).
 */
export function FilterChip({ name, count, onClear }: FilterChipProps) {
  const enabled = useMotionEnabled();
  const body = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1" data-month-filter="">
      <p className="bo-text-body-sm text-text-secondary">
        {`${SUMMARY_COPY.filteredBy(name ?? "")} · ${SUMMARY_COPY.expenses(count)}`}
      </p>
      <Key variant="ghost" icon={X} onClick={onClear}>
        {SUMMARY_COPY.clearFilter}
      </Key>
    </div>
  );
  if (!enabled) return name === null ? null : body;
  return (
    <AnimatePresence initial={false}>
      {name === null ? null : (
        <m.div key="chip" variants={pop} initial="hidden" animate="shown" exit="hidden">
          {body}
        </m.div>
      )}
    </AnimatePresence>
  );
}
