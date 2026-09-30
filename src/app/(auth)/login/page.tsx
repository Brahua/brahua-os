import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Led } from "@/design-system";
import { getOwnerSession } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Iniciar sesión · brahua-os",
  robots: { index: false, follow: false },
};

export default async function LoginPage() {
  // Already signed in: go straight to the app.
  if (await getOwnerSession()) redirect("/");

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="flex w-full max-w-100 flex-col gap-8">
        <header className="flex flex-col gap-3">
          <p className="bo-text-label flex items-center gap-2 text-text-secondary">
            <Led signal on size="sm" />
            brahua-os · Acceso
          </p>
          <h1 className="bo-text-display">Iniciar sesión</h1>
          <p className="bo-text-body text-text-secondary">
            Tu sistema personal. Entra con tu email y tu contraseña, o con tu passkey.
          </p>
        </header>
        <LoginForm />
      </div>
    </main>
  );
}
