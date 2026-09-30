"use client";

import { KeyRound, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Icon, Key, Lcd, ListRow, SectionLabel, TextField } from "@/design-system";
import { authClient } from "@/lib/auth-client";
import { PASSKEY_NAME_MAX_LENGTH } from "@/lib/auth-env";
import {
  PASSKEY_DELETE_FAILED_MESSAGE,
  PASSKEY_DELETED_MESSAGE,
  PASSKEY_NAME_FAILED_MESSAGE,
  PASSKEY_REGISTER_FAILED_MESSAGE,
  PASSKEY_REGISTER_UNSUPPORTED_MESSAGE,
  PASSKEY_REGISTERED_MESSAGE,
  passkeyDeleteErrorMessage,
  passkeyRegisterErrorMessage,
} from "@/lib/passkey-messages";
import { usePasskeySupport } from "@/lib/passkey-support";
import type { PasskeySummary } from "@/modules/core/passkeys";

type Message = { tone: "status" | "error"; text: string };
type Pending = "register" | "delete" | null;

/**
 * Temporary passkey management on the home page until Ajustes (C4) takes it over: register a
 * passkey for this device, list the existing ones and delete them. Every change needs the owner
 * session, signed in less than 10 minutes ago (the server checks both).
 */
export function PasskeySection({ passkeys }: { passkeys: PasskeySummary[] }) {
  const router = useRouter();
  const headingId = useId();
  const noteId = useId();
  const errorId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const deleteButtons = useRef(new Map<string, HTMLButtonElement | null>());
  const [pending, setPending] = useState<Pending>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const supported = usePasskeySupport();

  async function register(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // aria-disabled keeps the button focusable, so the guard lives here.
    if (pending || !supported) return;
    const name = String(new FormData(event.currentTarget).get("name") ?? "").trim();
    setPending("register");
    setMessage(null);
    setConfirming(null);
    try {
      // No `name` here: the plugin would use it as the account name in the device's keychain,
      // which should stay the owner's email. The label is set afterwards.
      const { data, error } = await authClient.passkey.addPasskey();
      if (error || !data) {
        // Closing the browser prompt is not an error: nothing is announced.
        const text = passkeyRegisterErrorMessage(error);
        if (text) setMessage({ tone: "error", text });
        return;
      }
      if (name) {
        const renamed = await authClient.passkey
          .updatePasskey({ id: data.id, name })
          .catch(() => ({ error: true }));
        if (renamed.error) {
          setMessage({ tone: "error", text: PASSKEY_NAME_FAILED_MESSAGE });
          router.refresh();
          return;
        }
      }
      setMessage({ tone: "status", text: PASSKEY_REGISTERED_MESSAGE });
      if (nameRef.current) nameRef.current.value = "";
      router.refresh();
    } catch {
      setMessage({ tone: "error", text: PASSKEY_REGISTER_FAILED_MESSAGE });
    } finally {
      setPending(null);
    }
  }

  function cancelDelete(id: string) {
    setConfirming(null);
    deleteButtons.current.get(id)?.focus();
  }

  async function confirmDelete(passkey: PasskeySummary) {
    if (pending) return;
    setPending("delete");
    setMessage(null);
    try {
      const { error } = await authClient.passkey.deletePasskey({ id: passkey.id });
      if (error) {
        setMessage({ tone: "error", text: passkeyDeleteErrorMessage(error) });
        return;
      }
      setConfirming(null);
      setMessage({ tone: "status", text: PASSKEY_DELETED_MESSAGE });
      // The row is gone: the focus goes to the section heading instead of the page body.
      document.getElementById(headingId)?.focus();
      router.refresh();
    } catch {
      setMessage({ tone: "error", text: PASSKEY_DELETE_FAILED_MESSAGE });
    } finally {
      setPending(null);
    }
  }

  return (
    <section aria-labelledby={headingId} className="flex w-full max-w-100 flex-col gap-4">
      <SectionLabel
        as="h2"
        id={headingId}
        tabIndex={-1}
        // Read as "Passkeys, 2 en total", never "Passkeys2": the spoken count lives in the title
        // (no edge whitespace to lose) and the visual one is hidden from screen readers.
        title={
          <>
            Passkeys<span className="sr-only">, {passkeys.length} en total</span>
          </>
        }
        count={<span aria-hidden>{passkeys.length}</span>}
      />
      <p className="bo-text-body-sm text-text-secondary">
        Entra sin contraseña con Face ID, Touch ID, Windows Hello o el bloqueo de pantalla de tu
        dispositivo.
      </p>

      {passkeys.length > 0 ? (
        <ul className="bo-list" aria-label="Tus passkeys">
          {passkeys.map((passkey) => {
            const open = confirming === passkey.id;
            return (
              <li key={passkey.id} className="flex flex-col">
                <ListRow
                  leading={<Icon icon={KeyRound} size="md" />}
                  title={passkey.label}
                  subtitle={
                    <>
                      Creada el <time dateTime={passkey.createdAt}>{passkey.createdLabel}</time>
                    </>
                  }
                  trailing={
                    <Key
                      ref={(element) => {
                        deleteButtons.current.set(passkey.id, element);
                      }}
                      variant="ghost"
                      icon={Trash2}
                      // The visible "Eliminar" starts the name (label in name).
                      aria-label={`Eliminar ${passkey.label}`}
                      aria-expanded={open}
                      aria-disabled={pending !== null}
                      onClick={() => {
                        if (pending) return;
                        setMessage(null);
                        setConfirming(open ? null : passkey.id);
                      }}
                    >
                      Eliminar
                    </Key>
                  }
                />
                {open ? (
                  <DeleteConfirmation
                    label={passkey.label}
                    pending={pending === "delete"}
                    describedBy={message?.tone === "error" ? errorId : undefined}
                    onConfirm={() => confirmDelete(passkey)}
                    onCancel={() => cancelDelete(passkey.id)}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="bo-text-body-sm text-text-secondary">Todavía no tienes passkeys.</p>
      )}

      <form noValidate onSubmit={register} className="flex flex-col gap-3">
        <TextField
          ref={nameRef}
          name="name"
          label="Nombre (opcional)"
          help="Para reconocerla en esta lista, por ejemplo «iPhone» o «MacBook»."
          maxLength={PASSKEY_NAME_MAX_LENGTH}
          autoComplete="off"
        />
        {/* aria-disabled, not disabled: the focused key keeps its focus while waiting. */}
        <Key
          type="submit"
          icon={Plus}
          block
          aria-disabled={pending !== null || supported === false}
          className={supported === false ? "is-disabled" : undefined}
          aria-describedby={
            supported === false
              ? noteId
              : message?.tone === "error" && !confirming
                ? errorId
                : undefined
          }
        >
          {pending === "register" ? "Esperando la passkey…" : "Registrar passkey"}
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
          <Lcd id={errorId} tag={<span aria-hidden>Passkey</span>} live={false}>
            {message.text}
          </Lcd>
        ) : null}
      </div>
    </section>
  );
}

/** In-page confirmation (no window.confirm): the safe choice, "Cancelar", gets the focus. */
function DeleteConfirmation({
  label,
  pending,
  describedBy,
  onConfirm,
  onCancel,
}: {
  label: string;
  pending: boolean;
  describedBy?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const textId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  // Moves the focus into the confirmation once, when it opens.
  useEffect(() => cancelRef.current?.focus(), []);
  return (
    <div
      role="group"
      aria-labelledby={textId}
      className="flex flex-col gap-3 bg-surface px-4 py-3"
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
    >
      <p id={textId} className="bo-text-body-sm">
        ¿Eliminar «{label}»? Ya no podrás entrar con ella.
      </p>
      <div className="flex gap-2">
        <Key
          icon={Trash2}
          aria-disabled={pending}
          aria-describedby={describedBy}
          onClick={() => {
            if (!pending) onConfirm();
          }}
        >
          {pending ? "Eliminando…" : "Sí, eliminar"}
        </Key>
        <Key
          variant="ghost"
          ref={cancelRef}
          onClick={() => {
            if (!pending) onCancel();
          }}
        >
          Cancelar
        </Key>
      </div>
    </div>
  );
}
