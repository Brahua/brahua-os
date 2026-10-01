import { FolderKanban } from "lucide-react";
import Link from "next/link";
import { Icon, Key } from "@/design-system";
import { StatusScreen } from "@/modules/core/components/status-screen";
import { PROJECTS_COPY } from "@/modules/projects/projects-copy";

/**
 * A project that doesn't exist, has a malformed id or was deleted: inside the shell, back to the
 * list. Its title and `noindex` come from the page's generateMetadata.
 */
export default function ProjectNotFound() {
  return (
    <StatusScreen
      lcdTag="404"
      lcdText={PROJECTS_COPY.notFoundLcd}
      heading={PROJECTS_COPY.notFoundHeading}
      description={PROJECTS_COPY.notFoundText}
    >
      <Key asChild variant="signal">
        <Link href="/projects">
          <Icon icon={FolderKanban} />
          {PROJECTS_COPY.backToList}
        </Link>
      </Key>
    </StatusScreen>
  );
}
