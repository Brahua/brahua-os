import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { E2E_ERROR_COOKIE, E2E_ERROR_MESSAGE, e2eErrorRoutesEnabled } from "@/lib/e2e-error-routes";

export const metadata: Metadata = { title: "Prueba de errores · brahua-os" };

/**
 * TEST ONLY (E2E builds; see src/lib/e2e-error-routes.ts). Throws while the error cookie is set,
 * so `(app)/error.tsx` renders inside the shell; without it, renders normally (what "Reintentar"
 * should bring back).
 */
export default async function E2eErrorPage() {
  if (!e2eErrorRoutesEnabled()) notFound();
  await requireOwner();
  const cookieStore = await cookies();
  if (cookieStore.get(E2E_ERROR_COOKIE)?.value === "1") throw new Error(E2E_ERROR_MESSAGE);

  return (
    <div className="mx-auto flex w-full max-w-(--content-max) flex-col gap-10 px-4 py-8 md:px-6 lg:py-12">
      <h1 className="bo-text-display">Todo en orden</h1>
    </div>
  );
}
