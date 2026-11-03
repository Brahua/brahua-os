import { NotebookPen } from "lucide-react";
import Link from "next/link";
import { Icon, Key } from "@/design-system";
import { todayNoteLabel } from "../copy";
import { dailyNotePath } from "../routes";

type TodayNoteKeyProps = {
  /** Lima's today (`YYYY-MM-DD`). */
  day: string;
  /** Whether today's note already has text: «Seguir la nota de hoy». */
  hasText: boolean;
};

/**
 * The key on Hoy's header (SPEC-notes "Hoy"): «Nota de hoy», or «Seguir la nota de hoy» when it
 * has text. A plain link (Server Component): it opens today's note, in the editor when empty.
 * Composed into `/` by src/lib/note-extensions.tsx, so `today` never imports `notes`.
 */
export function TodayNoteKey({ day, hasText }: TodayNoteKeyProps) {
  return (
    <Key asChild variant="ghost" className="w-fit">
      <Link href={dailyNotePath(day)} data-today-note-key="">
        <Icon icon={NotebookPen} />
        {todayNoteLabel(hasText)}
      </Link>
    </Key>
  );
}
