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

  async function signOut() {
    setPending(true);
    await authClient.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <Key variant="ghost" icon={LogOut} onClick={signOut} disabled={pending}>
      Cerrar sesión
    </Key>
  );
}
