import type { Metadata } from "next";
import { requireOwner } from "@/lib/auth";
import { formatLongDate, greetingFor, ownerDateKey } from "@/lib/time";

export const metadata: Metadata = { title: "Hoy · brahua-os" };

/**
 * Placeholder home ("Hoy") until the `today` module. The greeting and date are rendered on the
 * server in Lima time, so the client never re-computes them (no hydration mismatch).
 */
export default async function Home() {
  await requireOwner();
  const now = new Date();

  return (
    <div className="mx-auto flex w-full max-w-(--content-max) flex-col gap-10 px-4 py-8 md:px-6 lg:py-12">
      <header className="flex flex-col gap-2">
        <p className="bo-text-label text-text-secondary">
          <time dateTime={ownerDateKey(now)}>{formatLongDate(now)}</time>
        </p>
        <h1 className="bo-text-display">{greetingFor(now)}</h1>
      </header>
    </div>
  );
}
