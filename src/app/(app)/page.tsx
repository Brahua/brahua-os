import { requireOwner } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { listPasskeys } from "@/modules/core/passkeys";
import { PasskeySection } from "./_components/passkey-section";
import { SignOutButton } from "./_components/sign-out-button";

/**
 * Placeholder home until the navigation shell (C3) and the `today` module. The passkey section
 * and "Cerrar sesión" are provisional too: Ajustes (C4) takes them over.
 */
export default async function Home() {
  const session = await requireOwner();
  const passkeys = await listPasskeys(getDb(), session.user.id);

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-10 px-4 py-12">
      <div className="flex flex-col items-center gap-3">
        <h1 className="bo-text-display">brahua-os</h1>
        <p className="bo-text-label text-text-secondary">Sistema personal</p>
      </div>
      <PasskeySection passkeys={passkeys} />
      <SignOutButton />
    </main>
  );
}
