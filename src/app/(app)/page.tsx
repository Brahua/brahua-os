import { requireOwner } from "@/lib/auth";
import { SignOutButton } from "./_components/sign-out-button";

/** Placeholder home until the navigation shell (C3) and the `today` module. */
export default async function Home() {
  await requireOwner();

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4">
      <div className="flex flex-col items-center gap-3">
        <h1 className="bo-text-display">brahua-os</h1>
        <p className="bo-text-label text-text-secondary">Sistema personal</p>
      </div>
      <SignOutButton />
    </main>
  );
}
