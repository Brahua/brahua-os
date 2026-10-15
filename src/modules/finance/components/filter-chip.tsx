"use client";

import { X } from "lucide-react";
import * as m from "motion/react-m";
import { AnimatePresence } from "motion/react";
import { Key } from "@/design-system";
import { pop, useMotionEnabled } from "@/lib/motion";
import { SUMMARY_COPY } from "../summary-copy";

export type ChipItem = { key: string; label: string; onRemove: () => void };

type FilterChipsProps = {
  chips: readonly ChipItem[];
  onClearAll: () => void;
  /** Each chip's key, so the host can move focus to a neighbor when one goes. */
  registerRemove: (key: string, element: HTMLButtonElement | null) => void;
};

/**
 * The filters that are on, one chip each with its «Quitar filtro: …», and «Quitar todos». Chips pop
 * in and leave quickly (`pop`); the host moves focus before one unmounts.
 */
export function FilterChips({ chips, onClearAll, registerRemove }: FilterChipsProps) {
  const enabled = useMotionEnabled();
  if (chips.length === 0) return null;
  const body = chips.map((chip) => (
    <Chip key={chip.key} chip={chip} register={registerRemove} animated={enabled} />
  ));
  return (
    <div className="flex flex-wrap items-center gap-2" data-month-filter="">
      {enabled ? <AnimatePresence initial={false}>{body}</AnimatePresence> : body}
      {chips.length > 1 ? (
        <Key variant="ghost" onClick={onClearAll}>
          {SUMMARY_COPY.clearAll}
        </Key>
      ) : null}
    </div>
  );
}

function Chip({
  chip,
  register,
  animated,
}: {
  chip: ChipItem;
  register: FilterChipsProps["registerRemove"];
  animated: boolean;
}) {
  const content = (
    <>
      <span className="bo-text-body-sm truncate">{chip.label}</span>
      <button
        ref={(element) => register(chip.key, element)}
        type="button"
        className="bo-chip__remove"
        aria-label={SUMMARY_COPY.removeChip(chip.label)}
        onClick={chip.onRemove}
      >
        <X size={14} aria-hidden />
      </button>
    </>
  );
  if (!animated) {
    return (
      <span className="bo-chip" data-chip={chip.key}>
        {content}
      </span>
    );
  }
  return (
    <m.span
      className="bo-chip"
      data-chip={chip.key}
      variants={pop}
      initial="hidden"
      animate="shown"
      exit="hidden"
    >
      {content}
    </m.span>
  );
}
