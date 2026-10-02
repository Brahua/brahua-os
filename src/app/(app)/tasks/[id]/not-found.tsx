import { ListChecks } from "lucide-react";
import Link from "next/link";
import { Icon, Key } from "@/design-system";
import { StatusScreen } from "@/modules/core/components/status-screen";
import { TASKS_PATH } from "@/modules/tasks/routes";
import { TASKS_COPY } from "@/modules/tasks/tasks-copy";

/**
 * A task that doesn't exist, has a malformed id or was deleted: inside the shell, back to the
 * list. Its title and `noindex` come from the page's generateMetadata.
 */
export default function TaskNotFound() {
  return (
    <StatusScreen
      lcdTag="404"
      lcdText={TASKS_COPY.notFoundLcd}
      heading={TASKS_COPY.notFoundHeading}
      description={TASKS_COPY.notFoundText}
    >
      <Key asChild variant="signal">
        <Link href={TASKS_PATH}>
          <Icon icon={ListChecks} />
          {TASKS_COPY.backToList}
        </Link>
      </Key>
    </StatusScreen>
  );
}
