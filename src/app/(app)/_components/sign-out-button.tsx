"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Key } from "@/design-system";
import { authClient } from "@/lib/auth-client";

/** Temporary sign-out until Ajustes (C4) owns it. */
export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function signOut() {
    setPending(true);
    setFailed(false);
    let signedOut = false;
    try {
      const { error } = await authClient.signOut();
      signedOut = !error;
    } catch {
      signedOut = false;
    } finally {
      if (!signedOut) {
        setPending(false);
        setFailed(true);
      }
    }
    if (signedOut) {
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <Key variant="ghost" icon={LogOut} onClick={signOut} disabled={pending}>
        Cerrar sesión
      </Key>
      <p role="status" className="bo-text-body-sm text-text-secondary">
        {failed ? "No se pudo cerrar la sesión. Revisa tu conexión y vuelve a probar." : ""}
      </p>
    </div>
  );
}
