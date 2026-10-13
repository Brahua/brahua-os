import { Target } from "lucide-react";
import Link from "next/link";
import { Icon, Key } from "@/design-system";
import { StatusScreen } from "@/modules/core/components/status-screen";
import { GOALS_COPY } from "@/modules/goals/goals-copy";
import { GOALS_PATH } from "@/modules/goals/routes";

/**
 * A goal that doesn't exist, has a malformed id or was deleted: inside the shell, back to the
 * list. Its title and `noindex` come from the page's generateMetadata.
 */
export default function GoalNotFound() {
  return (
    <StatusScreen
      lcdTag="404"
      lcdText={GOALS_COPY.notFoundLcd}
      heading={GOALS_COPY.notFoundHeading}
      description={GOALS_COPY.notFoundText}
    >
      <Key asChild variant="signal">
        <Link href={GOALS_PATH}>
          <Icon icon={Target} />
          {GOALS_COPY.backToList}
        </Link>
      </Key>
    </StatusScreen>
  );
}
