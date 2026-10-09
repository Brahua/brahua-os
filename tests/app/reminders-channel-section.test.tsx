import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ChannelSection } from "@/app/(app)/settings/reminders/_components/channel-section";
import type { ChannelSummary } from "@/modules/reminders/settings";

const actions = vi.hoisted(() => ({
  getPushDeviceState: vi.fn(),
  setDeliveryChannel: vi.fn(),
  subscribePushDevice: vi.fn(),
  unsubscribePushDevice: vi.fn(),
}));
vi.mock("@/modules/reminders/actions", () => actions);

const PUBLIC_KEY = "B".padEnd(87, "A");
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc";
const KEYS = { p256dh: "p".repeat(87), auth: "a".repeat(22) };

const BASE: ChannelSummary = {
  deliveryChannel: "push",
  pushConfigured: true,
  pushProblems: [],
  vapidPublicKey: PUBLIC_KEY,
  devices: [],
  telegramConnected: false,
};
const WITH_DEVICE: ChannelSummary = {
  ...BASE,
  devices: [{ id: "d1", label: "Mac · Chrome", sinceLabel: "3 oct. 2026" }],
};

/** What the page would show once the server holds this device. */
const summaryWith = (overrides: Partial<ChannelSummary> = {}): ChannelSummary => ({
  ...WITH_DEVICE,
  ...overrides,
});

type Fake = {
  permission: NotificationPermission;
  subscription: ReturnType<typeof makeSubscription> | null;
  register: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
};

function makeSubscription(key?: ArrayBuffer | null) {
  return {
    endpoint: ENDPOINT,
    options: { applicationServerKey: key ?? null },
    toJSON: () => ({ endpoint: ENDPOINT, keys: KEYS }),
    unsubscribe: vi.fn(async () => true),
  };
}

