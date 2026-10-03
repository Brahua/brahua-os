import { Repeat } from "lucide-react";
import Link from "next/link";
import { Icon, Key } from "@/design-system";
import { StatusScreen } from "@/modules/core/components/status-screen";
import { HISTORY_COPY } from "@/modules/habits/history-copy";
import { HABITS_PATH } from "@/modules/habits/routes";

/**
 * A habit that doesn't exist, has a malformed id or was deleted: inside the shell, back to the
 * list. Its title and `noindex` come from the page's generateMetadata.
 */
export default function HabitNotFound() {
  return (
    <StatusScreen
      lcdTag="404"
      lcdText={HISTORY_COPY.notFoundLcd}
      heading={HISTORY_COPY.notFoundHeading}
      description={HISTORY_COPY.notFoundText}
    >
      <Key asChild variant="signal">
        <Link href={HABITS_PATH}>
          <Icon icon={Repeat} />
          {HISTORY_COPY.backToList}
        </Link>
      </Key>
    </StatusScreen>
  );
}
