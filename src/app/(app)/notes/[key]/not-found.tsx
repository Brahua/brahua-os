import { NotebookPen } from "lucide-react";
import Link from "next/link";
import { Icon, Key } from "@/design-system";
import { StatusScreen } from "@/modules/core/components/status-screen";
import { NOTES_COPY as COPY } from "@/modules/notes/copy";
import { NOTES_PATH } from "@/modules/notes/routes";

/**
 * A note that doesn't exist, was deleted, or a day that is malformed or hasn't come yet: inside
 * the shell, back to the list. Its title and `noindex` come from the page's generateMetadata.
 */
export default function NoteNotFound() {
  return (
    <StatusScreen
      lcdTag="404"
      lcdText={COPY.notFoundLcd}
      heading={COPY.notFoundHeading}
      description={COPY.notFoundText}
    >
      <Key asChild variant="signal">
        <Link href={NOTES_PATH}>
          <Icon icon={NotebookPen} />
          {COPY.backToList}
        </Link>
      </Key>
    </StatusScreen>
  );
}