/** A browser with service workers, push and notifications; `installed` is the display mode. */
function installBrowser(
  options: {
    permission?: NotificationPermission;
    requestResult?: NotificationPermission;
    subscription?: ReturnType<typeof makeSubscription> | null;
    userAgent?: string;
    standalone?: boolean;
    withPushManager?: boolean;
    withServiceWorker?: boolean;
  } = {},
): Fake {
  const fake: Fake = {
    permission: options.permission ?? "default",
    subscription: options.subscription ?? null,
    register: vi.fn(),
    subscribe: vi.fn(),
  };
  const registration = {
    pushManager: {
      getSubscription: vi.fn(async () => fake.subscription),
      subscribe: fake.subscribe,
    },
  };
  fake.subscribe.mockImplementation(async () => {
    fake.subscription = makeSubscription();
    return fake.subscription;
  });
  fake.register.mockImplementation(async () => registration);

  const define = (target: object, key: string, value: unknown) =>
    Object.defineProperty(target, key, { value, configurable: true, writable: true });

  if (options.withServiceWorker !== false) {
    define(navigator, "serviceWorker", {
      register: fake.register,
      ready: Promise.resolve(registration),
      getRegistration: vi.fn(async () => (fake.subscription ? registration : undefined)),
    });
  } else {
    delete (navigator as unknown as Record<string, unknown>).serviceWorker;
  }
  if (options.withPushManager !== false) define(window, "PushManager", class PushManager {});
  else delete (window as unknown as Record<string, unknown>).PushManager;
  define(window, "Notification", {
    get permission() {
      return fake.permission;
    },
    requestPermission: vi.fn(async () => {
      fake.permission = options.requestResult ?? "granted";
      return fake.permission;
    }),
  });
  if (options.userAgent) define(navigator, "userAgent", options.userAgent);
  window.matchMedia = ((query: string) => ({
    matches: query === "(display-mode: standalone)" ? (options.standalone ?? false) : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  return fake;
}

const ORIGINAL_UA = navigator.userAgent;

beforeEach(() => {
  for (const mock of Object.values(actions)) mock.mockReset();
  actions.getPushDeviceState.mockResolvedValue({ ok: true, data: { active: false } });
  installBrowser();
});
afterEach(() => {
  Object.defineProperty(navigator, "userAgent", { value: ORIGINAL_UA, configurable: true });
  vi.restoreAllMocks();
});

const section = () => screen.getByRole("region", { name: "Canal de avisos" });
const activateKey = () =>
  screen.getByRole("button", { name: /Activar este dispositivo|Activando/ });
const radio = (name: string) => screen.getByRole("radio", { name });
const ready = () => waitFor(() => expect(section()).toHaveAttribute("data-push-ready", "true"));

describe("the choice of channel", () => {
  test("offers Push, Telegram and Ambos with the saved one selected", async () => {
    render(<ChannelSection initial={{ ...BASE, deliveryChannel: "both" }} />);
    await ready();
    expect(screen.getByRole("heading", { level: 2, name: "Canal de avisos" })).toBeVisible();
    expect(screen.getByRole("radiogroup", { name: "Canal de avisos" })).toBeVisible();
    expect(radio("Push")).toHaveAttribute("aria-checked", "false");
    expect(radio("Telegram")).toHaveAttribute("aria-checked", "false");
    expect(radio("Ambos")).toHaveAttribute("aria-checked", "true");
  });

  test("choosing saves, says so, and shows what the server answered", async () => {
    actions.setDeliveryChannel.mockResolvedValue({
      ok: true,
      data: { ...WITH_DEVICE, deliveryChannel: "telegram", telegramConnected: true },
    });
    render(<ChannelSection initial={summaryWith({ telegramConnected: true })} />);
    await ready();
    fireEvent.click(radio("Telegram"));
    expect(actions.setDeliveryChannel).toHaveBeenCalledWith({ deliveryChannel: "telegram" });
    await waitFor(() => expect(radio("Telegram")).toHaveAttribute("aria-checked", "true"));
    expect(await screen.findByText("Guardado.")).toBeVisible();
    expect(screen.getByText("Los avisos llegan por Telegram.")).toBeVisible();
  });

  test("a refused save goes back to the saved channel and says why", async () => {
    actions.setDeliveryChannel.mockResolvedValue({ ok: false, error: "No autorizado." });
    render(<ChannelSection initial={BASE} />);
    await ready();
    fireEvent.click(radio("Ambos"));
    await waitFor(() => expect(radio("Push")).toHaveAttribute("aria-checked", "true"));
    expect(radio("Ambos")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("alert")).toHaveTextContent("No autorizado.");
  });

  test("a network failure also goes back, with the generic message", async () => {
    actions.setDeliveryChannel.mockRejectedValue(new Error("offline"));
    render(<ChannelSection initial={BASE} />);
    await ready();
    fireEvent.click(radio("Telegram"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("No se pudo guardar"));
    expect(radio("Push")).toHaveAttribute("aria-checked", "true");
  });

  test("choosing the saved one again saves nothing", async () => {
    render(<ChannelSection initial={BASE} />);
    await ready();
    fireEvent.click(radio("Push"));
    expect(actions.setDeliveryChannel).not.toHaveBeenCalled();
  });

  test("the control keeps working while a save is in flight: it is guarded, not disabled", async () => {
    let resolve!: (value: unknown) => void;
    actions.setDeliveryChannel.mockReturnValue(new Promise((done) => (resolve = done)));
    render(<ChannelSection initial={BASE} />);
    await ready();
    fireEvent.click(radio("Telegram"));
    expect(radio("Ambos")).not.toBeDisabled();
    fireEvent.click(radio("Ambos"));
    expect(actions.setDeliveryChannel).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ ok: true, data: { ...BASE, deliveryChannel: "telegram" } }));
  });
});

describe("what it says will happen", () => {
  test("push with no device falls back to Telegram when it is connected, and says so", async () => {
    render(<ChannelSection initial={{ ...BASE, telegramConnected: true }} />);
    await ready();
    expect(
      screen.getByText(
        "Todavía no hay un dispositivo con push: mientras tanto los avisos llegan por Telegram.",
      ),
    ).toBeVisible();
  });

  test("with a device, push is what arrives", async () => {
    actions.getPushDeviceState.mockResolvedValue({ ok: true, data: { active: true } });
    render(<ChannelSection initial={WITH_DEVICE} />);
    await ready();
    expect(screen.getByText("Los avisos llegan por push (1 dispositivo).")).toBeVisible();
  });

  test("with no channel ready it says nothing is sent", async () => {
    render(<ChannelSection initial={BASE} />);
    await ready();
    expect(screen.getByText(/no se envía ningún aviso/)).toBeVisible();
  });

  test("lists the active devices with their name and date, with no endpoint or key", async () => {
    render(<ChannelSection initial={WITH_DEVICE} />);
    await ready();
    const list = screen.getByRole("list", { name: "Dispositivos con push" });
    expect(list).toHaveTextContent("Mac · Chrome · desde el 3 oct. 2026");
    expect(document.body.innerHTML).not.toContain("fcm.googleapis.com");
  });
});

describe("this device", () => {
  test("a browser that can push offers to activate, with the state in words", async () => {
    render(<ChannelSection initial={BASE} />);
    await ready();
    expect(screen.getByRole("heading", { level: 3, name: "Este dispositivo" })).toBeVisible();
    expect(screen.getByText("Este dispositivo no recibe avisos por push.")).toBeVisible();
    expect(activateKey()).toHaveAccessibleName("Activar este dispositivo");
    expect(screen.queryByRole("button", { name: /Desactivar/ })).toBeNull();
  });

  test("activating asks permission, registers the worker, subscribes with the public key and tells the server", async () => {
    const fake = installBrowser();
    actions.subscribePushDevice.mockResolvedValue({ ok: true, data: WITH_DEVICE });
    render(<ChannelSection initial={BASE} />);
    await ready();
    fireEvent.click(activateKey());

    const deactivate = await screen.findByRole("button", { name: "Desactivar este dispositivo" });
    expect(fake.register).toHaveBeenCalledWith("/sw.js", { scope: "/", updateViaCache: "none" });
    const subscribeOptions = fake.subscribe.mock.calls[0][0];
    expect(subscribeOptions.userVisibleOnly).toBe(true);
    expect(subscribeOptions.applicationServerKey).toBeInstanceOf(Uint8Array);
    expect(subscribeOptions.applicationServerKey).toHaveLength(65);
    // Only what the server needs, nothing the browser added.
    expect(actions.subscribePushDevice).toHaveBeenCalledWith({
      endpoint: ENDPOINT,
      keys: KEYS,
    });
    expect(screen.getByRole("status")).toHaveTextContent("Este dispositivo quedó activado.");
    expect(screen.getByText("Este dispositivo recibe avisos por push.")).toBeVisible();
    expect(screen.getByRole("list", { name: "Dispositivos con push" })).toBeVisible();
    // The key that had the focus was replaced: the new one has it.
    expect(deactivate).toHaveFocus();
  });

  test("a subscription made with another key is replaced before subscribing", async () => {
    const old = makeSubscription(new Uint8Array([9, 9, 9]).buffer);
    const fake = installBrowser({ subscription: old });
    actions.getPushDeviceState.mockResolvedValue({ ok: true, data: { active: false } });
    actions.subscribePushDevice.mockResolvedValue({ ok: true, data: WITH_DEVICE });
    render(<ChannelSection initial={BASE} />);
    await ready();
    fireEvent.click(activateKey());
    await screen.findByRole("button", { name: "Desactivar este dispositivo" });
    expect(old.unsubscribe).toHaveBeenCalled();
    expect(fake.subscribe).toHaveBeenCalledTimes(1);
  });

  test("a denied permission explains how to unblock it and leaves no dead key", async () => {
    installBrowser({ requestResult: "denied" });
    render(<ChannelSection initial={BASE} />);
    await ready();
    fireEvent.click(activateKey());
    expect(await screen.findByText(/El permiso de notificaciones está bloqueado/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /Activar este dispositivo/ })).toBeNull();
    expect(actions.subscribePushDevice).not.toHaveBeenCalled();
    // The key that had the focus is gone: it goes to the section's title.
    expect(screen.getByRole("heading", { level: 2, name: "Canal de avisos" })).toHaveFocus();
  });

  test("an already blocked permission is explained from the start", async () => {
    installBrowser({ permission: "denied" });
    render(<ChannelSection initial={BASE} />);
    await ready();
    expect(screen.getByText(/El permiso de notificaciones está bloqueado/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /Activar este dispositivo/ })).toBeNull();
  });

  test("a prompt dismissed without an answer says it could not be activated and keeps the key", async () => {
    installBrowser({ requestResult: "default" });
    render(<ChannelSection initial={BASE} />);
    await ready();
    fireEvent.click(activateKey());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo activar este dispositivo",
    );
    expect(activateKey()).toBeVisible();
  });

  test("when the server refuses the subscription, the browser's own is dropped and the error shown", async () => {
    const fake = installBrowser();
    actions.subscribePushDevice.mockResolvedValue({
      ok: false,
      error: "Ya hay 10 dispositivos activos. Desactiva alguno antes de sumar otro.",
    });
    render(<ChannelSection initial={BASE} />);
    await ready();
    fireEvent.click(activateKey());
    expect(await screen.findByRole("alert")).toHaveTextContent("Ya hay 10 dispositivos activos");
    expect(fake.subscription?.unsubscribe).toHaveBeenCalled();
    expect(activateKey()).toBeVisible();
    expect(screen.queryByRole("button", { name: /Desactivar/ })).toBeNull();
  });

  test("a failure while subscribing says so and the key stays", async () => {
    const fake = installBrowser();
    fake.subscribe.mockRejectedValue(new Error("push service unavailable"));
    render(<ChannelSection initial={BASE} />);
    await ready();
    fireEvent.click(activateKey());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo activar este dispositivo",
    );
    expect(activateKey()).toBeVisible();
  });

  test("a second press while activating does nothing (aria-disabled plus a guard)", async () => {
    let resolve!: (value: unknown) => void;
    actions.subscribePushDevice.mockReturnValue(new Promise((done) => (resolve = done)));
    render(<ChannelSection initial={BASE} />);
    await ready();
    fireEvent.click(activateKey());
    await waitFor(() => expect(activateKey()).toHaveTextContent("Activando…"));
    expect(activateKey()).toHaveAttribute("aria-disabled", "true");
    expect(activateKey()).not.toBeDisabled();
    fireEvent.click(activateKey());
    await act(async () => resolve({ ok: true, data: WITH_DEVICE }));
    expect(actions.subscribePushDevice).toHaveBeenCalledTimes(1);
  });

  test("a device the server already sends to starts as active and can be deactivated", async () => {
    const subscription = makeSubscription();
    installBrowser({ subscription });
    actions.getPushDeviceState.mockResolvedValue({ ok: true, data: { active: true } });
    actions.unsubscribePushDevice.mockResolvedValue({ ok: true, data: BASE });
    render(<ChannelSection initial={WITH_DEVICE} />);
    await ready();
    expect(actions.getPushDeviceState).toHaveBeenCalledWith({ endpoint: ENDPOINT });
    expect(screen.getByText("Este dispositivo recibe avisos por push.")).toBeVisible();

    const key = screen.getByRole("button", { name: "Desactivar este dispositivo" });
    fireEvent.click(key);
    const activate = await screen.findByRole("button", { name: "Activar este dispositivo" });
    expect(actions.unsubscribePushDevice).toHaveBeenCalledWith({ endpoint: ENDPOINT });
    expect(subscription.unsubscribe).toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Este dispositivo quedó desactivado.");
    expect(screen.queryByRole("list", { name: "Dispositivos con push" })).toBeNull();
    expect(activate).toHaveFocus();
  });

  test("a subscription the server no longer has (turned off elsewhere) reads as inactive", async () => {
    installBrowser({ subscription: makeSubscription() });
    actions.getPushDeviceState.mockResolvedValue({ ok: true, data: { active: false } });
    render(<ChannelSection initial={BASE} />);
    await ready();
    expect(screen.getByText("Este dispositivo no recibe avisos por push.")).toBeVisible();
    expect(activateKey()).toBeVisible();
  });

  test("a failed deactivation keeps the device on and says so", async () => {
    installBrowser({ subscription: makeSubscription() });
    actions.getPushDeviceState.mockResolvedValue({ ok: true, data: { active: true } });
    actions.unsubscribePushDevice.mockResolvedValue({ ok: false, error: "No autorizado." });
    render(<ChannelSection initial={WITH_DEVICE} />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Desactivar este dispositivo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No autorizado.");
    expect(screen.getByRole("button", { name: "Desactivar este dispositivo" })).toBeVisible();
  });
});

