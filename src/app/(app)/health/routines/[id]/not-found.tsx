import { Dumbbell } from "lucide-react";
import Link from "next/link";
import { Icon, Key } from "@/design-system";
import { StatusScreen } from "@/modules/core/components/status-screen";
import { HEALTH_PATH } from "@/modules/health/routes";
import { ROUTINES_COPY as COPY } from "@/modules/health/routines-copy";

/**
 * A routine that doesn't exist, has a malformed id or was deleted: inside the shell, back to
 * /health. Its title and `noindex` come from the page's generateMetadata.
 */
export default function RoutineNotFound() {
  return (
    <StatusScreen
      lcdTag="404"
      lcdText={COPY.notFoundLcd}
      heading={COPY.notFoundHeading}
      description={COPY.notFoundText}
    >
      <Key asChild variant="signal">
        <Link href={HEALTH_PATH}>
          <Icon icon={Dumbbell} />
          {COPY.backToHealth}
        </Link>
      </Key>
    </StatusScreen>
  );
}
