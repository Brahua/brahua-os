import { GraduationCap } from "lucide-react";
import Link from "next/link";
import { Icon, Key } from "@/design-system";
import { StatusScreen } from "@/modules/core/components/status-screen";
import { LEARNING_COPY as COPY } from "@/modules/learning/learning-copy";
import { LEARNING_PATH } from "@/modules/learning/routes";

/**
 * A track that doesn't exist, has a malformed id or was deleted: inside the shell, back to the
 * list. Its title and `noindex` come from the page's generateMetadata.
 */
export default function TrackNotFound() {
  return (
    <StatusScreen
      lcdTag="404"
      lcdText={COPY.notFoundLcd}
      heading={COPY.notFoundHeading}
      description={COPY.notFoundText}
    >
      <Key asChild variant="signal">
        <Link href={LEARNING_PATH}>
          <Icon icon={GraduationCap} />
          {COPY.backToList}
        </Link>
      </Key>
    </StatusScreen>
  );
}
