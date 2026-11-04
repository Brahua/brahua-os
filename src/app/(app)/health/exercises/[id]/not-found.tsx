import { Dumbbell } from "lucide-react";
import Link from "next/link";
import { Icon, Key } from "@/design-system";
import { StatusScreen } from "@/modules/core/components/status-screen";
import { EXERCISES_COPY as COPY } from "@/modules/health/exercises-copy";
import { EXERCISES_PATH } from "@/modules/health/routes";

/**
 * An exercise that doesn't exist, has a malformed id or was deleted: inside the shell, back to the
 * catalogue. Its title and `noindex` come from the page's generateMetadata.
 */
export default function ExerciseNotFound() {
  return (
    <StatusScreen
      lcdTag="404"
      lcdText={COPY.notFoundLcd}
      heading={COPY.notFoundHeading}
      description={COPY.notFoundText}
    >
      <Key asChild variant="signal">
        <Link href={EXERCISES_PATH}>
          <Icon icon={Dumbbell} />
          {COPY.backToList}
        </Link>
      </Key>
    </StatusScreen>
  );
}