describe("where push cannot work", () => {
  const IPHONE =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1";

  test("an iPhone outside the installed app explains how to install it and offers no dead key", async () => {
    installBrowser({ userAgent: IPHONE, withPushManager: false, standalone: false });
    render(<ChannelSection initial={BASE} />);
    await ready();
    expect(
      screen.getByText(/En iPhone y iPad el push solo funciona con la app instalada/),
    ).toBeVisible();
    expect(screen.getByText(/Añadir a pantalla de inicio/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /Activar este dispositivo/ })).toBeNull();
  });

  test("the installed iPhone app can activate", async () => {
    installBrowser({ userAgent: IPHONE, standalone: true });
    render(<ChannelSection initial={BASE} />);
    await ready();
    expect(activateKey()).toBeVisible();
    expect(screen.queryByText(/solo funciona con la app instalada/)).toBeNull();
  });

  test("a browser without the APIs says so", async () => {
    installBrowser({ withPushManager: false });
    render(<ChannelSection initial={BASE} />);
    await ready();
    expect(screen.getByText(/Este navegador no permite avisos por push/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /Activar este dispositivo/ })).toBeNull();
  });

  test("with the keys missing on the server it says so by variable name and has no key", async () => {
    render(
      <ChannelSection
        initial={{
          ...BASE,
          pushConfigured: false,
          vapidPublicKey: null,
          pushProblems: ["VAPID_PUBLIC_KEY falta", "VAPID_SUBJECT falta"],
        }}
      />,
    );
    await ready();
    expect(screen.getByText("El push todavía no está configurado en el servidor.")).toBeVisible();
    expect(screen.getByText("VAPID_PUBLIC_KEY falta")).toBeVisible();
    expect(screen.queryByRole("button", { name: /Activar este dispositivo/ })).toBeNull();
    // The choice still works: Telegram can carry the reminders meanwhile.
    expect(radio("Telegram")).toBeVisible();
  });
});

test("marks itself hydrated once it knows the state of this device (the E2E waits for it)", async () => {
  render(<ChannelSection initial={BASE} />);
  await ready();
});
