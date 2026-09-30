import { requireOwner } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { formatLongDate, greetingFor, ownerDateKey } from "@/lib/time";
import { listPasskeys } from "@/modules/core/passkeys";
import { PasskeySection } from "./_components/passkey-section";
import { SignOutButton } from "./_components/sign-out-button";

/**
 * Placeholder home ("Hoy") until the `today` module. The greeting and date are rendered on the
 * server in Lima time, so the client never re-computes them (no hydration mismatch).
 * The passkey section and "Cerrar sesión" are provisional too: Ajustes (C4) takes them over.
 */
export default async function Home() {
  const session = await requireOwner();
  const passkeys = await listPasskeys(getDb(), session.user.id);
  const now = new Date();

  return (
    <div className="mx-auto flex w-full max-w-(--content-max) flex-col gap-10 px-4 py-8 md:px-6 lg:py-12">
      <header className="flex flex-col gap-2">
        <p className="bo-text-label text-text-secondary">
          <time dateTime={ownerDateKey(now)}>{formatLongDate(now)}</time>
        </p>
        <h1 className="bo-text-display">{greetingFor(now)}</h1>
      </header>
      <PasskeySection passkeys={passkeys} />
      <div className="w-full max-w-100">
        <SignOutButton />
      </div>
    </div>
  );
}
