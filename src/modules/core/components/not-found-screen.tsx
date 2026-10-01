import { LogIn, Sun } from "lucide-react";
import Link from "next/link";
import { Icon, Key } from "@/design-system";
import { STATUS_COPY } from "@/modules/core/copy";
import { StatusScreen } from "./status-screen";

/** 404 content. Signed in, the way out is Hoy; signed out, the login page. */
export function NotFoundScreen({ signedIn }: { signedIn: boolean }) {
  const copy = STATUS_COPY.notFound;
  return (
    <StatusScreen
      lcdTag={copy.lcdTag}
      lcdText={copy.lcd}
      heading={copy.heading}
      description={copy.description}
    >
      <Key asChild variant="signal">
        {signedIn ? (
          <Link href="/">
            <Icon icon={Sun} />
            {STATUS_COPY.backHome}
          </Link>
        ) : (
          <Link href="/login">
            <Icon icon={LogIn} />
            {STATUS_COPY.signIn}
          </Link>
        )}
      </Key>
    </StatusScreen>
  );
}
