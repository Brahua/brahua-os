"use client";

import { NotebookPen } from "lucide-react";
import Link from "next/link";
import { Icon, Kbd, keyClasses, type KeyVariant } from "@/design-system";
import { useIsDesktop } from "@/lib/use-is-desktop";
import { todayNoteLabel } from "../copy";
import { dailyNotePath } from "../routes";

type TodayNoteKeyProps = {
  /** Lima's today (`YYYY-MM-DD`). */
  day: string;
  /** Whether today's note already has text: «Seguir la nota de hoy». */
  hasText: boolean;
  /** Single-key shortcuts on: the key shows `N` (from 1024 px, where the key works). */
  shortcuts: boolean;
  variant?: KeyVariant;
  className?: string;
};

/**
 * «Nota de hoy», or «Seguir la nota de hoy» when it has text (SPEC-notes "Hoy"): a link styled as a
 * key that opens today's note (in the editor when empty). With shortcuts on it shows the `N` hint
 * and names it in `aria-keyshortcuts`, only from 1024 px (the app's keys act there only). Used on
 * Hoy's header (through src/lib/note-extensions.tsx, so `today` never imports `notes`) and on
 * /notes.
 */
export function TodayNoteKey({
  day,
  hasText,
  shortcuts,
  variant = "ghost",
  className,
}: TodayNoteKeyProps) {
  const isDesktop = useIsDesktop();
  return (
    <Link
      href={dailyNotePath(day)}
      className={keyClasses({ variant, className: className ?? "w-fit" })}
      aria-keyshortcuts={shortcuts && isDesktop ? "N" : undefined}
      data-today-note-key=""
    >
      <Icon icon={NotebookPen} />
      {todayNoteLabel(hasText)}
      {shortcuts ? (
        // The wrapper hides it below 1024 px (the design system's own class sets the kbd's display).
        <span aria-hidden className="hidden lg:inline-flex">
          <Kbd keys="N" tone={variant === "signal" ? "signal" : "default"} />
        </span>
      ) : null}
    </Link>
  );
}
