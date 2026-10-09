// What the browser needs to subscribe to push (SPEC-reminders "Push web"). Client-safe and pure:
// the screen hands in what it read from `navigator`/`window`, so the rules are testable.

/** What this browser can do about push. */
export type PushSupport =
  /** It can subscribe (permission may still be asked). */
  | "supported"
  /** iPhone/iPad outside the installed app: Safari only offers push to a PWA on the home screen. */
  | "needs_install"
  /** No service worker, Push API or Notification API. */
  | "unsupported";

export type BrowserFacts = {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  /** Running as an installed app (`display-mode: standalone`, or iOS' `navigator.standalone`). */
  standalone: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
};

/** iPhone, iPad and iPad in "desktop" mode (it says Macintosh but has a touch screen). */
export function isIosFamily(
  facts: Pick<BrowserFacts, "userAgent" | "platform" | "maxTouchPoints">,
) {
  return (
    /iPhone|iPad|iPod/.test(facts.userAgent) ||
    (facts.platform === "MacIntel" && facts.maxTouchPoints > 1)
  );
}

export function pushSupport(facts: BrowserFacts): PushSupport {
  // iOS first: in a Safari tab `PushManager` does not exist, which would read as "unsupported"
  // when the real answer is "install the app".
  if (isIosFamily(facts) && !facts.standalone) return "needs_install";
  if (!facts.hasServiceWorker || !facts.hasPushManager || !facts.hasNotification) {
    return "unsupported";
  }
  return "supported";
}

/** The facts of the running browser. Call it in an effect or an event, never while rendering. */
export function readBrowserFacts(): BrowserFacts {
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    standalone,
    hasServiceWorker: "serviceWorker" in navigator,
    hasPushManager: "PushManager" in window,
    hasNotification: "Notification" in window,
  };
}

/** `applicationServerKey` wants bytes; the key travels as base64url. */
export function urlBase64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index++) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

/** Whether a subscription was made with this server key (a different one can never be sent to). */
export function sameApplicationServerKey(
  existing: ArrayBuffer | null | undefined,
  expected: Uint8Array,
): boolean {
  // The browser did not say: keep the subscription rather than churn it.
  if (!existing) return true;
  const bytes = new Uint8Array(existing);
  return bytes.length === expected.length && bytes.every((byte, index) => byte === expected[index]);
}
