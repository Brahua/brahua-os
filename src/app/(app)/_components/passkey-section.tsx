"use client";

import { KeyRound, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { Icon, Key, Lcd, ListRow, SectionLabel, TextField } from "@/design-system";
import { authClient } from "@/lib/auth-client";
import {
  PASSKEY_REGISTER_FAILED_MESSAGE,
  PASSKEY_REGISTER_UNSUPPORTED_MESSAGE,
  PASSKEY_REGISTERED_MESSAGE,
  passkeyRegisterErrorMessage,
} from "@/lib/passkey-messages";
import { usePasskeySupport } from "@/lib/passkey-support";
import type { PasskeySummary } from "@/modules/core/passkeys";

export const PASSKEY_NAME_MAX_LENGTH = 50;

type Message = { tone: "status" | "error"; text: string };

/**
 * Temporary passkey management on the home page until Ajustes (C4) owns it: register a passkey
 * for this device and list the existing ones. Registering needs the owner session (the endpoint
 * checks it) and a recent sign-in.
 */
export function PasskeySection({ passkeys }: { passkeys: PasskeySummary[] }) {
  const router = useRouter();
  const headingId = useId();
  const noteId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const supported = usePasskeySupport();

  async function register(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const name = String(new FormData(event.currentTarget).get("name") ?? "").trim();
    setPending(true);
    setMessage(null);
    try {
      const { error } = await authClient.passkey.addPasskey(name ? { name } : undefined);
      if (!error) {
        setMessage({ tone: "status", text: PASSKEY_REGISTERED_MESSAGE });
        if (nameRef.current) nameRef.current.value = "";
        router.refresh();
      } else {
        // Closing the browser prompt is not an error: nothing is announced.
        const text = passkeyRegisterErrorMessage(error);
        if (text) setMessage({ tone: "error", text });
      }
    } catch {
      setMessage({ tone: "error", text: PASSKEY_REGISTER_FAILED_MESSAGE });
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby={headingId} className="flex w-full max-w-100 flex-col gap-4">
      <SectionLabel as="h2" id={headingId} title="Passkeys" count={passkeys.length} />
      <p className="bo-text-body-sm text-text-secondary">
        Entra sin contraseña con Face ID, Touch ID, Windows Hello o el bloqueo de pantalla de tu
        dispositivo.
      </p>

      {passkeys.length > 0 ? (
        <ul className="bo-list" aria-labelledby={headingId}>
          {passkeys.map((passkey) => (
            <li key={passkey.id}>
              <ListRow
                compact
                leading={<Icon icon={KeyRound} size="md" />}
                title={passkey.label}
                subtitle={
                  <>
                    Creada el <time dateTime={passkey.createdAt}>{passkey.createdLabel}</time>
                  </>
                }
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="bo-text-body-sm text-text-secondary">Todavía no tienes passkeys.</p>
      )}

      <form noValidate onSubmit={register} className="flex flex-col gap-3" aria-busy={pending}>
        <TextField
          ref={nameRef}
          name="name"
          label="Nombre (opcional)"
          help="Para reconocerla después, por ejemplo «iPhone» o «MacBook»."
          maxLength={PASSKEY_NAME_MAX_LENGTH}
          autoComplete="off"
          disabled={supported === false}
        />
        <Key
          type="submit"
          icon={Plus}
          block
          disabled={pending || supported === false}
          aria-describedby={supported === false ? noteId : undefined}
        >
          {pending ? "Esperando la passkey…" : "Registrar passkey"}
        </Key>
        {supported === false ? (
          <p id={noteId} className="bo-text-body-sm text-text-secondary">
            {PASSKEY_REGISTER_UNSUPPORTED_MESSAGE}
          </p>
        ) : null}
      </form>

      {/* Always rendered, so screen readers announce messages as soon as they appear. */}
      <p role="status" className="bo-text-body-sm text-text-secondary">
        {message?.tone === "status" ? message.text : ""}
      </p>
      <div role="alert" aria-atomic="true">
        {message?.tone === "error" ? (
          <Lcd tag={<span aria-hidden>Passkey</span>} live={false}>
            {message.text}
          </Lcd>
        ) : null}
      </div>
    </section>
  );
}
