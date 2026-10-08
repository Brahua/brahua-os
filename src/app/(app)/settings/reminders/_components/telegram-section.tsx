"use client";

import { Link2, Send, Unlink } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Icon, Key, Lcd, ListRow, SectionLabel } from "@/design-system";
import {
  connectTelegram,
  disconnectTelegramChat,
  getTelegramStatus,
  type TelegramLink,
} from "@/modules/reminders/actions";
import {
  TELEGRAM_CONNECT_STEPS,
  TELEGRAM_CONNECTED_MESSAGE,
  TELEGRAM_DISCONNECTED_MESSAGE,
  telegramStateText,
} from "@/modules/reminders/reminders-copy";
import type { TelegramStatus } from "@/modules/reminders/settings";

type Message = { tone: "status" | "error"; text: string };
type Pending = "connect" | "disconnect" | null;
type FocusTarget = "connect" | "disconnect" | "link" | "heading";

/** How often the page asks whether the owner already opened the link in Telegram. */
const POLL_MS = 3_000;

/**
 * Ajustes → Avisos → Telegram: shows the state, "Conectar" (registers the webhook and shows the
 * one-use link) and "Desconectar". While a link waits to be opened the page polls the state (and
 * checks again when the tab becomes visible, i.e. when the owner comes back from Telegram); the
 * timer is cleared on unmount. Controls use `aria-disabled` plus a guard, never `disabled`, so the
 * focused key keeps its focus while saving; after each change the focus is put back explicitly.
 */
export function TelegramSection({ initialStatus }: { initialStatus: TelegramStatus }) {
  const headingId = useId();
  const errorId = useId();
  const [status, setStatus] = useState(initialStatus);
  const [link, setLink] = useState<TelegramLink | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const mounted = useRef(true);
  const connectRef = useRef<HTMLButtonElement>(null);
  const disconnectRef = useRef<HTMLButtonElement>(null);
  const linkRef = useRef<HTMLAnchorElement>(null);
  const focusAfterRender = useRef<FocusTarget | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Puts the focus where the change left it (the element that had it may be gone).
  useEffect(() => {
    const target = focusAfterRender.current;
    if (!target) return;
    focusAfterRender.current = null;
    const element =
      target === "connect"
        ? connectRef.current
        : target === "disconnect"
          ? disconnectRef.current
          : target === "link"
            ? linkRef.current
            : document.getElementById(headingId);
    element?.focus();
  }, [status.state, link, headingId]);

  // While a link is waiting: ask whether it was opened. Cleared when it is, expires or unmounts.
  const waiting = link !== null && status.state !== "connected";
  useEffect(() => {
    if (!waiting || !link) return;
    const expiresAt = new Date(link.expiresAt).getTime();
    let busy = false;
    async function check() {
      if (busy) return;
      busy = true;
      try {
        const result = await getTelegramStatus({});
        if (!mounted.current || !result.ok) return;
        if (result.data.state === "connected") {
          focusAfterRender.current = "disconnect";
          setStatus(result.data);
          setLink(null);
          setMessage({ tone: "status", text: TELEGRAM_CONNECTED_MESSAGE });
        } else if (Date.now() > expiresAt) {
          focusAfterRender.current = "connect";
          setLink(null);
          setMessage({ tone: "error", text: "El enlace caducó. Genera uno nuevo." });
        }
      } catch {
        // A failed poll is not worth a message: the next one tries again.
      } finally {
        busy = false;
      }
    }
    const timer = setInterval(check, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [waiting, link]);

  async function connect() {
    // aria-disabled keeps the key focusable, so the guard lives here.
    if (pending || !status.configured) return;
    setPending("connect");
    setMessage(null);
    try {
      const result = await connectTelegram({});
      if (!mounted.current) return;
      if (!result.ok) {
        setMessage({ tone: "error", text: result.error });
        return;
      }
      focusAfterRender.current = "link";
      setLink(result.data);
    } catch {
      if (mounted.current) {
        setMessage({ tone: "error", text: "No se pudo conectar. Inténtalo de nuevo." });
      }
    } finally {
      if (mounted.current) setPending(null);
    }
  }

  async function disconnect() {
    if (pending) return;
    setPending("disconnect");
    setMessage(null);
    try {
      const result = await disconnectTelegramChat({});
      if (!mounted.current) return;
      if (!result.ok) {
        setMessage({ tone: "error", text: result.error });
        return;
      }
      focusAfterRender.current = "connect";
      setStatus(result.data);
      setLink(null);
      setMessage({ tone: "status", text: TELEGRAM_DISCONNECTED_MESSAGE });
    } catch {
      if (mounted.current) {
        setMessage({ tone: "error", text: "No se pudo desconectar. Inténtalo de nuevo." });
      }
    } finally {
      if (mounted.current) setPending(null);
    }
  }

  const connected = status.state === "connected";

  return (
    <section aria-labelledby={headingId} className="flex w-full max-w-100 flex-col gap-4">
      <SectionLabel as="h2" id={headingId} tabIndex={-1} title="Telegram" />
      <p className="bo-text-body-sm text-text-secondary">
        Recibe tus avisos en un chat con el bot de brahua-os.
      </p>

      <div className="bo-list">
        <ListRow
          leading={<Icon icon={Send} size="md" />}
          title="Estado"
          subtitle={telegramStateText(status.state, status.linkedLabel)}
        />
      </div>

      {!status.configured ? (
        <div className="flex flex-col gap-2">
          <Lcd tag={<span aria-hidden>Bot</span>} live={false}>
            El bot todavía no está configurado en el servidor.
          </Lcd>
          <ul className="bo-text-body-sm list-disc pl-5 text-text-secondary">
            {status.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {connected ? (
        // aria-disabled, not disabled: the focused key keeps its focus while waiting.
        <Key
          ref={disconnectRef}
          icon={Unlink}
          block
          aria-disabled={pending !== null}
          onClick={disconnect}
        >
          {pending === "disconnect" ? "Desconectando…" : "Desconectar"}
        </Key>
      ) : link ? (
        <div className="flex flex-col gap-3">
          <p className="bo-text-body-sm">{TELEGRAM_CONNECT_STEPS}</p>
          <Key asChild icon={Send} block>
            <a ref={linkRef} href={link.url} target="_blank" rel="noopener noreferrer">
              Abrir Telegram
            </a>
          </Key>
          <Key ref={connectRef} variant="ghost" aria-disabled={pending !== null} onClick={connect}>
            {pending === "connect" ? "Generando…" : "Generar otro enlace"}
          </Key>
        </div>
      ) : (
        <Key
          ref={connectRef}
          icon={Link2}
          block
          aria-disabled={pending !== null || !status.configured}
          className={!status.configured ? "is-disabled" : undefined}
          aria-describedby={message?.tone === "error" ? errorId : undefined}
          onClick={connect}
        >
          {pending === "connect" ? "Conectando…" : "Conectar Telegram"}
        </Key>
      )}

      {/* Always rendered, so screen readers announce messages as soon as they appear. */}
      <p role="status" className="bo-text-body-sm text-text-secondary">
        {message?.tone === "status" ? message.text : ""}
      </p>
      <div role="alert" aria-atomic="true">
        {message?.tone === "error" ? (
          <Lcd id={errorId} tag={<span aria-hidden>Telegram</span>} live={false}>
            {message.text}
          </Lcd>
        ) : null}
      </div>
    </section>
  );
}
