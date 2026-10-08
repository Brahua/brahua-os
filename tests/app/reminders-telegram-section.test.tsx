import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { TelegramSection } from "@/app/(app)/settings/reminders/_components/telegram-section";
import type { TelegramStatus } from "@/modules/reminders/settings";

const actions = vi.hoisted(() => ({
  connectTelegram: vi.fn(),
  disconnectTelegramChat: vi.fn(),
  getTelegramStatus: vi.fn(),
}));
vi.mock("@/modules/reminders/actions", () => actions);

const DISCONNECTED: TelegramStatus = {
  state: "disconnected",
  linkedLabel: null,
  configured: true,
  problems: [],
};
const CONNECTED: TelegramStatus = {
  state: "connected",
  linkedLabel: "3 oct. 2026",
  configured: true,
  problems: [],
};
const LINK = {
  url: "https://t.me/brahua_bot?start=ABCD2345",
  expiresAt: "2999-01-01T00:00:00.000Z",
};

/** A promise the test settles by hand, to look at the "saving" state. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

beforeEach(() => {
  actions.connectTelegram.mockReset();
  actions.disconnectTelegramChat.mockReset();
  actions.getTelegramStatus.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

const connectKey = () => screen.getByRole("button", { name: /Conectar Telegram|Conectando/ });

describe("the state", () => {
  test("a disconnected bot offers to connect, with the state in words", () => {
    render(<TelegramSection initialStatus={DISCONNECTED} />);
    expect(screen.getByRole("heading", { level: 2, name: "Telegram" })).toBeVisible();
    expect(screen.getByText("Sin conectar.")).toBeVisible();
    expect(connectKey()).toHaveAccessibleName("Conectar Telegram");
    expect(screen.queryByRole("button", { name: "Desconectar" })).toBeNull();
  });

  test("marks itself hydrated once its effects have run (the E2E waits for it before clicking)", () => {
    render(<TelegramSection initialStatus={DISCONNECTED} />);
    expect(screen.getByRole("region", { name: "Telegram" })).toHaveAttribute(
      "data-telegram-ready",
      "true",
    );
  });

  test("a connected bot says since when and offers to disconnect", () => {
    render(<TelegramSection initialStatus={CONNECTED} />);
    expect(screen.getByText("Conectado desde el 3 oct. 2026.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Desconectar" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Conectar Telegram/ })).toBeNull();
  });

  test("a blocked bot says so", () => {
    render(<TelegramSection initialStatus={{ ...DISCONNECTED, state: "blocked" }} />);
    expect(screen.getByText(/Telegram bloqueó el envío/)).toBeVisible();
    expect(connectKey()).toBeVisible();
  });

  test("without the server's variables it lists them and cannot connect", () => {
    render(
      <TelegramSection
        initialStatus={{
          ...DISCONNECTED,
          configured: false,
          problems: ["TELEGRAM_BOT_TOKEN falta", "TELEGRAM_WEBHOOK_SECRET falta"],
        }}
      />,
    );
    expect(screen.getByText("El bot todavía no está configurado en el servidor.")).toBeVisible();
    expect(screen.getByText("TELEGRAM_BOT_TOKEN falta")).toBeVisible();
    expect(screen.getByText("TELEGRAM_WEBHOOK_SECRET falta")).toBeVisible();
    const key = connectKey();
    expect(key).toHaveAttribute("aria-disabled", "true");
    expect(key).not.toBeDisabled();
    fireEvent.click(key);
    expect(actions.connectTelegram).not.toHaveBeenCalled();
  });
});

describe("Conectar", () => {
  test("while it works the key says so, keeps its focus (aria-disabled, never disabled) and ignores a second press", async () => {
    const pending = deferred<unknown>();
    actions.connectTelegram.mockReturnValue(pending.promise);
    render(<TelegramSection initialStatus={DISCONNECTED} />);
    const key = connectKey();
    key.focus();

    fireEvent.click(key);
    expect(key).toHaveTextContent("Conectando…");
    expect(key).toHaveAttribute("aria-disabled", "true");
    expect(key).not.toBeDisabled();
    expect(key).toHaveFocus();
    fireEvent.click(key);
    expect(actions.connectTelegram).toHaveBeenCalledTimes(1);

    await act(async () => pending.resolve({ ok: true, data: LINK }));
  });

  test("shows the one-use link and moves the focus to it", async () => {
    actions.connectTelegram.mockResolvedValue({ ok: true, data: LINK });
    render(<TelegramSection initialStatus={DISCONNECTED} />);
    fireEvent.click(connectKey());

    const open = await screen.findByRole("link", { name: "Abrir Telegram" });
    expect(open).toHaveAttribute("href", LINK.url);
    expect(open).toHaveAttribute("target", "_blank");
    expect(open).toHaveAttribute("rel", "noopener noreferrer");
    expect(open).toHaveFocus();
    expect(screen.getByText(/caduca en 10 minutos/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Conectar Telegram" })).toBeNull();
    expect(screen.getByRole("button", { name: "Generar otro enlace" })).toBeVisible();
  });

  test("a refusal is announced in an alert and the key comes back", async () => {
    actions.connectTelegram.mockResolvedValue({
      ok: false,
      error: "Telegram no aceptó el registro del bot. Revisa el token e inténtalo de nuevo.",
    });
    render(<TelegramSection initialStatus={DISCONNECTED} />);
    fireEvent.click(connectKey());

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Telegram no aceptó el registro"),
    );
    expect(connectKey()).toHaveAttribute("aria-disabled", "false");
    expect(connectKey()).toHaveAccessibleDescription(/Telegram no aceptó el registro/);
    expect(screen.queryByRole("link", { name: "Abrir Telegram" })).toBeNull();
  });

  test("an unexpected failure gets a calm message", async () => {
    actions.connectTelegram.mockRejectedValue(new Error("network"));
    render(<TelegramSection initialStatus={DISCONNECTED} />);
    fireEvent.click(connectKey());
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("No se pudo conectar"));
  });
});

describe("waiting for the link to be opened", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // jsdom may report the tab as not visible: the component only reacts to a visible one.
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    actions.connectTelegram.mockResolvedValue({ ok: true, data: LINK });
  });

  async function connectAndWait() {
    render(<TelegramSection initialStatus={DISCONNECTED} />);
    await act(async () => {
      fireEvent.click(connectKey());
    });
    expect(screen.getByRole("link", { name: "Abrir Telegram" })).toBeVisible();
  }

  test("polls every 3 s and, once connected, says so and focuses Desconectar", async () => {
    actions.getTelegramStatus
      .mockResolvedValueOnce({ ok: true, data: DISCONNECTED })
      .mockResolvedValue({ ok: true, data: CONNECTED });
    await connectAndWait();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(actions.getTelegramStatus).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "Abrir Telegram" })).toBeVisible();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(screen.getByRole("status")).toHaveTextContent("Telegram quedó conectado.");
    expect(screen.getByText("Conectado desde el 3 oct. 2026.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Desconectar" })).toHaveFocus();
    expect(screen.queryByRole("link", { name: "Abrir Telegram" })).toBeNull();

    // It stops asking once connected.
    const calls = actions.getTelegramStatus.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(actions.getTelegramStatus).toHaveBeenCalledTimes(calls);
  });

  test("checks again at once when the tab becomes visible (the owner is back from Telegram)", async () => {
    actions.getTelegramStatus.mockResolvedValue({ ok: true, data: CONNECTED });
    await connectAndWait();
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(actions.getTelegramStatus).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Desconectar" })).toBeVisible();
  });

  test("clears its timer and listener when the page goes away", async () => {
    actions.getTelegramStatus.mockResolvedValue({ ok: true, data: DISCONNECTED });
    const { unmount } = render(<TelegramSection initialStatus={DISCONNECTED} />);
    await act(async () => {
      fireEvent.click(connectKey());
    });
    expect(screen.getByRole("link", { name: "Abrir Telegram" })).toBeVisible();

    const clear = vi.spyOn(globalThis, "clearInterval");
    unmount();
    expect(clear).toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(actions.getTelegramStatus).not.toHaveBeenCalled();
  });

  test("a link that expired while waiting is dropped with a message and the key to ask again", async () => {
    actions.connectTelegram.mockResolvedValue({
      ok: true,
      data: { ...LINK, expiresAt: new Date(Date.now() + 5_000).toISOString() },
    });
    actions.getTelegramStatus.mockResolvedValue({ ok: true, data: DISCONNECTED });
    await connectAndWait();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_000);
    });
    expect(screen.queryByRole("link", { name: "Abrir Telegram" })).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("El enlace caducó");
    expect(screen.getByRole("button", { name: "Conectar Telegram" })).toHaveFocus();
  });
});

describe("Desconectar", () => {
  test("disconnects, says so, and puts the focus on Conectar (the key that had it is gone)", async () => {
    actions.disconnectTelegramChat.mockResolvedValue({ ok: true, data: DISCONNECTED });
    render(<TelegramSection initialStatus={CONNECTED} />);
    const key = screen.getByRole("button", { name: "Desconectar" });
    key.focus();
    fireEvent.click(key);

    expect(await screen.findByText("Sin conectar.")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Telegram quedó desconectado.");
    expect(screen.getByRole("button", { name: "Conectar Telegram" })).toHaveFocus();
  });

  test("ignores a second press while it works and never uses `disabled`", async () => {
    const pending = deferred<unknown>();
    actions.disconnectTelegramChat.mockReturnValue(pending.promise);
    render(<TelegramSection initialStatus={CONNECTED} />);
    const key = screen.getByRole("button", { name: "Desconectar" });
    fireEvent.click(key);
    expect(key).toHaveTextContent("Desconectando…");
    expect(key).toHaveAttribute("aria-disabled", "true");
    expect(key).not.toBeDisabled();
    fireEvent.click(key);
    expect(actions.disconnectTelegramChat).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve({ ok: true, data: DISCONNECTED }));
  });

  test("a refusal keeps it connected and says why", async () => {
    actions.disconnectTelegramChat.mockResolvedValue({
      ok: false,
      error: "Tu sesión terminó. Vuelve a entrar para guardar los cambios.",
    });
    render(<TelegramSection initialStatus={CONNECTED} />);
    fireEvent.click(screen.getByRole("button", { name: "Desconectar" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Tu sesión terminó"));
    expect(screen.getByText("Conectado desde el 3 oct. 2026.")).toBeVisible();
  });
});
